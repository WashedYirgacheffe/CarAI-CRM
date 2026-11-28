// Windows 微信 4.2 / 4.1 / 4.0 三引擎纯只读内存密钥扫描器（零注入、零 Hook、零调试器、零封号风险）
// 1) 引擎 A（版本无关，通杀 4.1 / 4.2.1.11+）：扫描 SQLCipher 4 `codec_ctx` 运行时结构体特征 [256000,2,16,32,16,16,4096]，
//    核对目标 DB 的 16B salt 指针后直接读取 32B AES Key 或 99B 混淆 blob；
// 2) 引擎 B（4.1+ / 4.2+ 主路径，源自 MIT wcdb-key-tool）：只读扫描 `com.Tencent.WCDB.Config.Cipher` 运行时对象，
//    并结合「已知 32 位明文 salt 逆推 32B XOR 掩码」算法（即使 4.2.1.11 更换 XOR 掩码也能自动自解！）；
// 3) 引擎 C（4.0.x 兜底）：扫描 16B 二进制 salt 邻近槽位、32B ASCII salt 及明文 `x'<64hex><32salt>'`。
// 所有候选密钥均必须通过对应数据库 Page 1 的 SQLCipher 4 HMAC-SHA512 校验才会接受。
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { verifyRawEncKey } from "./db-reader.js";

const execFileAsync = promisify(execFile);

