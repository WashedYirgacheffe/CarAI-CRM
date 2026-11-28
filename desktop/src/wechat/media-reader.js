// 微信 4.x 本地媒体只读解密与文件定位引擎（纯 Node.js，零上传，保护业务员与客户隐私）
// 支持：
// 1) 图片加载：明文 JPG/PNG/GIF/WebP、单字节 XOR .dat、微信 4.x V1（单字节账号 XOR）、
//    微信 4.x V2（AES-128-ECB + 单字节账号 XOR，兼容 ASCII + UTF-16LE 内存密钥扫描）
// 2) 视频加载：读取 msg/video/<YYYY-MM>/<md5>.jpg 封面图并调用系统播放器打开 .mp4
// 3) 文件打开：检索 msg/file/<YYYY-MM>/<原文件名> 交由系统默认软件打开
// 4) 本地头像兜底：从解密后的 head_image/head_image.db 读取头像 BLOB
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const V1_MAGIC = Buffer.from([0x07, 0x08, 0x05, 0x56, 0x02, 0x05]);
const V2_MAGIC = Buffer.from([0x07, 0x08, 0x56, 0x32, 0x08, 0x07]);

function detectImageMime(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return { mime: "image/gif", ext: "gif" };
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.length >= 12 && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

function stripImageFooter(plain) {
  if (!plain || plain.length < 16) return plain;
  if (plain[0] === 0xff && plain[1] === 0xd8) {
    const end = plain.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (end > 0 && plain.length - (end + 2) <= 48) return plain.subarray(0, end + 2);
  }
  if (plain[0] === 0x89 && plain[1] === 0x50) {
    const iend = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    const end = plain.lastIndexOf(iend);
    if (end > 0 && plain.length - (end + 8) <= 48) return plain.subarray(0, end + 8);
  }
  return plain;
}

/**
 * 统计推算当前微信账号的全局单字节图片 XOR 密钥：
 * 收集 msg/attach 目录下最多 16 个 *_t.dat 缩略图尾部 2 字节，按 JPEG EOI (FF D9) 众数投票得出精准 xorKey。
 */
export function detectAccountXorKey(accountDir) {
  if (!accountDir) return null;
  const attachRoot = path.join(accountDir, "msg", "attach");
  if (!fs.existsSync(attachRoot)) return null;

  const thumbs = [];
  try {
    const chats = fs.readdirSync(attachRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const c of chats) {
      if (thumbs.length >= 24) break;
      const chatPath = path.join(attachRoot, c.name);
      const months = fs
        .readdirSync(chatPath, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();
      for (const m of months) {
        if (thumbs.length >= 24) break;
        const imgDir = path.join(chatPath, m, "Img");
        if (!fs.existsSync(imgDir)) continue;
        for (const f of fs.readdirSync(imgDir)) {
          if (f.toLowerCase().endsWith("_t.dat")) {
            thumbs.push(path.join(imgDir, f));
            if (thumbs.length >= 24) break;
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  const votes = new Map();
  for (const p of thumbs) {
    try {
      const stat = fs.statSync(p);
      if (stat.size < 32) continue;
      const fd = fs.openSync(p, "r");
      const tailLen = Math.min(stat.size, 36);
      const tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, stat.size - tailLen);
      fs.closeSync(fd);
      // 优先检查最后 2 字节（标准 JPEG EOI），兼顾带短页脚的容器
      const x = tail[tailLen - 2];
      const y = tail[tailLen - 1];
      const k = x ^ 0xff;
      if ((y ^ k) === 0xd9) {
        votes.set(k, (votes.get(k) || 0) + 1);
      }
    } catch {
      /* ignore */
    }
  }

  let bestKey = null;
  let bestCount = 0;
  for (const [k, cnt] of votes.entries()) {
    if (cnt > bestCount) {
      bestCount = cnt;
      bestKey = k;
    }
  }
  return bestKey;
}

function tryDecodeSingleXor(buf) {
  if (!buf || buf.length < 16) return null;
  const sigs = [
    [0xff, 0xd8, 0xff],
    [0x89, 0x50, 0x4e, 0x47],
    [0x47, 0x49, 0x46, 0x38],
    [0x52, 0x49, 0x46, 0x46],
  ];
  for (const sig of sigs) {
    const k = buf[0] ^ sig[0];
    let ok = true;
    for (let i = 1; i < sig.length; i++) {
      if ((buf[i] ^ k) !== sig[i]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const out = Buffer.allocUnsafe(buf.length);
      for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ k;
      const info = detectImageMime(out);
      if (info) return { buf: stripImageFooter(out), ...info };
    }
  }
  return null;
}

/**
 * 解密微信 4.x V1 / V2 / 老版单字节 XOR .dat 图片
 */
export function decodeWechatDatBuffer(raw, imgAesKey = null, imgXorKey = null) {
  if (!raw || raw.length < 16) return null;

  // 1) 明文图片
  const plainInfo = detectImageMime(raw);
  if (plainInfo) return { buf: stripImageFooter(raw), ...plainInfo };

  // 2) 微信 4.x V2 容器：[6B magic][4B aesSize LE][4B xorSize LE][1B pad][aesCipher][rawMid][xorTail]
  if (raw.length > 32 && raw.subarray(0, 6).equals(V2_MAGIC)) {
    const aesSize = raw.readUInt32LE(6);
    const xorSize = raw.readUInt32LE(10);
    const headerLen = 15;
    const alignedAes = aesSize > 0 ? (aesSize % 16 === 0 ? aesSize + 16 : aesSize + (16 - (aesSize % 16))) : 0;

    if (headerLen + alignedAes > raw.length) return null;
    if (alignedAes > 0 && (!imgAesKey || imgAesKey.length !== 16)) {
      return { needAesKey: true, probeBlock: raw.subarray(headerLen, headerLen + 16) };
    }

    let headPlain = Buffer.alloc(0);
    if (alignedAes > 0) {
      try {
        const dec = crypto.createDecipheriv("aes-128-ecb", Buffer.from(imgAesKey, "ascii"), null);
        dec.setAutoPadding(true);
        headPlain = Buffer.concat([dec.update(raw.subarray(headerLen, headerLen + alignedAes)), dec.final()]);
      } catch {
        try {
          const dec = crypto.createDecipheriv("aes-128-ecb", Buffer.from(imgAesKey, "ascii"), null);
          dec.setAutoPadding(false);
          const pt = Buffer.concat([dec.update(raw.subarray(headerLen, headerLen + alignedAes)), dec.final()]);
          // 手动剥离 PKCS7 padding
          const pad = pt[pt.length - 1];
          if (pad >= 1 && pad <= 16 && pt.subarray(pt.length - pad).every((b) => b === pad)) {
            headPlain = pt.subarray(0, pt.length - pad);
          } else {
            headPlain = pt.subarray(0, aesSize);
          }
        } catch {
          return { needAesKey: true, probeBlock: raw.subarray(headerLen, headerLen + 16) };
        }
      }
    }

    const bodyStart = headerLen + alignedAes;
    const tailLen = Math.min(xorSize, raw.length - bodyStart);
    const rawMid = raw.subarray(bodyStart, raw.length - tailLen);
    const tailEnc = raw.subarray(raw.length - tailLen);

    let tailPlain = Buffer.alloc(0);
    if (tailLen > 0) {
      let xk = typeof imgXorKey === "number" ? imgXorKey & 0xff : null;
      if (xk == null) {
        if (headPlain.length >= 2 && headPlain[0] === 0xff && headPlain[1] === 0xd8) {
          // 兼容尾部带短页脚的容器：倒序寻找连续 2 字节满足 FF D9
          for (let off = 0; off <= Math.min(32, tailEnc.length - 2); off++) {
            const k = tailEnc[tailEnc.length - 2 - off] ^ 0xff;
            if ((tailEnc[tailEnc.length - 1 - off] ^ k) === 0xd9) {
              xk = k;
              break;
            }
          }
          if (xk == null) xk = tailEnc[tailEnc.length - 1] ^ 0xd9;
        } else if (headPlain.length >= 2 && headPlain[0] === 0x89 && headPlain[1] === 0x50) {
          xk = tailEnc[tailEnc.length - 1] ^ 0x82;
        } else {
          xk = tailEnc[0] ^ 0xff;
        }
      }
      tailPlain = Buffer.allocUnsafe(tailLen);
      for (let i = 0; i < tailLen; i++) tailPlain[i] = tailEnc[i] ^ xk;
    }

    const full = stripImageFooter(Buffer.concat([headPlain, rawMid, tailPlain]));
    const info = detectImageMime(full);
    if (info) return { buf: full, ...info };
    return { needAesKey: true, probeBlock: raw.subarray(headerLen, headerLen + 16) };
  }

  // 3) 微信 4.x V1 容器（6B sig + 16B header + 单字节 XOR 正文，自动验证单字节 XOR）
  if (raw.length > 26 && raw.subarray(0, 6).equals(V1_MAGIC)) {
    const payload = raw.subarray(22);
    // 先试单字节账号 XOR（微信 4.x V1 实际格式）
    if (typeof imgXorKey === "number") {
      const k = imgXorKey & 0xff;
      const out = Buffer.allocUnsafe(payload.length);
      for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ k;
      const info = detectImageMime(out);
      if (info) return { buf: stripImageFooter(out), ...info };
    }
    const autoXor = tryDecodeSingleXor(payload);
    if (autoXor) return autoXor;
  }

  // 4) 单字节 XOR .dat
  return tryDecodeSingleXor(raw);
}

/** 定位某张图片的本地 .dat / .jpg 文件（同时返回全部候选，支持原图未下载时自动降级到缩略图 _t.dat） */
export function findLocalImageCandidates(accountDir, { md5, thumbMd5, chatMd5, month }) {
  if (!accountDir) return [];
  const attachRoot = path.join(accountDir, "msg", "attach");
  if (!fs.existsSync(attachRoot)) return [];

  const md5s = Array.from(new Set([md5, thumbMd5].filter(Boolean).map((s) => String(s).toLowerCase())));
  if (md5s.length === 0) return [];

  const found = [];
  const addIfExists = (p) => {
    if (fs.existsSync(p) && !found.includes(p)) found.push(p);
  };

  const scanImgDir = (imgDir) => {
    if (!fs.existsSync(imgDir)) return;
    for (const m of md5s) {
      addIfExists(path.join(imgDir, `${m}.jpg`));
      addIfExists(path.join(imgDir, `${m}.png`));
      addIfExists(path.join(imgDir, `${m}.dat`));
      addIfExists(path.join(imgDir, `${m}_h.dat`));
      addIfExists(path.join(imgDir, `${m}_t.dat`));
    }
    if (found.length > 0) return;
    try {
      const entries = fs.readdirSync(imgDir);
      for (const m of md5s) {
        for (const e of entries) {
          if (e.toLowerCase().includes(m)) addIfExists(path.join(imgDir, e));
        }
      }
    } catch {
      /* ignore */
    }
  };

  const searchChatDir = (chatDir) => {
    if (!fs.existsSync(chatDir)) return;
    if (month) scanImgDir(path.join(chatDir, month, "Img"));
    if (found.length > 0) return;
    try {
      const months = fs
        .readdirSync(chatDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();
      for (const m of months) {
        if (m === month) continue;
        scanImgDir(path.join(chatDir, m, "Img"));
        if (found.length > 0) return;
      }
    } catch {
      /* ignore */
    }
  };

  if (chatMd5) searchChatDir(path.join(attachRoot, chatMd5));
  if (found.length > 0) return found;

  try {
    const dirs = fs.readdirSync(attachRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).slice(0, 60);
    for (const d of dirs) {
      searchChatDir(path.join(attachRoot, d.name));
      if (found.length > 0) return found;
    }
  } catch {
    /* ignore */
  }
  return found;
}

/** 定位本地微信视频的封面图 (.jpg) 与视频文件 (.mp4) */
export function findLocalVideoMedia(accountDir, { md5, rawMd5, thumbMd5, month }) {
  if (!accountDir) return { thumbPath: null, videoPath: null };
  const videoRoot = path.join(accountDir, "msg", "video");
  if (!fs.existsSync(videoRoot)) return { thumbPath: null, videoPath: null };

  const keys = Array.from(new Set([md5, rawMd5, thumbMd5].filter(Boolean).map((s) => String(s).toLowerCase())));
  if (keys.length === 0) return { thumbPath: null, videoPath: null };

  let thumbPath = null;
  let videoPath = null;

  const checkDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const k of keys) {
      if (!videoPath) {
        const mp4 = path.join(dir, `${k}.mp4`);
        if (fs.existsSync(mp4)) videoPath = mp4;
      }
      if (!thumbPath) {
        for (const cand of [`${k}.jpg`, `${k}_thumb.jpg`, `${k}.png`]) {
          const tp = path.join(dir, cand);
          if (fs.existsSync(tp)) {
            thumbPath = tp;
            break;
          }
        }
      }
    }
    if (!thumbPath || !videoPath) {
      try {
        const entries = fs.readdirSync(dir);
        for (const k of keys) {
          if (!videoPath) {
            const hit = entries.find((e) => e.toLowerCase().includes(k) && e.toLowerCase().endsWith(".mp4"));
            if (hit) videoPath = path.join(dir, hit);
          }
          if (!thumbPath) {
            const hit = entries.find((e) => e.toLowerCase().includes(k) && /\.(jpg|jpeg|png)$/i.test(e));
            if (hit) thumbPath = path.join(dir, hit);
          }
        }
      } catch {
        /* ignore */
      }
    }
  };

  if (month) checkDir(path.join(videoRoot, month));
  if (!thumbPath || !videoPath) {
    try {
      const months = fs
        .readdirSync(videoRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();
      for (const m of months) {
        if (m === month) continue;
        checkDir(path.join(videoRoot, m));
        if (thumbPath && videoPath) break;
      }
    } catch {
      /* ignore */
    }
  }
  return { thumbPath, videoPath };
}

/** 在 <accountDir>/msg/file/ 中定位微信本地已下载的文件 */
export function findLocalFilePath(accountDir, { filename, month }) {
  if (!accountDir || !filename) return null;
  const fileRoot = path.join(accountDir, "msg", "file");
  if (!fs.existsSync(fileRoot)) return null;

  const targetName = path.basename(String(filename).trim());
  const targetLower = targetName.toLowerCase();
  const ext = path.extname(targetLower);
  const stem = ext ? targetLower.slice(0, -ext.length) : targetLower;

  const checkMonthDir = (dir) => {
    if (!fs.existsSync(dir)) return null;
    const exact = path.join(dir, targetName);
    if (fs.existsSync(exact)) return exact;
    try {
      const entries = fs.readdirSync(dir);
      const hit =
        entries.find((e) => e.toLowerCase() === targetLower) ||
        entries.find((e) => {
          const el = e.toLowerCase();
          return ext && el.endsWith(ext) && el.startsWith(`${stem}(`);
        });
      if (hit) return path.join(dir, hit);
    } catch {
      /* ignore */
    }
    return null;
  };

  if (month) {
    const direct = checkMonthDir(path.join(fileRoot, month));
    if (direct) return direct;
  }

  try {
    const months = fs
      .readdirSync(fileRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const m of months) {
      if (m === month) continue;
      const found = checkMonthDir(path.join(fileRoot, m));
      if (found) return found;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 纯只读扫描 Weixin.exe 内存提取 16 字节图片 AES-128-ECB 密钥
 * 同时支持 ASCII ([a-zA-Z0-9]{16|32}) 与 Qt UTF-16LE ((?:[a-zA-Z0-9]\0){16|32}) 两种内存形态
 */
export async function scanWechatImageAesKey({ pids, probeBlock }) {
  if (process.platform !== "win32" || !pids?.length || !probeBlock || probeBlock.length !== 16) {
    return null;
  }
  const probeHex = probeBlock.toString("hex");
  const pidCsv = pids.join(",");

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

public class WxImgKeyScannerV2 {
  [StructLayout(LayoutKind.Sequential)]
  public struct MBI {
    public IntPtr BaseAddress;
    public IntPtr AllocationBase;
    public uint AllocationProtect;
    public IntPtr RegionSize;
    public uint State;
    public uint Protect;
    public uint Type;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint a, bool b, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int sz, out IntPtr read);
  [DllImport("kernel32.dll")]
  public static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr addr, out MBI mbi, uint len);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr h);

  static bool IsAlnum(byte b) {
    return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z');
  }

  static byte[] FromHex(string s) {
    byte[] r = new byte[s.Length / 2];
    for (int i = 0; i < r.Length; i++) r[i] = Convert.ToByte(s.Substring(i * 2, 2), 16);
    return r;
  }

  static bool LooksLikeImage(byte[] pt) {
    if (pt == null || pt.Length < 4) return false;
    if (pt[0] == 0xFF && pt[1] == 0xD8 && pt[2] == 0xFF) return true;
    if (pt[0] == 0x89 && pt[1] == 0x50 && pt[2] == 0x4E && pt[3] == 0x47) return true;
    if (pt[0] == 0x47 && pt[1] == 0x49 && pt[2] == 0x46 && pt[3] == 0x38) return true;
    if (pt[0] == 0x52 && pt[1] == 0x49 && pt[2] == 0x46 && pt[3] == 0x46) return true;
    if (pt[0] == 'w' && pt[1] == 'x' && pt[2] == 'g' && pt[3] == 'f') return true;
    return false;
  }

  static bool TryCandidate(RijndaelManaged aes, byte[] probe, byte[] outBuf, HashSet<string> tried, string cand) {
    if (cand.Length != 16 || !tried.Add(cand)) return false;
    try {
      aes.Key = Encoding.ASCII.GetBytes(cand);
      using (var dec = aes.CreateDecryptor()) {
        dec.TransformBlock(probe, 0, 16, outBuf, 0);
      }
      return LooksLikeImage(outBuf);
    } catch {
      return false;
    }
  }

  public static string Scan(string pidsCsv, string probeHex) {
    var sw = Stopwatch.StartNew();
    byte[] probe = FromHex(probeHex);
    byte[] outBuf = new byte[16];
    var tried = new HashSet<string>();
    var aes = new RijndaelManaged();
    aes.Mode = CipherMode.ECB;
    aes.Padding = PaddingMode.None;
    aes.KeySize = 128;

    foreach (string part in pidsCsv.Split(',')) {
      int pid;
      if (!int.TryParse(part.Trim(), out pid) || pid <= 0) continue;
      IntPtr h = OpenProcess(0x0410, false, pid);
      if (h == IntPtr.Zero) continue;
      try {
        long addr = 0;
        uint mbiSize = (uint)Marshal.SizeOf(typeof(MBI));
        byte[] chunk = new byte[2 * 1024 * 1024];
        while (addr < 0x7FFFFFFFFFFFL && sw.Elapsed.TotalSeconds < 28.0) {
          MBI mbi;
          if (VirtualQueryEx(h, (IntPtr)addr, out mbi, mbiSize) == IntPtr.Zero) break;
          long sz = mbi.RegionSize.ToInt64();
          uint p = mbi.Protect & 0xFF;
          bool readable = mbi.State == 0x1000 && (mbi.Protect & 0x100) == 0 && ((p & 0xE6) != 0);
          if (readable && sz > 0 && sz < 128L * 1024 * 1024) {
            for (long off = 0; off < sz && sw.Elapsed.TotalSeconds < 28.0; off += chunk.Length) {
              int toRead = (int)Math.Min((long)chunk.Length, sz - off);
              IntPtr read;
              if (!ReadProcessMemory(h, (IntPtr)(mbi.BaseAddress.ToInt64() + off), chunk, toRead, out read)) continue;
              int len = (int)read.ToInt64();

              // 1) ASCII 16 / 32 位字母数字串（如 MD5 摘要前 16 位）
              int i = 0;
              while (i <= len - 16) {
                if (!IsAlnum(chunk[i])) { i++; continue; }
                int k = i;
                while (k < len && IsAlnum(chunk[k])) k++;
                int run = k - i;
                if (run == 16 || run == 32) {
                  string cand = Encoding.ASCII.GetString(chunk, i, 16);
                  if (TryCandidate(aes, probe, outBuf, tried, cand)) return cand;
                }
                i = k + 1;
              }

              // 2) UTF-16LE (Qt QString) 16 / 32 位字母数字串
              int u = 0;
              while (u <= len - 32) {
                if (!IsAlnum(chunk[u]) || chunk[u + 1] != 0) { u += 2; continue; }
                int k = u;
                while (k + 1 < len && IsAlnum(chunk[k]) && chunk[k + 1] == 0) k += 2;
                int chars = (k - u) / 2;
                if (chars == 16 || chars == 32) {
                  char[] cs = new char[16];
                  for (int c = 0; c < 16; c++) cs[c] = (char)chunk[u + c * 2];
                  string cand = new string(cs);
                  if (TryCandidate(aes, probe, outBuf, tried, cand)) return cand;
                }
                u = k + 2;
              }
            }
          }
          long next = mbi.BaseAddress.ToInt64() + sz;
          if (next <= addr) break;
          addr = next;
        }
      } finally {
        CloseHandle(h);
      }
    }
    return "";
  }
}
"@
Write-Output ([WxImgKeyScannerV2]::Scan('${pidCsv}', '${probeHex}'))
`;

  const tmpFile = path.join(os.tmpdir(), `cheche-wximg-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(tmpFile, `\uFEFF${ps}`, "utf8");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", tmpFile],
      { timeout: 35000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    const key = stdout.trim();
    return /^[0-9a-zA-Z]{16}$/.test(key) ? key : null;
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

export async function readLocalHeadImageDataUrl(headImageDbPath, wxKey) {
  if (!headImageDbPath || !wxKey || !fs.existsSync(headImageDbPath)) return null;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(headImageDbPath, { open: true, readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      const tbl = tables.find((t) => /head_image/i.test(t));
      if (!tbl) return null;
      const cols = db.prepare(`PRAGMA table_info("${tbl}")`).all().map((c) => c.name);
      const colUser = cols.find((c) => /^(username|user_name)$/i.test(c));
      const colBuf = cols.find((c) => /^(image_buffer|image|data|buffer)$/i.test(c));
      if (!colUser || !colBuf) return null;
      const row = db.prepare(`SELECT "${colBuf}" AS b FROM "${tbl}" WHERE "${colUser}" = ? LIMIT 1`).get(wxKey);
      if (!row?.b) return null;
      const buf = Buffer.isBuffer(row.b) ? row.b : Buffer.from(row.b);
      const info = detectImageMime(buf);
      if (!info) return null;
      return `data:${info.mime};base64,${buf.toString("base64")}`;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
