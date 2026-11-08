import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * 邮箱密码等敏感配置的加密：AES-256-GCM，密钥由环境变量 APP_SECRET 派生。
 * 密文格式：v1:<iv>:<tag>:<data>（均为 base64url）。APP_SECRET 一旦设定不要再改，否则已存的密码无法解密。
 */
function key() {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === "production") throw new Error("未配置 APP_SECRET（至少 16 位），无法加密邮箱密码");
    return createHash("sha256").update("cheche-crm-dev-secret").digest();
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptSecret(enc: string) {
  const [v, iv, tag, data] = enc.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("密文格式不正确");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
