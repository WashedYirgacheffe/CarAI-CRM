// Windows 微信本地只读内存密钥扫描器（仅使用 PROCESS_VM_READ 纯只读 API，绝不写入内存、绝不注入 DLL、绝不 Hook）
import fs from "node:fs";
import path from "node:path";
import { runPowerShell } from "./win.js";
import { detectCipherSpec } from "./db-reader.js";

/** 读取微信数据库文件头部的 16 字节 salt（32 位小写 hex） */
function readDbSaltHex(dbPath) {
  try {
    const fd = fs.openSync(dbPath, "r");
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (n < 16) return null;
    if (buf.toString("ascii") === "SQLite format 3\0") return "PLAIN";
    return buf.toString("hex").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 扫描本机运行中的 Weixin.exe (4.x) 或 WeChat.exe (3.x) 进程可读堆内存，
 * 匹配本地 .db 文件的 salt 提取 SQLCipher 密钥（纯只读 OpenProcess(PROCESS_VM_READ)）。
 */
export async function scanWechatKeys({ pid, processName, wxVersion, dbRoot }) {
  if (!pid || !dbRoot || !fs.existsSync(dbRoot)) {
    return {
      ok: false,
      error: "请先在电脑上登录微信，并确保能检测到本地微信数据目录。",
    };
  }

  // 收集核心数据库文件及其 salt
  const targets = [];
  if (wxVersion === 4) {
    const rels = ["contact/contact.db", "session/session.db"];
    const msgDir = path.join(dbRoot, "message");
    if (fs.existsSync(msgDir)) {
      for (const f of fs.readdirSync(msgDir)) {
        if (/^message_\d+\.db$/i.test(f)) rels.push(`message/${f}`);
      }
    }
    for (const rel of rels) {
      const full = path.join(dbRoot, rel);
      if (!fs.existsSync(full)) continue;
      const salt = readDbSaltHex(full);
      if (salt && salt !== "PLAIN") targets.push({ rel, full, salt });
    }
  } else {
    const micro = path.join(dbRoot, "MicroMsg.db");
    if (fs.existsSync(micro)) {
      const salt = readDbSaltHex(micro);
      if (salt && salt !== "PLAIN") targets.push({ rel: "MicroMsg.db", full: micro, salt });
    }
  }

  if (targets.length === 0) {
    return { ok: false, error: "未在微信数据目录中找到加密数据库文件，请确认微信已同步过本地消息。" };
  }

  // 针对微信 4.x：WCDB 在内存中以 ASCII 字符串 x'<64 hex enc_key><32 hex salt>' 形式缓存 Raw Key
  // 我们用 C# 纯只读 ReadProcessMemory 扫描每个目标 salt 紧邻的前 64 字节 ASCII hex！
  if (wxVersion === 4) {
    const saltList = Array.from(new Set(targets.map((t) => t.salt)));
    const saltJson = Buffer.from(JSON.stringify(saltList), "utf8").toString("base64");

    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class MemKeyScan {
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

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, int dwSize, out IntPtr lpNumberOfBytesRead);

  [DllImport("kernel32.dll")]
  public static extern IntPtr VirtualQueryEx(IntPtr hProcess, IntPtr lpAddress, out MEMORY_BASIC_INFORMATION lpBuffer, uint dwLength);

  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr hObject);

  static bool IsHexByte(byte b) {
    return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F');
  }

  public static string Scan(int pid, string[] salts) {
    // 0x0010 = PROCESS_VM_READ, 0x0400 = PROCESS_QUERY_INFORMATION (纯只读)
    IntPtr hProc = OpenProcess(0x0410, false, pid);
    if (hProc == IntPtr.Zero) return "ERR_ACCESS:" + Marshal.GetLastWin32Error();
    var found = new Dictionary<string, string>();
    var saltBytes = new Dictionary<string, byte[]>();
    foreach (var s in salts) saltBytes[s] = Encoding.ASCII.GetBytes(s);

    try {
      long addr = 0x10000;
      long maxAddr = 0x7FFFFFFFFFFF;
      uint mbiSize = (uint)Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
      while (addr < maxAddr && found.Count < salts.Length) {
        MEMORY_BASIC_INFORMATION mbi;
        if (VirtualQueryEx(hProc, (IntPtr)addr, out mbi, mbiSize) == IntPtr.Zero) break;
        long regionSize = mbi.RegionSize.ToInt64();
        // MEM_COMMIT (0x1000), 可读内存 (PAGE_READWRITE=0x04, PAGE_READONLY=0x02)
        bool readable = mbi.State == 0x1000 && ((mbi.Protect & 0x04) != 0 || (mbi.Protect & 0x02) != 0) && (mbi.Protect & 0x100) == 0;
        if (readable && regionSize > 0 && regionSize <= 64 * 1024 * 1024) {
          byte[] buf = new byte[regionSize];
          IntPtr read;
          if (ReadProcessMemory(hProc, mbi.BaseAddress, buf, (int)regionSize, out read) && read.ToInt64() > 100) {
            int len = (int)read.ToInt64();
            foreach (var kv in saltBytes) {
              if (found.ContainsKey(kv.Key)) continue;
              byte[] needle = kv.Value;
              for (int i = 66; i <= len - needle.Length; i++) {
                bool match = true;
                for (int j = 0; j < needle.Length; j++) {
                  if (buf[i + j] != needle[j]) { match = false; break; }
                }
                if (!match) continue;
                // 检查紧邻其前的 64 字节是否全是 ASCII hex
                bool okHex = true;
                for (int k = i - 64; k < i; k++) {
                  if (!IsHexByte(buf[k])) { okHex = false; break; }
                }
                if (okHex) {
                  found[kv.Key] = Encoding.ASCII.GetString(buf, i - 64, 64).ToLowerInvariant();
                  break;
                }
              }
            }
          }
        }
        long next = mbi.BaseAddress.ToInt64() + regionSize;
        if (next <= addr) break;
        addr = next;
      }
    } finally {
      CloseHandle(hProc);
    }

    var sb = new StringBuilder();
    foreach (var kv in found) {
      sb.Append(kv.Key).Append("=").Append(kv.Value).AppendLine();
    }
    return sb.ToString();
  }
}
"@
$salts = ConvertFrom-Json ([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${saltJson}')))
Write-Output ([MemKeyScan]::Scan(${pid}, [string[]]$salts))
`;

    try {
      const out = await runPowerShell(ps, 25000);
      if (out.startsWith("ERR_ACCESS:")) {
        return {
          ok: false,
          code: "NEED_ADMIN_OR_KEY",
          error: "读取本机微信内存需要与微信同级权限（若微信以管理员运行，请右键「以管理员身份运行」车车 CRM），或在下方手动填入 64 位密钥。",
        };
      }
      const saltToKey = new Map();
      for (const line of out.split(/\r?\n/)) {
        const idx = line.indexOf("=");
        if (idx > 0) saltToKey.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim().toLowerCase());
      }

      const keyMap = {};
      let firstValidKey = null;
      for (const t of targets) {
        const k = saltToKey.get(t.salt);
        if (k && detectCipherSpec(t.full, k)) {
          keyMap[t.rel] = k;
          if (!firstValidKey) firstValidKey = k;
        }
      }

      const count = Object.keys(keyMap).length;
      if (count > 0) {
        return {
          ok: true,
          wxVersion: 4,
          dbKey: firstValidKey,
          keyMap,
          matchedCount: count,
          totalCount: targets.length,
        };
      }

      return {
        ok: false,
        code: "WX4_NO_MEM_KEY",
        error:
          "当前微信 4.0.3.36+ / 4.1 已移除内存常驻密钥，自动扫描未命中。你只需通过 WeFlow / 兼容版本提取一次 64 位密钥（或指定已解密目录）填入下方，保存后即可长期自动读取全部历史记录。",
      };
    } catch (e) {
      return {
        ok: false,
        error: `自动扫描失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  return {
    ok: false,
    code: "MANUAL_KEY_REQUIRED",
    error: `检测到 ${processName || "微信"} (v${wxVersion || "?"})，请手动填入 64 位数据库密钥或选择已解密目录以开启全量历史读取。`,
  };
}
