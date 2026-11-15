/*
 * 社媒矩阵（前后端、运行器共用）：平台、账号状态、任务状态。
 * 方案见 docs/social-matrix-plan.md
 */

export type MatrixPlatform = "linkedin" | "facebook" | "instagram" | "tiktok" | "youtube";

export type MatrixPlatformInfo = {
  key: MatrixPlatform;
  label: string;
  /** 登录页 */
  loginUrl: string;
  /** 登录后打开的首页 */
  homeUrl: string;
  /** 有这些 Cookie（任意一个）就算已登录 */
  authCookies: { domain: string; name: string }[];
};

export const MATRIX_PLATFORMS: MatrixPlatformInfo[] = [
  {
    key: "linkedin",
    label: "LinkedIn",
    loginUrl: "https://www.linkedin.com/login",
    homeUrl: "https://www.linkedin.com/feed/",
    authCookies: [{ domain: "linkedin.com", name: "li_at" }],
  },
  {
    key: "facebook",
    label: "Facebook",
    loginUrl: "https://www.facebook.com/login",
    homeUrl: "https://www.facebook.com/",
    authCookies: [{ domain: "facebook.com", name: "c_user" }],
  },
  {
    key: "instagram",
    label: "Instagram",
    loginUrl: "https://www.instagram.com/accounts/login/",
    homeUrl: "https://www.instagram.com/",
    authCookies: [{ domain: "instagram.com", name: "sessionid" }],
  },
  {
    key: "tiktok",
    label: "TikTok",
    loginUrl: "https://www.tiktok.com/login",
    homeUrl: "https://www.tiktok.com/",
    authCookies: [{ domain: "tiktok.com", name: "sessionid" }],
  },
  {
    key: "youtube",
    label: "YouTube",
    loginUrl: "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F",
    homeUrl: "https://www.youtube.com/",
    authCookies: [
      { domain: "youtube.com", name: "LOGIN_INFO" },
      { domain: "google.com", name: "SID" },
    ],
  },
];

const BY_KEY = new Map(MATRIX_PLATFORMS.map((p) => [p.key, p]));
export const matrixPlatform = (key: string) => BY_KEY.get(key as MatrixPlatform) ?? null;
export const isMatrixPlatform = (key: string): key is MatrixPlatform => BY_KEY.has(key as MatrixPlatform);

export const ACCOUNT_STATUS: Record<string, { label: string; tone: "muted" | "warn" | "ok" | "bad" }> = {
  new: { label: "未登录", tone: "muted" },
  pending: { label: "等待登录", tone: "warn" },
  active: { label: "已登录", tone: "ok" },
  expired: { label: "登录失效", tone: "bad" },
  restricted: { label: "受限", tone: "bad" },
};

export const JOB_KIND: Record<string, string> = {
  login: "登录",
  open: "打开环境",
  check: "检查登录",
};

export const JOB_STATUS: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  waiting: "等你登录",
  done: "完成",
  failed: "失败",
  canceled: "已取消",
};

export const PROXY_PROTOCOLS = ["http", "https", "socks5"] as const;
export type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number];

/** 运行器心跳：超过这么久没动静就认为运行器没开 */
export const RUNNER_STALE_MS = 90_000;
