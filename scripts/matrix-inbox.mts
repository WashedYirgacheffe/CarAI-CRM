// 运行器：读私信、发私信（scripts/matrix-runner.mts 调用）。
// 能读网页自己调用的接口就读接口（Instagram、X），否则读页面：会话列表 → 打开预览有变化的会话 → 按气泡左右位置分出谁发的。
import fs from "node:fs";
import path from "node:path";

type Ctx = import("playwright-core").BrowserContext;
type Page = import("playwright-core").Page;

export type InboxMessage = { id?: string; fromMe: boolean; text: string; type?: "text" | "image" | "video" | "other"; at?: number };
export type InboxThread = {
  key: string;
  url?: string;
  peer?: { name?: string; handle?: string; url?: string; avatar?: string };
  messages: InboxMessage[];
};
export type Reply = { id: string; text: string; thread: { key: string; url: string | null; name: string | null } };
type Log = (...a: unknown[]) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (a: number, b: number) => sleep(a + Math.random() * (b - a));

// ── 各平台的页面结构 ──

type Site = {
  inboxUrl: string;
  /** 会话列表里的会话链接，第 1 组是会话 id */
  threadHref?: RegExp;
  /** 没有链接的平台（TikTok）：会话列表项 */
  listItem?: string;
  threadUrl?: (key: string) => string;
  /** 会话里的消息气泡（文字所在元素） */
  bubble: string;
  /** 消息区域（判断左右用）；不填就用气泡共同的祖先 */
  pane?: string;
  /** 会话顶部对方主页链接，第 1 组是用户名 */
  profileHref?: RegExp;
  composer: string;
  sendButton?: string;
};

