/*
 * 社媒平台目录（前后端共用）：识别链接是哪个平台、取账号名、规范化链接；
 * 以及对外聚合主页（Link-in-Bio）的链接结构和配色。
 */

export type SocialPlatform =
  | "linkedin"
  | "facebook"
  | "instagram"
  | "youtube"
  | "tiktok"
  | "x"
  | "pinterest"
  | "vk"
  | "reddit"
  | "threads"
  | "line"
  | "whatsapp"
  | "wechat"
  | "telegram"
  | "email"
  | "website"
  | "other";

export type PlatformInfo = {
  key: SocialPlatform;
  label: string;
  /** 图标底色 */
  color: string;
  /** 识别链接用的域名 */
  hosts: string[];
  /** 能不能不登录自动跟踪更新（YouTube 有公开订阅源；其它平台多数要登录，只能看主页资料有没有变） */
  track: "feed" | "page" | "none";
};

export const PLATFORMS: PlatformInfo[] = [
  { key: "linkedin", label: "LinkedIn", color: "#0a66c2", hosts: ["linkedin.com", "lnkd.in"], track: "page" },
  { key: "facebook", label: "Facebook", color: "#1877f2", hosts: ["facebook.com", "fb.com", "fb.me", "m.facebook.com"], track: "page" },
  { key: "instagram", label: "Instagram", color: "#e1306c", hosts: ["instagram.com", "instagr.am"], track: "page" },
  { key: "youtube", label: "YouTube", color: "#ff0000", hosts: ["youtube.com", "youtu.be"], track: "feed" },
  { key: "tiktok", label: "TikTok", color: "#111111", hosts: ["tiktok.com"], track: "page" },
  { key: "x", label: "X (Twitter)", color: "#111111", hosts: ["x.com", "twitter.com"], track: "page" },
  { key: "pinterest", label: "Pinterest", color: "#e60023", hosts: ["pinterest.com", "pin.it"], track: "page" },
  { key: "vk", label: "VK", color: "#0077ff", hosts: ["vk.com"], track: "page" },
  { key: "reddit", label: "Reddit", color: "#ff4500", hosts: ["reddit.com", "redd.it"], track: "page" },
  { key: "threads", label: "Threads", color: "#111111", hosts: ["threads.com", "threads.net"], track: "page" },
  { key: "line", label: "LINE", color: "#06c755", hosts: ["line.me", "lin.ee", "line.biz"], track: "none" },
  { key: "whatsapp", label: "WhatsApp", color: "#25d366", hosts: ["wa.me", "whatsapp.com", "api.whatsapp.com"], track: "none" },
  { key: "wechat", label: "微信", color: "#07c160", hosts: ["weixin.qq.com", "u.wechat.com"], track: "none" },
  { key: "telegram", label: "Telegram", color: "#229ed9", hosts: ["t.me", "telegram.me"], track: "none" },
  { key: "email", label: "Email", color: "#ea580c", hosts: [], track: "none" },
  { key: "website", label: "网站", color: "#64748b", hosts: [], track: "page" },
  { key: "other", label: "其它", color: "#64748b", hosts: [], track: "page" },
];

const BY_KEY = new Map(PLATFORMS.map((p) => [p.key, p]));
export const platformInfo = (key: string): PlatformInfo => BY_KEY.get(key as SocialPlatform) ?? BY_KEY.get("other")!;

/** 客户社媒能选的平台（聊天工具不算社媒主页） */
export const CUSTOMER_PLATFORMS = PLATFORMS.filter((p) => !["whatsapp", "wechat", "telegram", "line", "email", "website"].includes(p.key));