async function runPowerShellFile(script, timeoutMs = 65000) {
  // 写入临时 .ps1 文件执行，彻底规避 Windows CreateProcess 32767 字符命令行限制（spawn ENAMETOOLONG）
  const tmpFile = path.join(os.tmpdir(), `cheche-wxscan-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
  fs.writeFileSync(tmpFile, `\uFEFF${script}`, "utf8");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", tmpFile],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 25 * 1024 * 1024 },
    );
    return stdout.trim();
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

const PAGE_SIZE = 4096;
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");

// 微信 4.1.x 已知 32 字节循环 XOR 掩码（来源：MIT wcdb-key-tool）
const WINDOWS_CONFIG_XOR_MASK = Buffer.from(
  "d2c7442458020000004889442450488b450048844c2448488944254048584c24",
  "hex",
);
const WINDOWS_CONFIG_BLOB_MAX = 1024;
const CONFIG_LITERAL_RE = /[xX]'([0-9a-fA-F]{64,192})'/g;

function xorRepeat(buf, mask) {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ mask[i % mask.length];
  }
  return out;
}

function isProbable32ByteKey(keyBuf) {
  if (!keyBuf || keyBuf.length !== 32) return false;
  return new Set(keyBuf).size >= 15;
}

/**
 * 已知明文 XOR 掩码自恢复（版本无关！即使 4.2.1.11+ 更换 32 字节 XOR 掩码也能 0.01ms 自动逆推）：
 * 99 字节 blob 明文结构恒为 x'<64hex key><32hex salt>'，其中 [66..97] 共 32 字节恰好覆盖模 32 的全部 32 个掩码字节！
 */
export function recoverKeyFromBlobByKnownSalt(blob, saltHex) {
  if (!blob || blob.length !== 99 || !saltHex || saltHex.length !== 32) return null;
  for (const upper of [false, true]) {
    const suffix = Buffer.from(upper ? saltHex.toUpperCase() : saltHex.toLowerCase(), "ascii");
    const mask = Buffer.allocUnsafe(32);
    for (let j = 66; j < 98; j++) {
      mask[j % 32] = blob[j] ^ suffix[j - 66];
    }
    const decoded = xorRepeat(blob, mask);
    // 验证首尾必须为 x'...' 或 X'...'
    if ((decoded[0] !== 0x78 && decoded[0] !== 0x58) || decoded[1] !== 0x27 || decoded[98] !== 0x27) continue;
    const hexPart = decoded.subarray(2, 66).toString("ascii").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hexPart)) continue;
    const keyBuf = Buffer.from(hexPart, "hex");
    if (isProbable32ByteKey(keyBuf)) return hexPart;
  }
  return null;
}

/**
 * 从 Config.Cipher blob 中解码提取候选 (encKeyHex, embeddedSaltHex | null)：
 * 依次尝试：已知明文盐自逆推（针对全部目标 salt）、已知 4.1.x XOR 掩码、以及无掩码明文。
 */
export function extractConfigCipherCandidates(blob, targetSalts = []) {
  if (!blob || blob.length === 0 || blob.length > WINDOWS_CONFIG_BLOB_MAX) return [];
  const out = [];
  const seen = new Set();

  const pushCandidate = (encKeyHex, embeddedSalt) => {
    const dedup = `${encKeyHex}:${embeddedSalt || ""}`;
    if (!seen.has(dedup)) {
      seen.add(dedup);
      out.push({ encKeyHex, embeddedSalt });
    }
  };

  // 1) 版本无关：99 字节 blob 已知明文 salt 自逆推 XOR 掩码
  if (blob.length === 99 && targetSalts.length > 0) {
    for (const saltHex of targetSalts) {
      const recovered = recoverKeyFromBlobByKnownSalt(blob, saltHex);
      if (recovered) pushCandidate(recovered, saltHex);
    }
  }

  // 2) 已知 4.1.x XOR 掩码 + 明文直扫
  const decodedViews = [
    xorRepeat(blob, WINDOWS_CONFIG_XOR_MASK).toString("latin1"),
    blob.toString("latin1"),
  ];
  for (const decoded of decodedViews) {
    CONFIG_LITERAL_RE.lastIndex = 0;
    let m;
    while ((m = CONFIG_LITERAL_RE.exec(decoded)) !== null) {
      const run = m[1].toLowerCase();
      const starts = new Set([0]);
      if (run.length > 96) {
        for (let s = 0; s <= run.length - 64; s += 32) starts.add(s);
        starts.add(run.length - 64);
      }
      for (const start of starts) {
        if (start < 0 || start + 64 > run.length) continue;
        const encKeyHex = run.slice(start, start + 64);
        const keyBuf = Buffer.from(encKeyHex, "hex");
        if (!isProbable32ByteKey(keyBuf)) continue;
        const embeddedSalt = start + 96 <= run.length ? run.slice(start + 64, start + 96) : null;
        pushCandidate(encKeyHex, embeddedSalt);
      }
    }
  }
  return out;
}

/** 收集微信 4.x 核心加密数据库文件及其 Page 1（用于瞬时 HMAC-SHA512 校验） */
function collectTargetDbs(dbRoot, wxVersion) {
  const targets = [];
  const rels = [];

  if (wxVersion === 4) {
    rels.push("contact/contact.db", "session/session.db", "head_image/head_image.db");
    const msgDir = path.join(dbRoot, "message");
    if (fs.existsSync(msgDir)) {
      for (const f of fs.readdirSync(msgDir)) {
        if (/^message_\d+\.db$/i.test(f)) rels.push(`message/${f}`);
      }
    }
  } else {
    rels.push("MicroMsg.db");
  }

  for (const rel of rels) {
    const full = path.join(dbRoot, rel);
    if (!fs.existsSync(full)) continue;
    try {
      const fd = fs.openSync(full, "r");
      const page1 = Buffer.alloc(PAGE_SIZE);
      const n = fs.readSync(fd, page1, 0, PAGE_SIZE, 0);
      fs.closeSync(fd);
      if (n < PAGE_SIZE) continue;
      if (page1.subarray(0, 16).equals(SQLITE_HEADER)) continue;
      const salt = page1.subarray(0, 16).toString("hex").toLowerCase();
      targets.push({ rel, full, salt, page1 });
    } catch {
      /* 忽略无法读取的文件 */
    }
  }
  return targets;
}

/**
 * 扫描本机运行中的全部 Weixin.exe (4.2 / 4.1 / 4.0) 进程可读内存并验证全部数据库密钥
 */
export async function scanWechatKeys({ pid, pids, processName, wxVersion, wxVersionString, dbRoot }) {
  const targetPids = Array.isArray(pids) && pids.length > 0 ? pids : pid ? [pid] : [];
  if (targetPids.length === 0 || !dbRoot || !fs.existsSync(dbRoot)) {
    return {
      ok: false,
      error: "请先在电脑上登录微信，并确保能检测到本地微信数据目录。",
    };
  }

  const targets = collectTargetDbs(dbRoot, wxVersion);
  if (targets.length === 0) {
    return { ok: false, error: "未在微信数据目录中找到加密数据库文件，请确认微信已同步过本地消息。" };
  }

  if (wxVersion !== 4) {
    return {
      ok: false,
      code: "MANUAL_KEY_REQUIRED",
      error: `检测到 ${processName || "微信"} (v${wxVersionString || wxVersion || "?"})，请手动填入 64 位数据库密钥或选择已解密目录以开启全量历史读取。`,
    };
  }

  const uniqueSalts = Array.from(new Set(targets.map((t) => t.salt)));
  const saltCsv = uniqueSalts.join(",");
  const pidCsv = targetPids.join(",");

  // 注意：Windows PowerShell 5.1 的 Add-Type 使用 C# 5.0 编译器，严格保持 C# 5.0 语法
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class WcdbTripleScanner {
  [StructLayout(LayoutKind.Sequential)]
  public struct MEMORY_BASIC_INFORMATION {
    public IntPtr BaseAddress;
    public IntPtr AllocationBase;
    public uint AllocationProtect;
    public IntPtr RegionSize;
    public uint State;
    public uint Protect;
    public uint Type;
  }

  public struct MemRegion {
    public long BaseAddr;
    public long Size;
    public bool IsPrivateRw;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, int dwSize, out IntPtr lpNumberOfBytesRead);

  [DllImport("kernel32.dll")]
  public static extern IntPtr VirtualQueryEx(IntPtr hProcess, IntPtr lpAddress, out MEMORY_BASIC_INFORMATION lpBuffer, uint dwLength);

  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr hObject);

  static bool IsReadableProtect(uint protect) {
    if ((protect & 0x100) != 0) return false;
    uint p = protect & 0xFF;
    return p == 0x02 || p == 0x04 || p == 0x08 || p == 0x10 || p == 0x20 || p == 0x40 || p == 0x80;
  }

  static bool IsPrivateWritable(uint protect, uint type) {
    if ((protect & 0x100) != 0 || type != 0x20000) return false;
    uint p = protect & 0xFF;
    return p == 0x04 || p == 0x08 || p == 0x40 || p == 0x80;
  }

  static bool IsHexByte(byte b) {
    return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F');
  }

  static string ToHex(byte[] buf, int offset, int count) {
    char[] c = new char[count * 2];
    const string hex = "0123456789abcdef";
    for (int i = 0; i < count; i++) {
      byte b = buf[offset + i];
      c[i * 2] = hex[b >> 4];
      c[i * 2 + 1] = hex[b & 0xF];
    }
    return new string(c);
  }

  static byte[] FromHex(string s) {
    byte[] res = new byte[s.Length / 2];
    for (int i = 0; i < res.Length; i++) {
      res[i] = Convert.ToByte(s.Substring(i * 2, 2), 16);
    }
    return res;
  }

  static byte[] ReadExact(IntPtr hProc, long addr, int size) {
    if (size <= 0 || addr < 0x10000L || addr >= 0x7FFFFFFFFFFFL) return null;
    byte[] buf = new byte[size];
    IntPtr read;
    if (!ReadProcessMemory(hProc, (IntPtr)addr, buf, size, out read)) return null;
    if (read.ToInt64() < size) return null;
    return buf;
  }

  static int IndexOfBytes(byte[] data, int from, int end, byte[] needle) {
    int nLen = needle.Length;
    int last = end - nLen;
    if (last < from) return -1;
    byte first = needle[0];
    for (int i = from; i <= last; i++) {
      i = Array.IndexOf(data, first, i, last - i + 1);
      if (i < 0) return -1;
      int j = 1;
      while (j < nLen && data[i + j] == needle[j]) j++;
      if (j == nLen) return i;
    }
    return -1;
  }

  static List<MemRegion> EnumRegions(IntPtr hProc) {
    var list = new List<MemRegion>();
    long addr = 0;
    long maxAddr = 0x7FFFFFFFFFFFL;
    uint mbiSize = (uint)Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
    while (addr < maxAddr) {
      MEMORY_BASIC_INFORMATION mbi;
      if (VirtualQueryEx(hProc, (IntPtr)addr, out mbi, mbiSize) == IntPtr.Zero) break;
      long rSize = mbi.RegionSize.ToInt64();
      if (mbi.State == 0x1000 && IsReadableProtect(mbi.Protect) && rSize > 0 && rSize < 500L * 1024 * 1024) {
        MemRegion r;
        r.BaseAddr = mbi.BaseAddress.ToInt64();
        r.Size = rSize;
        r.IsPrivateRw = IsPrivateWritable(mbi.Protect, mbi.Type);
        list.Add(r);
      }
      long next = mbi.BaseAddress.ToInt64() + rSize;
      if (next <= addr) break;
      addr = next;
    }
    return list;
  }

  public static string ScanPids(string pidsCsv, string saltsCsv) {
    var sw = Stopwatch.StartNew();
    var sb = new StringBuilder();
    var pids = new List<int>();
    foreach (string psPart in pidsCsv.Split(',')) {
      int pVal;
      if (int.TryParse(psPart.Trim(), out pVal) && pVal > 0) pids.Add(pVal);
    }

    byte[] needle = Encoding.ASCII.GetBytes("com.Tencent.WCDB.Config.Cipher");
    int needleLen = needle.Length; // 30

    // SQLCipher 4 codec_ctx 28 字节特征：[256000, 2, 16, 32, 16, 16, 4096]
    int[] codecFields = new int[] { 256000, 2, 16, 32, 16, 16, 4096 };
    byte[] codecSig = new byte[28];
    for (int f = 0; f < codecFields.Length; f++) {
      Buffer.BlockCopy(BitConverter.GetBytes(codecFields[f]), 0, codecSig, f * 4, 4);
    }

    var saltSet = new HashSet<string>();
    var saltBytesList = new List<byte[]>();
    var saltHexList = new List<string>();
    foreach (string rawS in saltsCsv.Split(',')) {
      string sl = rawS.Trim().ToLowerInvariant();
      if (sl.Length == 32 && saltSet.Add(sl)) {
        saltHexList.Add(sl);
        saltBytesList.Add(FromHex(sl));
      }
    }

    int chunkSize = 2 * 1024 * 1024;
    int overlap = 256;

    var emittedBlobs = new HashSet<string>();
    var emittedKeys = new HashSet<string>();
    var emittedRaws = new HashSet<string>();
    int openedCount = 0;
    int totalNeedles = 0;
    int totalNodes = 0;
    int totalCodecs = 0;
    int codecMatches = 0;

    foreach (int pid in pids) {
      IntPtr hProc = OpenProcess(0x0410, false, pid);
      if (hProc == IntPtr.Zero) continue;
      openedCount++;

      try {
        List<MemRegion> regions = EnumRegions(hProc);
        var needleAddrs = new HashSet<ulong>();
        byte[] chunkBuf = new byte[chunkSize];

        // Pass 1：同步执行引擎 A (codec_ctx) + 搜集 Config.Cipher 锚点 + 引擎 C (salt 邻近 & 4.0.x 明文)
        foreach (MemRegion reg in regions) {
          long offset = 0;
          byte[] tail = new byte[0];
          long tailBase = reg.BaseAddr;
          while (offset < reg.Size) {
            int toRead = (int)Math.Min((long)chunkSize, reg.Size - offset);
            IntPtr read;
            if (!ReadProcessMemory(hProc, (IntPtr)(reg.BaseAddr + offset), chunkBuf, toRead, out read) || read.ToInt64() <= 0) {
              tail = new byte[0];
              offset += toRead;
              continue;
            }
            int readLen = (int)read.ToInt64();
            int totalLen = tail.Length + readLen;
            byte[] data;
            long dataBase;
            if (tail.Length > 0) {
              data = new byte[totalLen];
              Buffer.BlockCopy(tail, 0, data, 0, tail.Length);
              Buffer.BlockCopy(chunkBuf, 0, data, tail.Length, readLen);
              dataBase = tailBase;
            } else {
              data = chunkBuf;
              dataBase = reg.BaseAddr + offset;
            }

            // 1a) 查找 com.Tencent.WCDB.Config.Cipher 锚点地址
            int pNeedle = 0;
            while (pNeedle < totalLen) {
              int hit = IndexOfBytes(data, pNeedle, totalLen, needle);
              if (hit < 0) break;
              needleAddrs.Add((ulong)(dataBase + hit));
              pNeedle = hit + needleLen;
            }

            // 1b) 引擎 A：仅在私有读写堆内存扫描 SQLCipher 4 codec_ctx 结构体（版本无关，通杀 4.1 / 4.2.1.11+）
            if (reg.IsPrivateRw) {
              int pCodec = 0;
              while (pCodec < totalLen) {
                int hit = IndexOfBytes(data, pCodec, totalLen, codecSig);
                if (hit < 0) break;
                totalCodecs++;
                long ctxBase = dataBase + hit - 4;
                byte[] ctx = ReadExact(hProc, ctxBase, 160);
                if (ctx != null) {
                  int[] saltOffsets = new int[] { 56, 64, 72, 80, 88 };
                  foreach (int sOff in saltOffsets) {
                    if (sOff + 8 > ctx.Length) continue;
                    ulong sPtr = BitConverter.ToUInt64(ctx, sOff);
                    byte[] refSalt = ReadExact(hProc, (long)sPtr, 16);
                    if (refSalt == null) continue;
                    string refSaltHex = ToHex(refSalt, 0, 16);
                    if (!saltSet.Contains(refSaltHex)) continue;
                    codecMatches++;

                    int[] cipherPtrOffsets = new int[] { sOff + 24, sOff + 32, sOff + 40, sOff + 48 };
                    foreach (int cOff in cipherPtrOffsets) {
                      if (cOff + 8 > ctx.Length) continue;
                      ulong cPtr = BitConverter.ToUInt64(ctx, cOff);
                      byte[] cipher = ReadExact(hProc, (long)cPtr, 64);
                      if (cipher == null) continue;

                      // 尝试 cipher_ctx 内部指向 32B 原始 AES Key 与 99B Config.Cipher blob 的指针
                      for (int kOff = 8; kOff <= 56; kOff += 8) {
                        ulong kPtr = BitConverter.ToUInt64(cipher, kOff);
                        byte[] rawKey = ReadExact(hProc, (long)kPtr, 32);
                        if (rawKey != null) {
                          string kh = ToHex(rawKey, 0, 32);
                          string line = refSaltHex + ":" + kh;
                          if (emittedKeys.Add(line)) {
                            sb.Append("KEY32:").Append(line).AppendLine();
                          }
                        }
                        if (kOff == 32 || BitConverter.ToInt32(ctx, 32) == 99) {
                          byte[] blob99 = ReadExact(hProc, (long)kPtr, 99);
                          if (blob99 != null) {
                            string b64 = Convert.ToBase64String(blob99);
                            if (emittedBlobs.Add(b64)) {
                              sb.Append("BLOB:").Append(b64).AppendLine();
                            }
                          }
                        }
                      }
                    }
                  }
                }
                pCodec = hit + codecSig.Length;
              }

              // 1c) 引擎 C-1：堆中查找精确 16B 二进制 salt，检查紧邻的 32B 原始 key 槽位
              if (emittedKeys.Count < 3000) {
                for (int si = 0; si < saltBytesList.Count; si++) {
                  byte[] sNeedle = saltBytesList[si];
                  string sHex = saltHexList[si];
                  int psIdx = 0;
                  while (psIdx < totalLen) {
                    int hit = IndexOfBytes(data, psIdx, totalLen, sNeedle);
                    if (hit < 0) break;
                    int[] relOffs = new int[] { hit - 32, hit - 40, hit - 48, hit + 16, hit + 24, hit + 32 };
                    foreach (int p in relOffs) {
                      if (p >= 0 && p + 32 <= totalLen) {
                        string kh = ToHex(data, p, 32);
                        string line = sHex + ":" + kh;
                        if (emittedKeys.Add(line)) {
                          sb.Append("KEY32:").Append(line).AppendLine();
                        }
                      }
                    }
                    psIdx = hit + 16;
                  }
                }
              }
            }

            // 1d) 引擎 C-2：4.0.x 明文 x'<96..192 hex>' 扫描
            if (emittedRaws.Count < 4000) {
              int limitRaw = totalLen - 99;
              for (int i = 0; i <= limitRaw; i++) {
                if ((data[i] == 'x' || data[i] == 'X') && data[i + 1] == 39) {
                  int k = i + 2;
                  int maxK = Math.Min(totalLen, i + 195);
                  while (k < maxK && IsHexByte(data[k])) k++;
                  int hexLen = k - (i + 2);
                  if (hexLen >= 96 && hexLen <= 192 && k < totalLen && data[k] == 39) {
                    string h = Encoding.ASCII.GetString(data, i + 2, hexLen).ToLowerInvariant();
                    if (emittedRaws.Add(h)) {
                      sb.Append("RAW:").Append(h).AppendLine();
                    }
                    i = k;
                  }
                }
              }
            }

            if (sw.Elapsed.TotalSeconds > 45.0) break;
            int keep = Math.Min(overlap, totalLen);
            tail = new byte[keep];
            Buffer.BlockCopy(data, totalLen - keep, tail, 0, keep);
            tailBase = dataBase + (totalLen - keep);
            offset += toRead;
          }
        }

        totalNeedles += needleAddrs.Count;
        if (needleAddrs.Count == 0) continue;

        // Pass 2（引擎 B：Config.Cipher 对象扫描，兼容 4.1.x & 4.2.x）
        var seenConfigPtrs = new HashSet<ulong>();
        foreach (MemRegion reg in regions) {
          long offset = 0;
          byte[] tail = new byte[0];
          long tailBase = reg.BaseAddr;
          while (offset < reg.Size) {
            int toRead = (int)Math.Min((long)chunkSize, reg.Size - offset);
            IntPtr read;
            if (!ReadProcessMemory(hProc, (IntPtr)(reg.BaseAddr + offset), chunkBuf, toRead, out read) || read.ToInt64() <= 0) {
              tail = new byte[0];
              offset += toRead;
              continue;
            }
            int readLen = (int)read.ToInt64();
            int totalLen = tail.Length + readLen;
            byte[] data;
            long dataBase;
            if (tail.Length > 0) {
              data = new byte[totalLen];
              Buffer.BlockCopy(tail, 0, data, 0, tail.Length);
              Buffer.BlockCopy(chunkBuf, 0, data, tail.Length, readLen);
              dataBase = tailBase;
            } else {
              data = chunkBuf;
              dataBase = reg.BaseAddr + offset;
            }

            int limitPair = totalLen - 16;
            for (int i = 0; i <= limitPair; i++) {
              if (data[i + 8] != 30 || data[i + 9] != 0 || data[i + 10] != 0 || data[i + 11] != 0 ||
                  data[i + 12] != 0 || data[i + 13] != 0 || data[i + 14] != 0 || data[i + 15] != 0) {
                continue;
              }
              ulong ptr = BitConverter.ToUInt64(data, i);
              if (!needleAddrs.Contains(ptr)) continue;

              long qaddr = dataBase + i;
              byte[] node = ReadExact(hProc, qaddr - 0x10, 0x50);
              if (node == null || node.Length < 0x40) continue;
              if (!needleAddrs.Contains(BitConverter.ToUInt64(node, 0x10)) || BitConverter.ToUInt64(node, 0x18) != 30UL) continue;

              ulong configPtr = BitConverter.ToUInt64(node, 0x28);
              if (configPtr < 0x10000UL || configPtr >= 0x800000000000UL) continue;
              totalNodes++;
              if (!seenConfigPtrs.Add(configPtr)) continue;

              // 检查标准 +0x88 以及 4.2.x 可能的临近偏移 (+0x80, +0x90, +0x98)
              ulong[] objOffs = new ulong[] { 0x88UL, 0x80UL, 0x90UL, 0x98UL };
              foreach (ulong oOff in objOffs) {
                byte[] obj = ReadExact(hProc, (long)(configPtr + oOff), 0x28);
                if (obj == null || obj.Length < 0x18) continue;
                ulong dataPtr = BitConverter.ToUInt64(obj, 0x8);
                ulong dataLen = BitConverter.ToUInt64(obj, 0x10);
                if (dataLen == 0UL || dataLen > 1024UL || dataPtr < 0x10000UL || dataPtr >= 0x800000000000UL) continue;

                byte[] blob = ReadExact(hProc, (long)dataPtr, (int)dataLen);
                if (blob == null) continue;
                string b64 = Convert.ToBase64String(blob);
                if (emittedBlobs.Add(b64)) {
                  sb.Append("BLOB:").Append(b64).AppendLine();
                }
              }
            }

            if (sw.Elapsed.TotalSeconds > 50.0) break;
            int keep = Math.Min(128, totalLen);
            tail = new byte[keep];
            Buffer.BlockCopy(data, totalLen - keep, tail, 0, keep);
            tailBase = dataBase + (totalLen - keep);
            offset += toRead;
          }
        }
      } finally {
        CloseHandle(hProc);
      }
    }

    if (openedCount == 0) return "ERR_ACCESS";
    sb.Append("STATS:opened=").Append(openedCount)
      .Append(",ms=").Append((long)sw.ElapsedMilliseconds)
      .Append(",codecs=").Append(totalCodecs)
      .Append(",codecSaltHits=").Append(codecMatches)
      .Append(",needles=").Append(totalNeedles)
      .Append(",nodes=").Append(totalNodes)
      .Append(",blobs=").Append(emittedBlobs.Count)
      .Append(",keys32=").Append(emittedKeys.Count)
      .Append(",raws=").Append(emittedRaws.Count)
      .AppendLine();
    return sb.ToString();
  }
}
"@
Write-Output ([WcdbTripleScanner]::ScanPids('${pidCsv}', '${saltCsv}'))
`;

  try {
    const out = await runPowerShellFile(ps, 65000);
    if (out === "ERR_ACCESS") {
      return {
        ok: false,
        code: "NEED_ADMIN_OR_KEY",
        error: "读取本机微信内存需要与微信同级权限（请右键「以管理员身份运行」车车 CRM 后再点扫描），或在下方手动填入 64 位密钥。",
      };
    }

    const key32Candidates = [];
    const blobCandidates = [];
    const rawCandidates = [];
    let statsLine = "";

    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith("KEY32:")) {
        const rest = line.slice(6).trim().toLowerCase();
        const sep = rest.indexOf(":");
        if (sep === 32 && rest.length === 97) {
          key32Candidates.push({ embeddedSalt: rest.slice(0, 32), encKeyHex: rest.slice(33) });
        }
      } else if (line.startsWith("BLOB:")) {
        const blob = Buffer.from(line.slice(5).trim(), "base64");
        for (const c of extractConfigCipherCandidates(blob, uniqueSalts)) {
          blobCandidates.push(c);
        }
      } else if (line.startsWith("RAW:")) {
        const hex = line.slice(4).trim().toLowerCase();
        if (hex.length >= 96) {
          rawCandidates.push({ encKeyHex: hex.slice(0, 64), embeddedSalt: hex.slice(64, 96) });
        }
      } else if (line.startsWith("STATS:")) {
        statsLine = line.slice(6).trim();
      }
    }

    const remainingSalts = new Set(uniqueSalts);
    const saltToKey = new Map();
    const methodsUsed = new Set();

    const tryCandidates = (list, label) => {
      const seen = new Set();
      for (const { encKeyHex, embeddedSalt } of list) {
        if (remainingSalts.size === 0) break;
        const dedup = `${encKeyHex}:${embeddedSalt || ""}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        const encKey = Buffer.from(encKeyHex, "hex");
        if (!isProbable32ByteKey(encKey)) continue;

        const saltOrder = embeddedSalt && remainingSalts.has(embeddedSalt) ? [embeddedSalt] : Array.from(remainingSalts);
        for (const salt of saltOrder) {
          if (!remainingSalts.has(salt)) continue;
          const target = targets.find((t) => t.salt === salt);
          if (target && verifyRawEncKey(encKey, target.page1)) {
            saltToKey.set(salt, encKeyHex);
            remainingSalts.delete(salt);
            methodsUsed.add(label);
          }
        }
      }
    };

    // 依次验证：引擎 A (codec_ctx 原始 32B Key) → 引擎 B (Config.Cipher + 已知明文自解 XOR) → 引擎 C (4.0.x 明文 raw)
    tryCandidates(key32Candidates, "codec-ctx");
    if (remainingSalts.size > 0) tryCandidates(blobCandidates, "config-cipher");
    if (remainingSalts.size > 0) tryCandidates(rawCandidates, "legacy-raw");

    const keyMap = {};
    let firstValidKey = null;
    for (const t of targets) {
      const k = saltToKey.get(t.salt);
      if (k) {
        keyMap[t.rel] = k;
        if (!firstValidKey) firstValidKey = k;
      }
    }

    const count = Object.keys(keyMap).length;
    if (count > 0) {
      return {
        ok: true,
        wxVersion: 4,
        wxVersionString: wxVersionString || null,
        method: Array.from(methodsUsed).join("+") || "codec-ctx",
        dbKey: firstValidKey,
        keyMap,
        matchedCount: count,
        totalCount: targets.length,
        diagnostics: statsLine,
      };
    }

    return {
      ok: false,
      code: "WX4_NO_MEM_KEY",
      error: `已对微信 ${wxVersionString || "4.x"} 执行三引擎纯只读扫描（codec_ctx + Config.Cipher 自解掩码 + 原始 salt 邻近，诊断：${statsLine || "无"}），但暂未命中。请确认：① 微信已登录且刚点开过一个聊天窗口（触发打开 message_0.db）；② 若权限不足请右键「以管理员身份运行」车车 CRM 后重试。`,
    };
  } catch (e) {
    return {
      ok: false,
      error: `自动扫描失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
