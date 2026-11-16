/*
 * 社媒矩阵（前后端、运行器共用）：平台、账号状态、任务状态。
 * 方案见 docs/social-matrix-plan.md
 */

export type MatrixPlatform =
  | "linkedin"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "x"
  | "reddit"
  | "pinterest"
  | "threads"
  | "vk"
  | "line";

export type MatrixPlatformInfo = {
  key: MatrixPlatform;
  label: string;
  /** 登录页 */
  loginUrl: string;
  /** 登录后打开的首页 */
  homeUrl: string;
  /** 有这些 Cookie（任意一个）就算已登录；value 填了就要求值相等 */
  authCookies: { domain: string; name: string; value?: string }[];
  /** 没有可靠的登录 Cookie 时：打开首页后停在这个地址前缀下（没被跳去登录页）就算已登录 */
  loggedInUrl?: string;
  /** 补充说明（显示在添加账号里） */
  hint?: string;
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
  {
    key: "x",
    label: "X (Twitter)",
    loginUrl: "https://x.com/i/flow/login",
    homeUrl: "https://x.com/home",
    authCookies: [
      { domain: "x.com", name: "auth_token" },
      { domain: "twitter.com", name: "auth_token" },
    ],
  },
  {
    key: "reddit",
    label: "Reddit",
    loginUrl: "https://www.reddit.com/login/",
    homeUrl: "https://www.reddit.com/",
    authCookies: [{ domain: "reddit.com", name: "reddit_session" }],
  },
  {
    key: "pinterest",
    label: "Pinterest",
    loginUrl: "https://www.pinterest.com/login/",
    homeUrl: "https://www.pinterest.com/",
    // 没登录时 _auth=0
    authCookies: [{ domain: "pinterest.com", name: "_auth", value: "1" }],
  },
  {
    key: "threads",
    label: "Threads",
    loginUrl: "https://www.threads.com/login",
    homeUrl: "https://www.threads.com/",
    authCookies: [
      { domain: "threads.com", name: "sessionid" },
      { domain: "threads.net", name: "sessionid" },
    ],
    hint: "用 Instagram 账号登录",
  },
  {
    key: "vk",
    label: "VK",
    loginUrl: "https://vk.com/login",
    homeUrl: "https://vk.com/feed",
    authCookies: [
      { domain: "vk.com", name: "remixsid" },
      { domain: "vk.com", name: "remixnsid" },
    ],
  },
  {
    key: "line",
    label: "LINE 官方账号",
    loginUrl: "https://account.line.biz/login?redirectUri=https%3A%2F%2Fmanager.line.biz%2F",
    homeUrl: "https://manager.line.biz/",
    authCookies: [],
    loggedInUrl: "https://manager.line.biz/",
    hint: "LINE 个人号没有网页版，这里登录的是 LINE 官方账号后台（manager.line.biz）",
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

/** 任务最长能跑多久，超时由 CRM 标成失败（运行器自己也会掐） */
export const JOB_TIMEOUT_MS: Record<string, number> = {
  login: 15 * 60_000,
  check: 5 * 60_000,
  open: 4 * 60 * 60_000,
};

/** 自动检查登录：每个已登录账号隔多久检查一次 */
export const AUTO_CHECK_EVERY_MS = 12 * 60 * 60_000;

export const JOB_STATUS: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  waiting: "等你登录",
  done: "完成",
  failed: "失败",
  canceled: "已取消",
};

/** 实时画面里能按的键（含组合键，ControlOrMeta 在运行器上按系统换成 Ctrl / ⌘） */
export const LIVE_KEYS = [
  "Enter",
  "Backspace",
  "Tab",
  "Shift+Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ControlOrMeta+a",
  "ControlOrMeta+z",
  "ControlOrMeta+Shift+z",
  "ControlOrMeta+x",
] as const;

export const PROXY_PROTOCOLS = ["http", "https", "socks5"] as const;
export type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number];

/** 运行器心跳：超过这么久没动静就认为运行器没开 */
export const RUNNER_STALE_MS = 90_000;