/** 补全协议、去掉跟踪参数和结尾斜杠 */
export function normalizeSocialUrl(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v.replace(/^\/+/, "")}`;
  try {
    const u = new URL(v);
    if (!u.hostname.includes(".")) return null;
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|igshid|si$|ref|trk|originalSubdomain)/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/+$/, "").replace(/\/\?/, "?");
  } catch {
    return null;
  }
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^(www|m|mobile)\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function detectPlatform(url: string): SocialPlatform {
  if (/^mailto:/i.test(url.trim())) return "email";
  const host = hostOf(url);
  if (!host) return "other";
  for (const p of PLATFORMS) if (p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return p.key;
  return "website";
}

/** 链接里的账号名：linkedin.com/company/acme → acme；instagram.com/acme → @acme */
export function handleOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const p = detectPlatform(url);
  if (p === "linkedin") return parts[1] ?? parts[0] ?? null;
  if (p === "youtube") {
    const at = parts.find((x) => x.startsWith("@"));
    if (at) return at;
    if (["c", "user", "channel"].includes(parts[0])) return parts[1] ?? null;
    return parts[0] ?? null;
  }
  if (p === "facebook" && parts[0] === "profile.php") return u.searchParams.get("id");
  if (["instagram", "tiktok", "x", "pinterest", "telegram"].includes(p)) {
    const h = parts[0];
    return h ? (h.startsWith("@") ? h : `@${h}`) : null;
  }
  return parts[0] ?? null;
}

/** 是不是一个账号主页（不是分享按钮、单条帖子、登录页） */
export function isProfileUrl(url: string): boolean {
  const p = detectPlatform(url);
  if (p === "website" || p === "other") return false;
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  if (/\/(sharer|share|intent|dialog|login|signup|hashtag|search|explore|watch|shorts|reel|p|status|posts|pin|embed|plugins|tr)(\/|$)/.test(path)) return false;
  if (p === "linkedin") return /^\/(company|in|school|showcase)\/[^/]+/.test(path);
  if (p === "youtube") return /^\/(@[^/]+|c\/[^/]+|channel\/[^/]+|user\/[^/]+)/.test(path);
  if (p === "facebook") return /^\/[^/]+/.test(path) && !/^\/(pages\/category|groups\/?$)/.test(path);
  return /^\/[^/]+\/?$/.test(path);
}

// ── 对外聚合主页 ──

export type BioLink = {
  id: string;
  /** link 普通链接按钮 / qr 二维码卡片（上传二维码图片，或用链接自动生成） */
  kind: "link" | "qr";
  platform: SocialPlatform;
  label: string;
  url: string;
  /** 二维码图片（微信等只能扫码的） */
  image?: string | null;
};

export const BIO_THEMES = {
  sky: { label: "晴空", bg: "linear-gradient(180deg,#dbeafe 0%,#f8fafc 60%)", card: "#ffffff", text: "#0f172a", accent: "#2563eb" },
  ink: { label: "墨黑", bg: "linear-gradient(180deg,#0f172a 0%,#1e293b 100%)", card: "#1e293b", text: "#f8fafc", accent: "#38bdf8" },
  sand: { label: "暖沙", bg: "linear-gradient(180deg,#fde68a 0%,#fffbeb 60%)", card: "#ffffff", text: "#422006", accent: "#b45309" },
  leaf: { label: "青叶", bg: "linear-gradient(180deg,#bbf7d0 0%,#f0fdf4 60%)", card: "#ffffff", text: "#052e16", accent: "#15803d" },
} as const;
export type BioTheme = keyof typeof BIO_THEMES;
export const bioTheme = (t: string) => BIO_THEMES[(t in BIO_THEMES ? t : "sky") as BioTheme];

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function parseBioLinks(v: unknown): BioLink[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is BioLink => !!x && typeof x === "object" && typeof (x as BioLink).id === "string")
    .map((x) => ({
      id: x.id,
      kind: x.kind === "qr" ? "qr" : "link",
      platform: platformInfo(x.platform).key,
      label: String(x.label ?? ""),
      url: String(x.url ?? ""),
      image: x.image ?? null,
    }));
}

/** 穿透挖到的社媒账号（报告里的一段） */
export type ResearchSocial = { platform: SocialPlatform; url: string; handle: string | null; source: string; title?: string };
