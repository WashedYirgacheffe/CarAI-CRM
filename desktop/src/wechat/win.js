// Windows 平台微信本地桥接适配器（零注入、零 Hook、单次原子 Win32 焦点定位防串框）
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { clipboard } from "electron";

const execFileAsync = promisify(execFile);

export async function runPowerShell(script, timeoutMs = 15000) {
  // 写入临时 .ps1（UTF-8 BOM）执行，彻底避免 Windows 32767 字符命令行长度上限（spawn ENAMETOOLONG）
  const tmpFile = path.join(os.tmpdir(), `cheche-wx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
  fs.writeFileSync(tmpFile, `\uFEFF${script}`, "utf8");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", tmpFile],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
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

function isRawWxid(v) {
  return typeof v === "string" && /^wxid_[a-z0-9_-]{4,}$/i.test(v.trim());
}

/** 扫描指定根目录下活跃的微信账号数据目录（兼容 4.x db_storage 与 3.x Msg） */
function findActiveAccountDir(rootDir, versionHint) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    const candidates = [];
    for (const d of entries) {
      if (/^(All Users|Applet|WMPF|Backup)$/i.test(d.name)) continue;
      const full = path.join(rootDir, d.name);
      const v4Db = path.join(full, "db_storage");
      const v3Msg = path.join(full, "Msg");
      if (fs.existsSync(v4Db)) {
        const stat = fs.statSync(v4Db);
        candidates.push({ accountDir: full, dbRoot: v4Db, wxVersion: 4, wxid: d.name, mtime: stat.mtimeMs });
      } else if (fs.existsSync(v3Msg)) {
        const stat = fs.statSync(v3Msg);
        candidates.push({ accountDir: full, dbRoot: v3Msg, wxVersion: 3, wxid: d.name, mtime: stat.mtimeMs });
      }
    }
    candidates.sort((a, b) => {
      if (versionHint && a.wxVersion !== b.wxVersion) return a.wxVersion === versionHint ? -1 : 1;
      return b.mtime - a.mtime;
    });
    return candidates[0] || null;
  } catch {
    return null;
  }
}

/** 检测 Windows 上微信 4.x / 3.x 数据目录、账号子目录及运行状态 */
export async function detectWechat() {
  const home = os.homedir();
  const v4Default = path.join(home, "Documents", "xwechat_files");
  const v3Default = path.join(home, "Documents", "WeChat Files");

  let processName = null;
  let pid = null;
  let pids = [];
  let wxVersionString = null;
  try {
    const out = await runPowerShell(`
      $ps = @(Get-Process -Name Weixin -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending)
      if ($ps.Count -eq 0) { $ps = @(Get-Process -Name WeChat -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending) }
      foreach ($p in $ps) {
        $ver = ''
        try { $ver = $p.MainModule.FileVersionInfo.ProductVersion } catch {}
        Write-Output "$($p.ProcessName)|$($p.Id)|$ver"
      }
    `);
    for (const line of out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      if (!line.includes("|")) continue;
      const [name, id, ver] = line.split("|");
      const numId = Number(id);
      if (!numId) continue;
      if (!processName) {
        processName = name.trim();
        pid = numId;
      }
      if (!wxVersionString && ver && ver.trim()) {
        wxVersionString = ver.trim();
      }
      if (!pids.includes(numId)) pids.push(numId);
    }
  } catch {
    /* 忽略 */
  }

  const versionHint = processName === "Weixin" ? 4 : processName === "WeChat" ? 3 : null;

  // 读取微信 4.x 本地 ini 配置与注册表自定义路径
  const roots = [];
  if (fs.existsSync(v4Default)) roots.push(v4Default);
  if (fs.existsSync(v3Default)) roots.push(v3Default);
  try {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    const xwxConfigDir = path.join(appData, "Tencent", "xwechat", "config");
    if (fs.existsSync(xwxConfigDir)) {
      for (const f of fs.readdirSync(xwxConfigDir)) {
        if (!f.toLowerCase().endsWith(".ini")) continue;
        try {
          const content = fs.readFileSync(path.join(xwxConfigDir, f), "utf8").trim().replace(/\0/g, "");
          if (content && fs.existsSync(content)) {
            const sub = path.join(content, "xwechat_files");
            if (fs.existsSync(sub) && !roots.includes(sub)) roots.push(sub);
            if (!roots.includes(content)) roots.push(content);
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const regOut = await runPowerShell(`
      $paths = @()
      $p4 = (Get-ItemProperty -Path 'HKCU:\\Software\\Tencent\\Weixin' -ErrorAction SilentlyContinue).FileSavePath
      if ($p4 -and $p4 -ne 'MyDocument:') { $paths += (Join-Path $p4 'xwechat_files'); $paths += $p4 }
      $p3 = (Get-ItemProperty -Path 'HKCU:\\Software\\Tencent\\WeChat' -ErrorAction SilentlyContinue).FileSavePath
      if ($p3 -and $p3 -ne 'MyDocument:') { $paths += (Join-Path $p3 'WeChat Files'); $paths += $p3 }
      $paths | Select-Object -Unique | ForEach-Object { Write-Output $_ }
    `);
    for (const line of regOut.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      if (fs.existsSync(line) && !roots.includes(line)) roots.push(line);
    }
  } catch {
    /* 忽略注册表读取 */
  }

  let active = null;
  for (const r of roots) {
    const found = findActiveAccountDir(r, versionHint);
    if (found && (!active || (versionHint && found.wxVersion === versionHint && active.wxVersion !== versionHint) || found.mtime > active.mtime)) {
      active = found;
    }
  }

  const dataDir = active?.accountDir || roots[0] || null;
  const wechatRunning = !!processName;
  const wechatInstalled = !!dataDir || wechatRunning;

  return {
    platform: "win32",
    wechatInstalled,
    wechatRunning,
    processName,
    pid,
    pids,
    wxVersion: active?.wxVersion || versionHint || null,
    wxVersionString,
    wxid: active?.wxid || null,
    dataDir,
    dbRoot: active?.dbRoot || null,
  };
}

/**
 * Windows 半自动一键上屏（v0.2.7 彻底重构：单次原子执行 + 物理点击右侧输入区防粘贴进搜索框）
 *
 * 铁血规则：
 * 1) 绝不拿原始 wxid_xxx 去搜（微信搜索框根本搜不到原始 wxid，会导致焦点留在搜索框！）
 * 2) 单次 PowerShell 原子执行：AttachThreadInput 强力置顶 → 可选搜索定位 → 点击右侧聊天输入区安全坐标 → 粘贴正文
 * 3) 绝不按最终 Enter，由业务员核对上方联系人姓名/头像后亲手按回车发送
 */
export async function stageSend({ searchKey, text, autoLocate }) {
  const body = String(text || "");
  if (!body.trim()) return { ok: false, error: "发送内容为空" };

  // 先写入正文到剪贴板兜底
  clipboard.writeText(body);

  const rawKey = autoLocate && searchKey ? String(searchKey).trim() : "";
  const skippedRawWxid = isRawWxid(rawKey);
  const key = skippedRawWxid ? "" : rawKey;

  // 通过 Base64 传参进单次 PowerShell，彻底规避中文/引号/换行符转义问题
  const bodyB64 = Buffer.from(body, "utf8").toString("base64");
  const keyB64 = Buffer.from(key, "utf8").toString("base64");

  const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WxFocus {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr lpdwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);

  public static void ForceForeground(IntPtr hWnd) {
    AllowSetForegroundWindow(-1);
    if (IsIconic(hWnd)) ShowWindowAsync(hWnd, 9);
    else ShowWindowAsync(hWnd, 5);
    IntPtr fg = GetForegroundWindow();
    uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, IntPtr.Zero) : 0;
    uint wxThread = GetWindowThreadProcessId(hWnd, IntPtr.Zero);
    uint myThread = GetCurrentThreadId();
    if (fgThread != 0 && fgThread != myThread) AttachThreadInput(myThread, fgThread, true);
    if (wxThread != 0 && wxThread != myThread) AttachThreadInput(myThread, wxThread, true);
    // Z-order 临时置顶再取消置顶，防止 PowerShell 退出后微信闪退回后台
    SetWindowPos(hWnd, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
    SetWindowPos(hWnd, new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
    BringWindowToTop(hWnd);
    SetForegroundWindow(hWnd);
    if (wxThread != 0 && wxThread != myThread) AttachThreadInput(myThread, wxThread, false);
    if (fgThread != 0 && fgThread != myThread) AttachThreadInput(myThread, fgThread, false);
  }

  public static void ClickAt(int x, int y) {
    POINT prev;
    GetCursorPos(out prev);
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); // LEFTDOWN
    System.Threading.Thread.Sleep(35);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); // LEFTUP
    System.Threading.Thread.Sleep(60);
    SetCursorPos(prev.X, prev.Y);
  }
}
"@

function Set-Clip([string]$s) {
  for ($i = 0; $i -lt 5; $i++) {
    try {
      [System.Windows.Forms.Clipboard]::SetText($s, [System.Windows.Forms.TextDataFormat]::UnicodeText)
      return
    } catch {
      Start-Sleep -Milliseconds 60
    }
  }
}

$bodyText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${bodyB64}'))
$searchText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${keyB64}'))

# 查找微信主窗口（兼容 4.0 Weixin 与 3.9 WeChat，取尺寸最大的可见主窗口）
$procs = @(Get-Process -Name Weixin,WeChat -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($procs.Count -eq 0) {
  Set-Clip $bodyText
  Write-Output "NOT_FOUND"
  exit 0
}
$h = $procs[0].MainWindowHandle
[WxFocus]::ForceForeground($h)
Start-Sleep -Milliseconds 220

$rect = New-Object WxFocus+RECT
[void][WxFocus]::GetWindowRect($h, [ref]$rect)
$w = $rect.Right - $rect.Left
$ht = $rect.Bottom - $rect.Top

if (-not [string]::IsNullOrWhiteSpace($searchText)) {
  # 切忌发送 {ESC}！微信 4.2 主窗口按 ESC 会直接隐藏最小化到托盘！
  # 直接触发 Ctrl+F 打开搜索框，清空后粘贴搜索词并回车选中首个联系人
  [System.Windows.Forms.SendKeys]::SendWait('^f')
  Start-Sleep -Milliseconds 220
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Start-Sleep -Milliseconds 60
  [System.Windows.Forms.SendKeys]::SendWait('{BACKSPACE}')
  Start-Sleep -Milliseconds 60
  Set-Clip $searchText
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  # 等待微信 4.x 渲染联系人搜索结果
  Start-Sleep -Milliseconds 720
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 380
}

# 2) 核心防串框：物理点击右侧聊天输入区安全坐标（65% 宽, 距底边 88px），彻底脱离左上角搜索框并把 Windows 前台归属权牢牢交给微信！
if ($w -gt 420 -and $ht -gt 320) {
  $inputX = [int]($rect.Left + [math]::Round($w * 0.65))
  $inputY = [int]($rect.Bottom - 88)
  [WxFocus]::ClickAt($inputX, $inputY)
  Start-Sleep -Milliseconds 160
}

# 3) 写入正文到剪贴板并粘贴进聊天输入框（绝不按最终 Enter）
Set-Clip $bodyText
Start-Sleep -Milliseconds 80
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 60
[WxFocus]::ForceForeground($h)
Write-Output ($(if ([string]::IsNullOrWhiteSpace($searchText)) { "PASTED" } else { "LOCATED_AND_PASTED" }))
`;

  try {
    const res = await runPowerShell(psScript, 15000);
    if (res === "NOT_FOUND") {
      return {
        ok: true,
        mode: "clipboard_only",
        hint: "未检测到打开的微信主窗口（请确保微信未最小化到托盘），正文已复制，打开微信后按 Ctrl+V 即可",
      };
    }
    if (res === "LOCATED_AND_PASTED") {
      return {
        ok: true,
        mode: "located_and_pasted",
        hint: `已定位「${key}」并点击右侧聊天输入框粘贴正文，请核对联系人后按 Enter 发送`,
      };
    }
    return {
      ok: true,
      mode: "pasted",
      hint: skippedRawWxid
        ? "原定位词为内部 wxid（微信不支持搜索），已直接粘贴到当前聊天输入框，请核对联系人后按 Enter 发送"
        : "已唤起微信并粘贴到右侧聊天输入框，请核对联系人后按 Enter 发送",
    };
  } catch (e) {
    clipboard.writeText(body);
    return {
      ok: true,
      mode: "clipboard_fallback",
      hint: `自动粘贴未完成（${e instanceof Error ? e.message.slice(0, 60) : "权限受限"}），正文已复制到剪贴板，请直接 Ctrl+V`,
    };
  }
}
