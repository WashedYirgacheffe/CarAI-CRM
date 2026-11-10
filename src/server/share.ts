import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * 发给客户的公开链接（报价单、表单、图片）：客户不用登录，链接里带签名，改了 id 就打不开。
 * 签名密钥由 APP_SECRET 派生；APP_SECRET 改了，之前发出去的链接会失效。
 */
export type ShareKind = "q" | "inquiry" | "shipping" | "img";

function key() {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === "production") throw new Error("未配置 APP_SECRET");
    return "cheche-crm-dev-secret";
  }
  return createHash("sha256").update(`share:${secret}`).digest("hex");
}

const sig = (kind: ShareKind, payload: string) => createHmac("sha256", key()).update(`${kind}:${payload}`).digest("base64url").slice(0, 22);

/** payload 里不能有「.」：用于报价单 id、会话 id（cuid）或文件 key（base64url 编码后） */
export function shareToken(kind: ShareKind, payload: string) {
  return `${payload}.${sig(kind, payload)}`;
}

export function readShareToken(kind: ShareKind, token: string): string | null {
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = token.slice(0, i);
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(sig(kind, payload));
  return a.length === b.length && timingSafeEqual(a, b) ? payload : null;
}

export function appUrl() {
  return (process.env.APP_URL || (process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : "http://localhost:3000")).replace(/\/+$/, "");
}

/** 报价单在线查看链接 */
export const quotationShareUrl = (id: string) => `${appUrl()}/s/q/${shareToken("q", id)}`;

/** 表单链接：绑在 WhatsApp 会话上，客户提交后回到这个会话的负责人 */
export const formShareUrl = (kind: "inquiry" | "shipping", chatId: string) =>
  `${appUrl()}/s/${kind === "inquiry" ? "i" : "ship"}/${shareToken(kind, chatId)}`;

/** 公开页面上的图片：/api/files/<tenantId>/<name> → /s/img/<签名> */
export function publicImageUrl(fileUrl: string | null | undefined) {
  if (!fileUrl) return null;
  const m = /^\/api\/files\/(.+)$/.exec(fileUrl);
  if (!m) return fileUrl;
  return `/s/img/${shareToken("img", Buffer.from(m[1]).toString("base64url"))}`;
}