const SITES: Record<string, Site> = {
  // 2026-11 起的新版私信页（dm-new-*）；读和发都走下面的 tiktok* 专用流程，这里只留输入框
  tiktok: {
    inboxUrl: "https://www.tiktok.com/messages",
    listItem: '[data-e2e="dm-new-conversation-item"]',
    bubble: '[data-e2e="dm-new-chat-item"]',
    profileHref: /tiktok\.com\/@([\w.]+)/,
    composer: '[data-e2e="dm-new-input-editor"] [contenteditable="true"], [data-e2e="message-input-area"] [contenteditable="true"]',
  },
  instagram: {
    inboxUrl: "https://www.instagram.com/direct/inbox/",
    threadHref: /\/direct\/t\/([\w-]+)/,
    threadUrl: (k) => `https://www.instagram.com/direct/t/${k}/`,
    bubble: 'div[role="row"] div[dir="auto"]',
    pane: 'div[role="main"]',
    profileHref: /instagram\.com\/([\w.]+)\/?$/,
    composer: 'div[role="textbox"][contenteditable="true"]',
  },
  facebook: {
    inboxUrl: "https://www.facebook.com/messages/t/",
    threadHref: /\/messages\/(?:e2ee\/)?t\/(\d+)/,
    threadUrl: (k) => `https://www.facebook.com/messages/t/${k}/`,
    bubble: 'div[role="row"] div[dir="auto"]',
    pane: 'div[role="main"]',
    profileHref: /facebook\.com\/((?:profile\.php\?id=\d+)|[\w.]+)\/?$/,
    composer: 'div[role="textbox"][contenteditable="true"]',
  },
  linkedin: {
    inboxUrl: "https://www.linkedin.com/messaging/",
    threadHref: /\/messaging\/thread\/([^/?#]+)/,
    threadUrl: (k) => `https://www.linkedin.com/messaging/thread/${k}/`,
    bubble: ".msg-s-event-listitem__body",
    pane: ".msg-s-message-list",
    profileHref: /linkedin\.com\/in\/([^/?#]+)/,
    composer: "div.msg-form__contenteditable[contenteditable='true']",
    sendButton: "button.msg-form__send-button",
  },
  x: {
    inboxUrl: "https://x.com/messages",
    threadHref: /\/messages\/([\d-]+)(?:[/?#]|$)/,
    threadUrl: (k) => `https://x.com/messages/${k}`,
    bubble: '[data-testid="messageEntry"] [data-testid="tweetText"], [data-testid="messageEntry"] div[dir="auto"]',
    pane: '[data-testid="DmActivityViewport"], [data-testid="DmScrollerContainer"]',
    profileHref: /x\.com\/([A-Za-z0-9_]{2,15})\/?$/,
    composer: '[data-testid="dmComposerTextInput"], div[role="textbox"][contenteditable="true"]',
    sendButton: '[data-testid="dmComposerSendButton"]',
  },
};

export const inboxSupported = (platform: string) => platform in SITES;

// ── 读页面 ──

type ListRow = { key: string; name: string; preview: string; href?: string; index: number };

/** 会话列表：按页面顺序（最近的在上面） */
async function readList(page: Page, site: Site): Promise<ListRow[]> {
  if (site.threadHref) {
    const rows = await page.$$eval(
      "a[href]",
      (as, src) => {
        const re = new RegExp(src);
        const out: { key: string; text: string; href: string }[] = [];
        for (const a of as as HTMLAnchorElement[]) {
          const m = a.href.match(re);
          if (!m) continue;
          const r = a.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          out.push({ key: m[1], text: a.innerText, href: a.href });
        }
        return out;
      },
      site.threadHref.source,
    );
    const seen = new Set<string>();
    return rows
      .filter((r) => !seen.has(r.key) && seen.add(r.key))
      .map((r, index) => {
        const lines = r.text.split("\n").map((l) => l.trim()).filter(Boolean);
        return { key: r.key, name: lines[0] ?? r.key, preview: lines.slice(1).join(" ").slice(0, 300), href: r.href, index };
      });
  }
  const texts = await page.$$eval(site.listItem!, (els) => (els as HTMLElement[]).map((e) => e.innerText));
  const seen = new Set<string>();
  return texts
    .map((t, index) => {
      const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
      return { key: lines[0] ?? `#${index}`, name: lines[0] ?? "", preview: lines.slice(1).join(" ").slice(0, 300), index };
    })
    .filter((r) => r.name && !seen.has(r.key) && seen.add(r.key));
}

/** 时间、已读之类的不是消息 */
const NOISE = /^(\d{1,2}:\d{2}(\s?[AP]M)?|seen|sent|delivered|read|已读|已发送|已送达|today|yesterday|今天|昨天|\d+\s?(m|h|d|w|min|分钟|小时|天)( ago)?)$/i;

/** 当前打开的会话里的消息：气泡离消息区右边近 = 我发的 */
async function readBubbles(page: Page, site: Site): Promise<{ messages: InboxMessage[]; profile?: string; profileUrl?: string }> {
  const raw = await page.evaluate(
    ({ bubble, pane, profile }) => {
      const els = [...document.querySelectorAll<HTMLElement>(bubble)].filter((e) => {
        const r = e.getBoundingClientRect();
        // 嵌套命中只留最外层，去掉看不见的
        return r.width > 0 && r.height > 0 && !e.parentElement?.closest(bubble);
      });
      let box: Element | null = pane ? document.querySelector(pane) : null;
      if (!box && els.length) {
        box = els[0];
        while (box.parentElement && !els.every((e) => box!.contains(e))) box = box.parentElement;
      }
      const pr = (box ?? document.body).getBoundingClientRect();
      const msgs = els.map((e) => {
        const r = e.getBoundingClientRect();
        const left = r.left - pr.left;
        const right = pr.right - r.right;
        const media = !!e.querySelector("img:not([alt=''])[src*='http'], video");
        return { text: e.innerText.trim(), fromMe: right + 8 < left, media };
      });
      let p: { handle: string; url: string } | undefined;
      if (profile) {
        const re = new RegExp(profile);
        for (const a of (box ?? document).querySelectorAll<HTMLAnchorElement>("a[href]")) {
          const m = a.href.match(re);
          if (m) {
            p = { handle: m[1], url: a.href.split("?")[0] };
            break;
          }
        }
      }
      return { msgs, p };
    },
    { bubble: site.bubble, pane: site.pane ?? null, profile: site.profileHref?.source ?? null },
  );
  const messages = raw.msgs
    .filter((m) => (m.text && !NOISE.test(m.text)) || m.media)
    .map((m) => ({ fromMe: m.fromMe, text: m.text, type: (m.text ? "text" : "image") as InboxMessage["type"] }));
  return { messages, profile: raw.p?.handle, profileUrl: raw.p?.url };
}

/** 打开一个会话：有链接就直接去，没有就在列表里点 */
async function openThread(page: Page, site: Site, t: { key: string; url?: string | null; name?: string | null; index?: number }) {
  const url = t.url || site.threadUrl?.(t.key);
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } else {
    if (!page.url().startsWith(site.inboxUrl)) {
      await page.goto(site.inboxUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForSelector(site.listItem!, { timeout: 20_000 }).catch(() => {});
    }
    const items = page.locator(site.listItem!);
    const target = t.name ? items.filter({ hasText: t.name }).first() : items.nth(t.index ?? 0);
    await target.click({ timeout: 15_000 });
  }
  await page.waitForSelector(site.bubble, { timeout: 15_000 }).catch(() => {});
  await jitter(1500, 2500);
}

// ── 读接口 ──

/** Instagram：网页版自己的私信接口 */
async function instagramApi(page: Page): Promise<InboxThread[] | null> {
  const data = await page
    .evaluate(async () => {
      const r = await fetch("/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit=20&thread_message_limit=20", {
        headers: { "x-ig-app-id": "936619743392459", "x-requested-with": "XMLHttpRequest" },
        credentials: "include",
      });
      return r.ok ? r.json() : null;
    })
    .catch(() => null);
  type IgItem = { item_id: string; user_id: number | string; timestamp: number | string; item_type: string; text?: string; link?: { text?: string } };
  type IgThread = {
    thread_id: string;
    thread_title?: string;
    viewer_id?: number | string;
    is_group?: boolean;
    users?: { pk: number | string; username: string; full_name?: string; profile_pic_url?: string }[];
    items?: IgItem[];
  };
  const threads = (data as { inbox?: { threads?: IgThread[] }; viewer?: { pk?: string | number } } | null)?.inbox?.threads;
  if (!Array.isArray(threads)) return null;
  const viewer = String((data as { viewer?: { pk?: string | number } }).viewer?.pk ?? "");
  return threads
    .filter((t) => !t.is_group)
    .map((t) => {
      const u = t.users?.[0];
      const me = String(t.viewer_id ?? viewer);
      return {
        key: t.thread_id,
        url: `https://www.instagram.com/direct/t/${t.thread_id}/`,
        peer: u
          ? { name: u.full_name || u.username, handle: u.username, url: `https://www.instagram.com/${u.username}/`, avatar: u.profile_pic_url }
          : { name: t.thread_title },
        messages: (t.items ?? [])
          .map((i) => ({
            id: i.item_id,
            fromMe: String(i.user_id) === me,
            text: i.text ?? i.link?.text ?? "",
            type: (i.item_type === "text" || i.item_type === "link" ? "text" : i.item_type === "media" ? "image" : "other") as InboxMessage["type"],
            // 微秒
            at: Math.round(Number(i.timestamp) / 1000),
          }))
          .reverse(),
      };
    });
}

/** X：打开私信页时网页会请求 inbox_initial_state，截下来读 */
function xCollector(page: Page) {
  const bodies: unknown[] = [];
  const onResp = async (r: import("playwright-core").Response) => {
    if (!/\/dm\/(inbox_initial_state|user_updates|conversation\/[^/]+\.json)/.test(r.url())) return;
    const j = await r.json().catch(() => null);
    if (j) bodies.push(j);
  };
  page.on("response", onResp);
  return {
    stop: () => page.off("response", onResp),
    async threads(ctx: Ctx): Promise<InboxThread[] | null> {
      const me = decodeURIComponent((await ctx.cookies("https://x.com")).find((c) => c.name === "twid")?.value ?? "").replace(/^u=/, "");
      type XEntry = { message?: { id: string; time: string; conversation_id: string; message_data?: { text?: string; sender_id?: string; attachment?: unknown } } };
      type XUser = { screen_name: string; name?: string; profile_image_url_https?: string };
      const threads = new Map<string, InboxThread>();
      const users: Record<string, XUser> = {};
      for (const b of bodies) {
        const s = (b as Record<string, unknown>).inbox_initial_state ?? (b as Record<string, unknown>).user_events ?? (b as Record<string, unknown>).conversation_timeline;
        if (!s || typeof s !== "object") continue;
        Object.assign(users, (s as { users?: Record<string, XUser> }).users ?? {});
        for (const e of ((s as { entries?: XEntry[] }).entries ?? []) as XEntry[]) {
          const m = e.message;
          if (!m?.message_data) continue;
          const t = threads.get(m.conversation_id) ?? { key: m.conversation_id, url: `https://x.com/messages/${m.conversation_id}`, messages: [] };
          t.messages.push({
            id: m.id,
            fromMe: m.message_data.sender_id === me,
            text: m.message_data.text ?? "",
            type: m.message_data.attachment ? "image" : "text",
            at: Number(m.time),
          });
          threads.set(m.conversation_id, t);
        }
      }
      if (!threads.size) return null;
      for (const t of threads.values()) {
        t.messages.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
        // 一对一会话 id 是「我-对方」
        const other = t.key.split("-").find((id) => id !== me);
        const u = other ? users[other] : undefined;
        if (u) t.peer = { name: u.name || u.screen_name, handle: u.screen_name, url: `https://x.com/${u.screen_name}`, avatar: u.profile_image_url_https };
      }
      return [...threads.values()].filter((t) => !t.key.includes(":") || t.peer);
    },
  };
}

// ── TikTok：新版私信页 ──
// 主列表里混着「消息请求」入口（陌生人发来的私信都在里面），两边都要读。
// 会话项带 data-conv-id（稳定的会话 id）；对方的消息带头像，消息 id 在「更多」按钮的 id 里。

const TT = {
  list: '[data-e2e="dm-new-conversation-list"]',
  item: '[data-e2e="dm-new-conversation-item"]',
  requests: "[data-stranger-entry]",
  back: '[data-testid="dm-new-v3-back-btn"]',
  chatItem: '[data-e2e="dm-new-chat-item"]',
  accept: '[data-e2e="dm-new-stranger-accept"]',
};

type TtRow = ListRow & { request: boolean };

/**
 * 列表预览里去掉相对时间（「2m」「3小时」「昨天」「12:30」…）：时间每分钟都在变，
 * 不去掉的话常驻监听会把没有新消息的会话也反复打开
 */
const TIME_TOKEN =
  /(^|\s|·)(\d+\s?(s|m|h|d|w|mo|y|sec|min|mins|hr|hrs|秒|分钟|小时|天|周|个月|年)(\s?ago|前)?|\d{1,2}:\d{2}(\s?[AP]M)?|\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{4}-\d{1,2}-\d{1,2}|just now|刚刚|yesterday|昨天|mon|tue|wed|thu|fri|sat|sun|周[一二三四五六日])(?=$|\s|·)/gi;
const stablePreview = (s: string) => s.replace(TIME_TOKEN, " ").replace(/[\s·]+/g, " ").trim();

async function tiktokRows(page: Page, request: boolean): Promise<TtRow[]> {
  const rows = await page.$$eval(TT.item, (els) =>
    (els as HTMLElement[])
      .filter((e) => e.getBoundingClientRect().height > 0)
      .map((e) => {
        const name = e.querySelector('[data-e2e="dm-new-conversation-nickname"]')?.textContent?.trim() ?? "";
        const info = e.querySelector('[data-e2e="dm-new-conversation-nickname"]')?.nextElementSibling as HTMLElement | null;
        return { key: e.getAttribute("data-conv-id") ?? "", name, preview: (info?.innerText ?? "").replace(/\s+/g, " ").trim() };
      }),
  );
  return rows.filter((r) => r.key).map((r, index) => ({ ...r, preview: stablePreview(r.preview), index, request: request }));
}

async function tiktokHome(page: Page) {
  if (!page.url().startsWith(SITES.tiktok.inboxUrl)) {
    await page.goto(SITES.tiktok.inboxUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  }
  await page.waitForSelector(`${TT.item}, ${TT.requests}`, { timeout: 25_000 }).catch(() => {});
  await jitter(800, 1500);
}

/** 进「消息请求」列表；没有请求返回 false */
async function tiktokEnterRequests(page: Page) {
  const entry = page.locator(TT.requests).first();
  if (!(await entry.isVisible().catch(() => false))) return false;
  await entry.click({ timeout: 10_000 });
  await page.waitForSelector(TT.back, { timeout: 15_000 }).catch(() => {});
  await jitter(1500, 2500);
  return true;
}

async function tiktokLeaveRequests(page: Page) {
  const back = page.locator(TT.back).first();
  if (await back.isVisible().catch(() => false)) {
    await back.click({ timeout: 10_000 }).catch(() => {});
    await jitter(1000, 1800);
  }
}

/** 打开会话：先在当前列表找，找不到再去「消息请求」里找 */
async function tiktokOpen(page: Page, key: string) {
  await tiktokHome(page);
  const sel = `${TT.item}[data-conv-id="${key.replace(/"/g, '\\"')}"]`;
  const item = page.locator(sel).first();
  const shows = (ms: number) => item.waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);
  if (!(await shows(3000))) {
    // 可能停在「消息请求」里（上一个会话是请求），先回主列表找；还没有再进请求里找
    await tiktokLeaveRequests(page);
    if (!(await shows(5000))) {
      if (!(await tiktokEnterRequests(page)) || !(await shows(5000))) throw new Error("找不到这个会话");
    }
  }
  await item.click({ timeout: 15_000 });
  await page.waitForSelector(TT.chatItem, { timeout: 15_000 }).catch(() => {});
  await jitter(1500, 2500);
}

/** 读当前打开的会话 */
async function tiktokRead(page: Page): Promise<{ messages: InboxMessage[]; handle?: string }> {
  const raw = await page.evaluate((chatItem) => {
    const list = document.querySelector('[data-e2e="dm-new-message-list"]');
    const lr = (list ?? document.body).getBoundingClientRect();
    const msgs = [...document.querySelectorAll<HTMLElement>(chatItem)].map((e) => {
      const id = /more-action-icon-msg-(\d+)/.exec(e.querySelector('[id^="more-action-icon-msg-"]')?.id ?? "")?.[1];
      const text = (e.querySelector('[data-e2e="dm-new-message-text"]') as HTMLElement | null)?.innerText.trim() ?? "";
      const video = !!e.querySelector('[data-e2e="dm-new-shared-video"]');
      const image = !!e.querySelector('img[alt="sticker"], [class*="Image"] img:not([class*="Avatar"])');
      // 对方的消息左边有头像；自己的没有，靠右
      const avatar = !!e.querySelector('[data-e2e="chat-avatar"]');
      const box = (e.querySelector('[data-area="Actions"]') ?? e).getBoundingClientRect();
      const fromMe = !avatar && box.left + box.width / 2 > lr.left + lr.width / 2;
      return { id, text, video, image, fromMe };
    });
    const handle = document.querySelector('[data-e2e="chat-uniqueid"]')?.textContent?.trim().replace(/^@/, "");
    return { msgs, handle };
  }, TT.chatItem);
  const messages = raw.msgs
    .filter((m) => m.text || m.video || m.image)
    .map((m) => ({
      id: m.id,
      fromMe: m.fromMe,
      text: m.text || (m.video ? "[分享了视频]" : "[图片]"),
      type: (m.text ? "text" : m.video ? "video" : "image") as InboxMessage["type"],
    }));
  return { messages, handle: raw.handle || undefined };
}

async function tiktokSync(page: Page, profileDir: string, log: Log): Promise<InboxThread[]> {
  await tiktokHome(page);
  const main = await tiktokRows(page, false);
  let reqs: TtRow[] = [];
  if (await tiktokEnterRequests(page)) {
    reqs = await tiktokRows(page, true);
    await tiktokLeaveRequests(page);
  }
  const list = [...main, ...reqs];
  if (!list.length && !(await page.locator(TT.list).count())) throw new Error("没找到 TikTok 私信列表，页面可能改版了");
  const store = previewStore(profileDir);
  const first = !fs.existsSync(path.join(profileDir, "inbox-preview.json"));
  const todo = list.filter((r) => store.changed(r.key, r.preview)).slice(0, first ? 15 : 8);
  log(`  会话 ${main.length} 个，消息请求 ${reqs.length} 个，打开有变化的 ${todo.length} 个`);
  const out: InboxThread[] = [];
  for (const r of todo) {
    try {
      await tiktokOpen(page, r.key);
      const b = await tiktokRead(page);
      out.push({
        key: r.key,
        peer: { name: r.name, handle: b.handle, url: b.handle ? `https://www.tiktok.com/@${b.handle}` : undefined },
        messages: b.messages,
      });
      store.set(r.key, r.preview);
    } catch (e) {
      log("  打开会话失败", r.name, (e as Error).message.split("\n")[0]);
    }
    await jitter(1500, 3500);
  }
  store.save();
  return out;
}

/** 回复前：消息请求要先「接受」才能发（回复本身就代表接受） */
async function tiktokAcceptIfRequest(page: Page, log: Log) {
  const box = page.locator(TT.accept).first();
  if (!(await box.isVisible().catch(() => false))) return;
  await box.locator('[role="button"]').last().click({ timeout: 10_000 });
  log("  已接受消息请求");
  await jitter(1500, 2500);
}

/** X 私信已改成加密的 XChat（/i/chat）：新设备要先输入 4 位私信密码才能解密，否则停在密码页 */
async function xCheckChatLock(page: Page) {
  for (let i = 0; i < 10 && !page.url().includes("/i/chat/pin"); i++) await sleep(1500);
  if (page.url().includes("/i/chat/pin")) {
    throw new Error("X 私信已加密，需要先在「打开环境」里进入私信页，输入一次 4 位私信密码");
  }
}

// ── 常驻监听（桌面版）：页面一直停在私信页，几秒看一眼会话列表 ──

/** 已适配常驻监听的平台（和 src/lib/matrix.ts 的 WATCH_PLATFORMS 一致） */
export const watchSupported = (platform: string) => platform === "tiktok";

/** 常驻页面回到私信页 */
export async function watchHome(page: Page, platform: string) {
  if (platform === "tiktok") {
    await tiktokLeaveRequests(page).catch(() => {});
    await tiktokHome(page);
  }
}

/**
 * 常驻监听一轮：只读会话列表预览，有变化的会话才点开读。
 * 「消息请求」入口的文字变了，或者 deep = true（每隔几分钟）时，进去看一次请求列表。
 * 返回有新内容的会话（没有变化返回空数组）。
 */
export async function watchTick(page: Page, platform: string, profileDir: string, log: Log, opts: { deep: boolean }): Promise<InboxThread[]> {
  if (platform !== "tiktok") return [];
  if (!page.url().startsWith(SITES.tiktok.inboxUrl)) await tiktokHome(page);
  await tiktokLeaveRequests(page);
  const store = previewStore(profileDir);
  const main = await tiktokRows(page, false);
  const entry = page.locator(TT.requests).first();
  const entryText = (await entry.isVisible().catch(() => false)) ? stablePreview((await entry.innerText().catch(() => "")).replace(/\s+/g, " ")) : "";
  let reqs: TtRow[] = [];
  if (entryText && (opts.deep || store.changed("__requests__", entryText))) {
    if (await tiktokEnterRequests(page)) {
      reqs = await tiktokRows(page, true);
      await tiktokLeaveRequests(page);
    }
    store.set("__requests__", entryText);
  }
  if (!main.length && !reqs.length && !(await page.locator(TT.list).count())) throw new Error("没找到 TikTok 私信列表，页面可能改版了");
  const todo = [...main, ...reqs].filter((r) => store.changed(r.key, r.preview)).slice(0, 8);
  const out: InboxThread[] = [];
  for (const r of todo) {
    try {
      await tiktokOpen(page, r.key);
      const b = await tiktokRead(page);
      out.push({
        key: r.key,
        peer: { name: r.name, handle: b.handle, url: b.handle ? `https://www.tiktok.com/@${b.handle}` : undefined },
        messages: b.messages,
      });
      store.set(r.key, r.preview);
    } catch (e) {
      log("  打开会话失败", r.name, (e as Error).message.split("\n")[0]);
    }
    await jitter(800, 1800);
  }
  if (todo.length) await tiktokLeaveRequests(page);
  store.save();
  return out;
}

// ── 列表预览缓存：预览没变的会话不打开（存在账号的环境目录里） ──

function previewStore(dir: string) {
  const file = path.join(dir, "inbox-preview.json");
  let data: Record<string, string> = {};
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    data = {};
  }
  return {
    changed: (key: string, preview: string) => data[key] !== preview,
    set: (key: string, preview: string) => (data[key] = preview),
    save: () => fs.writeFileSync(file, JSON.stringify(data)),
  };
}

// ── 对外：同步、回复 ──

/** 同步私信。返回 null = 这个平台还不支持 */
export async function syncInbox(ctx: Ctx, page: Page, platform: string, profileDir: string, log: Log): Promise<InboxThread[] | null> {
  const site = SITES[platform];
  if (!site) return null;
  if (platform === "tiktok") return tiktokSync(page, profileDir, log);
  const x = platform === "x" ? xCollector(page) : null;
  await page.goto(site.inboxUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  await jitter(4000, 6000);
  if (x) await xCheckChatLock(page);

  if (platform === "instagram") {
    const api = await instagramApi(page);
    if (api) {
      log(`  读到 ${api.length} 个会话（接口）`);
      return api;
    }
  }
  if (x) {
    const api = await x.threads(ctx);
    x.stop();
    if (api) {
      log(`  读到 ${api.length} 个会话（接口）`);
      return api;
    }
  }

  // 读页面
  await page.waitForSelector(site.listItem ?? "a[href]", { timeout: 20_000 }).catch(() => {});
  const list = await readList(page, site);
  const store = previewStore(profileDir);
  const first = !fs.existsSync(path.join(profileDir, "inbox-preview.json"));
  const todo = list.filter((r) => store.changed(r.key, r.preview)).slice(0, first ? 15 : 8);
  log(`  会话 ${list.length} 个，打开有变化的 ${todo.length} 个`);
  const out: InboxThread[] = [];
  for (const r of todo) {
    try {
      await openThread(page, site, { key: r.key, url: r.href, name: site.threadHref ? null : r.name, index: r.index });
      const b = await readBubbles(page, site);
      out.push({
        key: r.key,
        url: r.href ?? (site.threadHref ? page.url() : undefined),
        peer: { name: r.name, handle: b.profile, url: b.profileUrl },
        messages: b.messages,
      });
      store.set(r.key, r.preview);
    } catch (e) {
      log("  打开会话失败", r.name, (e as Error).message.split("\n")[0]);
    }
    await jitter(1500, 3500);
  }
  store.save();
  return out;
}

/** 在输入框里打字发送；换行用 Shift+Enter */
async function typeAndSend(page: Page, site: Site, text: string) {
  const box = page.locator(site.composer).last();
  await box.waitFor({ state: "visible", timeout: 20_000 });
  await box.click();
  await jitter(300, 800);
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    if (i) await page.keyboard.press("Shift+Enter");
    if (line) await page.keyboard.type(line, { delay: 25 + Math.random() * 45 });
  }
  await jitter(500, 1200);
  const btn = site.sendButton ? page.locator(site.sendButton).last() : null;
  if (btn && (await btn.isVisible().catch(() => false)) && (await btn.isEnabled().catch(() => false))) await btn.click();
  else await page.keyboard.press("Enter");
  await jitter(2500, 3500);
  const left = (await box.innerText().catch(() => "")).trim();
  if (left && text.trim().startsWith(left.slice(0, 20))) throw new Error("消息没发出去（还在输入框里）");
}

/** 逐条发送 CRM 里排队的回复，发完把这些会话读一遍报回去 */
export async function sendReplies(page: Page, platform: string, replies: Reply[], log: Log) {
  const site = SITES[platform];
  const results: { id: string; ok: boolean; error?: string }[] = [];
  const threads = new Map<string, InboxThread>();
  if (!site) return { results: replies.map((r) => ({ id: r.id, ok: false, error: "这个平台还不支持回复" })), threads: [] };
  for (const r of replies) {
    try {
      if (platform === "tiktok") {
        await tiktokOpen(page, r.thread.key);
        await tiktokAcceptIfRequest(page, log);
      } else {
        await openThread(page, site, { key: r.thread.key, url: r.thread.url, name: r.thread.name });
      }
      await typeAndSend(page, site, r.text);
      results.push({ id: r.id, ok: true });
      log(`  已发送给 ${r.thread.name ?? r.thread.key}`);
      // 读接口的平台消息带 id，这里读页面会重复，等下次同步认领
      const b =
        platform === "instagram" || platform === "x"
          ? null
          : platform === "tiktok"
            ? await tiktokRead(page).catch(() => null)
            : await readBubbles(page, site).catch(() => null);
      if (b?.messages.length) threads.set(r.thread.key, { key: r.thread.key, messages: b.messages });
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0].slice(0, 200);
      results.push({ id: r.id, ok: false, error: /Timeout/i.test(msg) ? "找不到会话或输入框，页面可能改版了" : msg });
      log("  发送失败", r.thread.name ?? r.thread.key, msg);
    }
    await jitter(2000, 5000);
  }
  return { results, threads: [...threads.values()] };
}
