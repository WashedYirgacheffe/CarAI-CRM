// 社媒收件箱前后端共用：支持收私信的平台、脱敏、话术变量、语言名

/** 能同步私信进收件箱的平台 */
export const INBOX_PLATFORMS = ["tiktok", "instagram", "facebook", "linkedin", "x"] as const;
export type InboxPlatform = (typeof INBOX_PLATFORMS)[number];
export const isInboxPlatform = (p: string): p is InboxPlatform => (INBOX_PLATFORMS as readonly string[]).includes(p);

/** 开了「收私信」的账号多久同步一次 */
export const INBOX_SYNC_EVERY_MS = 10 * 60_000;

export const SOCIAL_MSG_STATUS: Record<string, string> = {
  queued: "等待发送",
  sending: "发送中",
  sent: "已发送",
  failed: "发送失败",
};

// ── 脱敏（没有 matrix.reveal 权限的人看到的） ──

/** @handle → @ab*** */
export function maskHandle(h: string | null | undefined) {
  if (!h) return h ?? null;
  const at = h.startsWith("@") ? "@" : "";
  const name = h.replace(/^@/, "");
  return `${at}${name.slice(0, Math.min(2, Math.max(1, name.length - 2)))}***`;
}

/** 消息里的邮箱、电话号码打码 */
export function maskContacts(text: string) {
  return text
    .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "$1***@$2")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 7) return m;
      return `${m.startsWith("+") ? "+" : ""}${digits.slice(0, 3)}****${digits.slice(-2)}`;
    })
    .replace(/https?:\/\/(?:wa\.me|api\.whatsapp\.com|t\.me)\/\S+/gi, "[联系方式链接已隐藏]");
}

// ── 快捷回复变量 ──

export const QUICK_REPLY_VARS = ["{客户名}", "{联系人}", "{我的名字}", "{公司}"] as const;

export function fillQuickReply(body: string, v: { customer?: string | null; contact?: string | null; me?: string | null; company?: string | null }) {
  return body
    .replaceAll("{客户名}", v.customer || v.contact || "")
    .replaceAll("{联系人}", v.contact || v.customer || "")
    .replaceAll("{我的名字}", v.me || "")
    .replaceAll("{公司}", v.company || "");
}

// ── 语言 ──

const LANG_NAMES: Record<string, string> = {
  en: "英语",
  es: "西班牙语",
  fr: "法语",
  de: "德语",
  pt: "葡萄牙语",
  it: "意大利语",
  ru: "俄语",
  ar: "阿拉伯语",
  tr: "土耳其语",
  ja: "日语",
  ko: "韩语",
  vi: "越南语",
  id: "印尼语",
  ms: "马来语",
  th: "泰语",
  hi: "印地语",
  ur: "乌尔都语",
  fa: "波斯语",
  pl: "波兰语",
  nl: "荷兰语",
  uk: "乌克兰语",
  he: "希伯来语",
  iw: "希伯来语",
  bn: "孟加拉语",
  tl: "菲律宾语",
  fil: "菲律宾语",
  sw: "斯瓦希里语",
  "zh-CN": "中文",
  "zh-TW": "繁体中文",
  zh: "中文",
};
export const langName = (code: string | null | undefined) => (code ? (LANG_NAMES[code] ?? code) : null);
export const isChineseLang = (code: string | null | undefined) => !!code && code.startsWith("zh");
