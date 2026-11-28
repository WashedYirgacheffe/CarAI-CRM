// 微信 4.x 本地媒体只读解密与文件定位引擎（纯 Node.js，零上传，保护业务员与客户隐私）
// 支持：
// 1) 图片加载：纯明文 JPG/PNG/GIF/WebP、单字节 XOR .dat、微信 4.x V1/V2 (.dat AES-128-ECB + XOR)
// 2) 文件打开：按 <accountDir>/msg/file/<YYYY-MM>/<原文件名> 精准/跨月检索，交由系统默认程序打开
// 3) 本地头像兜底：从解密后的 head_image/head_image.db 读取群聊九宫格或联系人本地头像 BLOB
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
  // JPEG EOI FF D9
  if (plain[0] === 0xff && plain[1] === 0xd8) {
    const end = plain.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (end > 0 && plain.length - (end + 2) <= 48) return plain.subarray(0, end + 2);
  }
  // PNG IEND
  if (plain[0] === 0x89 && plain[1] === 0x50) {
    const iend = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    const end = plain.lastIndexOf(iend);
    if (end > 0 && plain.length - (end + 8) <= 48) return plain.subarray(0, end + 8);
  }
  return plain;
}

/** 尝试用单字节 XOR 解密老格式或无 AES 头 .dat 图片 */
function tryDecodeSingleXor(buf) {
  if (!buf || buf.length < 16) return null;
  const sigs = [
    [0xff, 0xd8, 0xff], // JPEG
    [0x89, 0x50, 0x4e, 0x47], // PNG
    [0x47, 0x49, 0x46, 0x38], // GIF
    [0x52, 0x49, 0x46, 0x46], // WebP
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

/** 解密微信 4.x V2 .dat 图片（结构：6B magic + 4B aesSize + 4B xorSize + 1B pad + aesCipher + rawMid + xorTail） */
export function decodeWechatDatBuffer(raw, imgAesKey = null, imgXorKey = null) {
  if (!raw || raw.length < 16) return null;

  // 1) 明文图片
  const plainInfo = detectImageMime(raw);
  if (plainInfo) return { buf: stripImageFooter(raw), ...plainInfo };

  // 2) 微信 4.x V2 容器
  if (raw.length > 32 && raw.subarray(0, 6).equals(V2_MAGIC)) {
    const aesSize = raw.readUInt32LE(6);
    const xorSize = raw.readUInt32LE(10);
    const headerLen = 15; // 6B magic + 4B aesSize + 4B xorSize + 1B pad
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
        // 无 padding 兜底
        try {
          const dec = crypto.createDecipheriv("aes-128-ecb", Buffer.from(imgAesKey, "ascii"), null);
          dec.setAutoPadding(false);
          headPlain = Buffer.concat([dec.update(raw.subarray(headerLen, headerLen + alignedAes)), dec.final()]).subarray(0, aesSize);
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
        // JPEG 末尾多为 FF D9；PNG 末尾多为 60 82
        if (headPlain.length >= 2 && headPlain[0] === 0xff && headPlain[1] === 0xd8) {
          xk = tailEnc[tailEnc.length - 1] ^ 0xd9;
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

  // 3) 微信 4.x V1 容器（6B sig + 16B xor key）
  if (raw.length > 26 && raw.subarray(0, 6).equals(V1_MAGIC)) {
    const key = raw.subarray(6, 22);
    const payload = raw.subarray(22);
    const out = Buffer.allocUnsafe(payload.length);
    for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ key[i % key.length];
    const info = detectImageMime(out);
    if (info) return { buf: stripImageFooter(out), ...info };
  }

  // 4) 单字节 XOR .dat
  return tryDecodeSingleXor(raw);
}

/** 在 <accountDir>/msg/attach/<chatMd5>/ 中定位某张图片的本地 .dat / .jpg 文件（优先缩略图以外的高清图，其次缩略图） */
export function findLocalImagePath(accountDir, { md5, chatMd5, month }) {
  if (!accountDir || !md5) return null;
  const attachRoot = path.join(accountDir, "msg", "attach");
  if (!fs.existsSync(attachRoot)) return null;

  const cleanMd5 = String(md5).toLowerCase();
  const tryDir = (imgDir) => {
    if (!fs.existsSync(imgDir)) return null;
    // 优先标准图，其次缩略图，其次任意含 md5 的文件
    const preferred = [
      `${cleanMd5}.jpg`,
      `${cleanMd5}.png`,
      `${cleanMd5}.dat`,
      `${cleanMd5}_h.dat`,
      `${cleanMd5}_t.dat`,
    ];
    for (const name of preferred) {
      const p = path.join(imgDir, name);
      if (fs.existsSync(p)) return p;
    }
    try {
      const entries = fs.readdirSync(imgDir);
      const hit =
        entries.find((e) => e.toLowerCase().startsWith(cleanMd5) && !e.toLowerCase().includes("_t.")) ||
        entries.find((e) => e.toLowerCase().includes(cleanMd5));
      if (hit) return path.join(imgDir, hit);
    } catch {
      /* ignore */
    }
    return null;
  };

  const searchChatDir = (chatDir) => {
    if (!fs.existsSync(chatDir)) return null;
    if (month) {
      const direct = tryDir(path.join(chatDir, month, "Img"));
      if (direct) return direct;
    }
    try {
      const months = fs
        .readdirSync(chatDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();
      for (const m of months) {
        if (m === month) continue;
        const found = tryDir(path.join(chatDir, m, "Img"));
        if (found) return found;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  if (chatMd5) {
    const hit = searchChatDir(path.join(attachRoot, chatMd5));
    if (hit) return hit;
  }

  // 兜底：若 chatMd5 缺失，扫描最近的会话目录（上限 40 个）
  try {
    const dirs = fs.readdirSync(attachRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).slice(0, 40);
    for (const d of dirs) {
      const hit = searchChatDir(path.join(attachRoot, d.name));
      if (hit) return hit;
    }
  } catch {
    /* ignore */
  }
  return null;
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
      // 精确忽略大小写，或微信重名追加的 "xxx(1).pdf"
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
 * 纯只读扫描 Weixin.exe 内存提取 16 字节图片 AES-128-ECB 密钥（仅在碰到 V2 加密图且未缓存密钥时触发一次）
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

public class WxImgKeyScanner {
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

  static bool IsHexOrAlnum(byte b) {
    return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f');
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
        while (addr < 0x7FFFFFFFFFFFL && sw.Elapsed.TotalSeconds < 25.0) {
          MBI mbi;
          if (VirtualQueryEx(h, (IntPtr)addr, out mbi, mbiSize) == IntPtr.Zero) break;
          long sz = mbi.RegionSize.ToInt64();
          uint p = mbi.Protect & 0xFF;
          bool rw = mbi.State == 0x1000 && mbi.Type == 0x20000 && (mbi.Protect & 0x100) == 0 && (p == 0x04 || p == 0x08 || p == 0x40);
          if (rw && sz > 0 && sz < 256L * 1024 * 1024) {
            for (long off = 0; off < sz && sw.Elapsed.TotalSeconds < 25.0; off += chunk.Length) {
              int toRead = (int)Math.Min((long)chunk.Length, sz - off);
              IntPtr read;
              if (!ReadProcessMemory(h, (IntPtr)(mbi.BaseAddress.ToInt64() + off), chunk, toRead, out read)) continue;
              int len = (int)read.ToInt64();
              int i = 0;
              while (i <= len - 16) {
                if (!IsHexOrAlnum(chunk[i])) { i++; continue; }
                int k = i;
                while (k < len && IsHexOrAlnum(chunk[k])) k++;
                int run = k - i;
                if (run == 16 || run == 32) {
                  string cand = Encoding.ASCII.GetString(chunk, i, 16);
                  if (tried.Add(cand)) {
                    try {
                      aes.Key = Encoding.ASCII.GetBytes(cand);
                      using (var dec = aes.CreateDecryptor()) {
                        dec.TransformBlock(probe, 0, 16, outBuf, 0);
                      }
                      if (LooksLikeImage(outBuf)) return cand;
                    } catch {}
                  }
                }
                i = k + 1;
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
Write-Output ([WxImgKeyScanner]::Scan('${pidCsv}', '${probeHex}'))
`;

  const tmpFile = path.join(os.tmpdir(), `cheche-wximg-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(tmpFile, `\uFEFF${ps}`, "utf8");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", tmpFile],
      { timeout: 32000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    const key = stdout.trim();
    return /^[0-9a-f]{16}$/i.test(key) ? key : null;
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

/** 从解密后的 head_image.db 读取指定 username 的本地头像 BLOB（用于群聊九宫格或无 CDN URL 的联系人） */
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
