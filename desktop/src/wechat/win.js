// Windows 平台微信本地桥接适配器（零注入、零 Hook、零原生编译依赖）
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { clipboard } from "electron";

const execFileAsync = promisify(execFile);

function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function runPowerShell(script, timeoutMs = 12000) {
  const encoded = encodePowerShell(script);
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
    { timeout: timeoutMs, windowsHide: true },
  );
  return stdout.trim();
}

/** 检测 Windows 上微信 3.x / 4.x 数据目录及运行状态 */
export async function detectWechat() {
  const home = os.homedir();
  const candidates = [
    path.join(home, "Documents", "xwechat_files"), // 微信 4.x
    path.join(home, "Documents", "WeChat Files"), // 微信 3.x
  ];

  let dataDir = candidates.find((p) => fs.existsSync(p)) || null;

  // 尝试从注册表读取自定义存储路径
  if (!dataDir) {
    try {
      const regPath = await runPowerShell(`
        $p = (Get-ItemProperty -Path 'HKCU:\\Software\\Tencent\\Weixin' -ErrorAction SilentlyContinue).FileSavePath
        if (-not $p) { $p = (Get-ItemProperty -Path 'HKCU:\\Software\\Tencent\\WeChat' -ErrorAction SilentlyContinue).FileSavePath }
        if ($p -and $p -ne 'MyDocument:') { Write-Output $p }
      `);
      if (regPath && fs.existsSync(regPath)) dataDir = regPath;
    } catch {
      /* 忽略注册表读取失败 */
    }
  }

  let wechatRunning = false;
  try {
    const out = await runPowerShell(`
      $proc = Get-Process -Name Weixin,WeChat -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($proc) { Write-Output "1" } else { Write-Output "0" }
    `);
    wechatRunning = out === "1";
  } catch {
    wechatRunning = false;
  }

  const wechatInstalled = !!dataDir || wechatRunning;
  return { platform: "win32", wechatInstalled, wechatRunning, dataDir };
}

/**
 * Windows 半自动一键上屏：
 * 1) 唤起正版微信主窗口（兼容微信 4.0 Weixin.exe 与 3.9 WeChat.exe）
 * 2) 可选按唯一搜索词（微信号/备注）Ctrl+F 定位并打开会话
 * 3) 将正文粘贴进输入框
 * 4) 绝不按最终 Enter，由业务员核对头像后手动回车发送
 */
export async function stageSend({ searchKey, text, autoLocate }) {
  const body = String(text || "");
  if (!body.trim()) return { ok: false, error: "发送内容为空" };

  // 先写入正文到剪贴板作为兜底，即使后续唤窗失败业务员也能直接粘贴
  clipboard.writeText(body);

  const key = autoLocate && searchKey ? String(searchKey).trim() : "";

  try {
    // 第一步：激活微信主窗口
    const activated = await runPowerShell(`
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class WxWin {
          [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
          [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
          [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        }
"@
      $proc = Get-Process -Name Weixin,WeChat -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if (-not $proc) { Write-Output "NOT_FOUND"; exit 0 }
      $h = $proc.MainWindowHandle
      if ([WxWin]::IsIconic($h)) { [WxWin]::ShowWindowAsync($h, 9) | Out-Null }
      else { [WxWin]::ShowWindowAsync($h, 5) | Out-Null }
      [WxWin]::SetForegroundWindow($h) | Out-Null
      Write-Output "OK"
    `);

    if (activated !== "OK") {
      return {
        ok: true,
        mode: "clipboard_only",
        hint: "未检测到已打开的微信窗口，正文已复制到剪贴板，请打开微信后直接 Ctrl+V 粘贴发送",
      };
    }

    if (key) {
      // 第二步：先用剪贴板粘贴搜索词定位联系人（避开输入法干扰）
      clipboard.writeText(key);
      await runPowerShell(`
        Add-Type -AssemblyName System.Windows.Forms
        Start-Sleep -Milliseconds 180
        [System.Windows.Forms.SendKeys]::SendWait('^f')
        Start-Sleep -Milliseconds 220
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        Start-Sleep -Milliseconds 80
        [System.Windows.Forms.SendKeys]::SendWait('^v')
        Start-Sleep -Milliseconds 520
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
      `);
      // 第三步：恢复正文到剪贴板并粘贴进输入框（绝不按最终 Enter）
      clipboard.writeText(body);
      await runPowerShell(`
        Add-Type -AssemblyName System.Windows.Forms
        Start-Sleep -Milliseconds 240
        [System.Windows.Forms.SendKeys]::SendWait('^v')
      `);
      return {
        ok: true,
        mode: "located_and_pasted",
        hint: `已定位「${key}」并粘贴到微信输入框，请核对对方头像后按 Enter 发送`,
      };
    }

    // 不自动搜索：直接粘贴到当前打开的微信对话框
    await runPowerShell(`
      Add-Type -AssemblyName System.Windows.Forms
      Start-Sleep -Milliseconds 180
      [System.Windows.Forms.SendKeys]::SendWait('^v')
    `);
    return {
      ok: true,
      mode: "pasted",
      hint: "已唤起微信并粘贴到当前输入框，请核对联系人后按 Enter 发送",
    };
  } catch {
    clipboard.writeText(body);
    return {
      ok: true,
      mode: "clipboard_fallback",
      hint: "内容已复制到剪贴板，请切到微信按 Ctrl+V 粘贴发送",
    };
  }
}
