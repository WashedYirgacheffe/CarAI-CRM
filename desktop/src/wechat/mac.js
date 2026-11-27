// macOS 平台微信本地桥接适配器（预留与基础可用实现，无需关闭 SIP）
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { clipboard } from "electron";

const execFileAsync = promisify(execFile);

export async function detectWechat() {
  const home = os.homedir();
  const dataDirCandidates = [
    path.join(home, "Library", "Containers", "com.tencent.xinWeChat", "Data", "Library", "Application Support", "com.tencent.xinWeChat"),
  ];
  const dataDir = dataDirCandidates.find((p) => fs.existsSync(p)) || null;
  const appInstalled = fs.existsSync("/Applications/WeChat.app");

  let wechatRunning = false;
  try {
    await execFileAsync("pgrep", ["-x", "WeChat"]);
    wechatRunning = true;
  } catch {
    wechatRunning = false;
  }

  return {
    platform: "darwin",
    wechatInstalled: appInstalled || !!dataDir || wechatRunning,
    wechatRunning,
    dataDir,
  };
}

/**
 * macOS 半自动一键上屏：
 * 1) 写入正文到剪贴板并唤起微信
 * 2) 若用户已授予 macOS 辅助功能权限，尝试 Cmd+F 定位并 Cmd+V 粘贴（绝不按最终 Enter）
 * 3) 未授权限时优雅降级为「已复制并唤起微信，请按 Cmd+V 粘贴后回车」
 */
export async function stageSend({ searchKey, text, autoLocate }) {
  const body = String(text || "");
  if (!body.trim()) return { ok: false, error: "发送内容为空" };

  clipboard.writeText(body);
  const key = autoLocate && searchKey ? String(searchKey).trim() : "";

  try {
    await execFileAsync("osascript", ["-e", 'tell application "WeChat" to activate'], { timeout: 5000 });
  } catch {
    return {
      ok: true,
      mode: "clipboard_only",
      hint: "正文已复制到剪贴板，请手动打开微信后按 Cmd+V 粘贴发送",
    };
  }

  try {
    if (key) {
      clipboard.writeText(key);
      await execFileAsync(
        "osascript",
        [
          "-e",
          `tell application "System Events"
            delay 0.2
            keystroke "f" using command down
            delay 0.25
            keystroke "a" using command down
            delay 0.08
            keystroke "v" using command down
            delay 0.55
            key code 36
          end tell`,
        ],
        { timeout: 8000 },
      );
      clipboard.writeText(body);
      await execFileAsync(
        "osascript",
        [
          "-e",
          `tell application "System Events"
            delay 0.25
            keystroke "v" using command down
          end tell`,
        ],
        { timeout: 5000 },
      );
      return {
        ok: true,
        mode: "located_and_pasted",
        hint: `已定位「${key}」并粘贴到微信输入框，请核对对方头像后按 Return 发送`,
      };
    }

    await execFileAsync(
      "osascript",
      [
        "-e",
        `tell application "System Events"
          delay 0.2
          keystroke "v" using command down
        end tell`,
      ],
      { timeout: 5000 },
    );
    return {
      ok: true,
      mode: "pasted",
      hint: "已唤起微信并粘贴到当前输入框，请核对联系人后按 Return 发送",
    };
  } catch {
    clipboard.writeText(body);
    return {
      ok: true,
      mode: "clipboard_activated",
      hint: "已唤起微信并复制正文，请按 Cmd+V 粘贴后回车（在系统设置→辅助功能授予车车CRM权限可自动定位粘贴）",
    };
  }
}
