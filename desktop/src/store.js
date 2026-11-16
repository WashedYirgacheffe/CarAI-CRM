// 本机保存的配对信息：设备 id（明文）+ 设备令牌（用 macOS 钥匙串加密，safeStorage）
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";

const file = () => path.join(app.getPath("userData"), "device.json");

export function loadDevice() {
  try {
    const d = JSON.parse(fs.readFileSync(file(), "utf8"));
    let token = null;
    if (d.tokenEnc && safeStorage.isEncryptionAvailable()) {
      try {
        token = safeStorage.decryptString(Buffer.from(d.tokenEnc, "base64"));
      } catch {
        token = null;
      }
    }
    return { deviceId: d.deviceId ?? null, token, userId: d.userId ?? null };
  } catch {
    return { deviceId: null, token: null, userId: null };
  }
}

export function saveDevice({ deviceId, token, userId }) {
  const tokenEnc = token && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token).toString("base64") : null;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ deviceId, userId, tokenEnc }), { mode: 0o600 });
}

/** 令牌失效（设备被移除 / 换了用户）：只清令牌，设备 id 留着，重新配对时沿用 */
export function clearToken() {
  const d = loadDevice();
  saveDevice({ deviceId: d.deviceId, userId: d.userId, token: null });
}
