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
  tiktok: {
    inboxUrl: "https://www.tiktok.com/messages",
    listItem: '[data-e2e="chat-list-item"]',
    bubble: '[data-e2e="chat-item"]',
    profileHref: /tiktok\.com\/@([\w.]+)/,
    composer: '[data-e2e="message-input-area"] [contenteditable="true"], div[contenteditable="true"][role="textbox"]',
    sendButton: '[data-e2e="message-send"]',
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
  const x = platform === "x" ? xCollector(page) : null;
  await page.goto(site.inboxUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  await jitter(4000, 6000);

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
      await openThread(page, site, { key: r.thread.key, url: r.thread.url, name: r.thread.name });
      await typeAndSend(page, site, r.text);
      results.push({ id: r.id, ok: true });
      log(`  已发送给 ${r.thread.name ?? r.thread.key}`);
      // 读接口的平台消息带 id，这里读页面会重复，等下次同步认领
      const b = platform === "instagram" || platform === "x" ? null : await readBubbles(page, site).catch(() => null);
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
