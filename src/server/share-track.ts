import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/server/db";
import { readShareToken, shareToken } from "@/server/share";
import { deviceText, placeText, SHARE_KIND_LABELS, type ShareVisitKind, type VisitEvent } from "@/lib/share-visit";
import type { Prisma } from "@/generated/prisma/client";

/*
 * 客户打开我们发出的链接：页面上的脚本开始时报一次（start），之后每隔一会儿报停留（ping）。
 * 只有执行了脚本的浏览器才会记录，WhatsApp / 邮件网关的链接预览抓取不会算进来；
 * 带着 CRM 登录 cookie 的是我们自己在看，也不算。
 */

/** 页面上 <ViewTracker kind> 的 kind（和链接里的签名类型对应） */
export type TrackKind = "q" | "inquiry" | "shipping" | "p";

/** 同一访客 30 分钟内再打开算同一次访问 */
const SAME_VISIT_MS = 30 * 60_000;
const MAX_EVENTS = 300;
const MAX_SECTIONS = 30;

type Target = {
  tenantId: string;
  kind: ShareVisitKind;
  targetId: string;
  refKey: string;
  customerId: string | null;
  chatId: string | null;
  productId: string | null;
  /** 跟进记录里的说明，如「报价单 Q2026-001」 */
  title: string;
};

/**
 * 产品卡链接 payload：「产品 id」+ 可选「-w会话 id」/「-c客户 id」（知道发给了谁）+ 可选「-p」（显示价格）。
 * cuid 只有小写字母和数字，用「-」分隔不会冲突。
 */
export function productPayload(productId: string, opts?: { chatId?: string | null; customerId?: string | null; price?: boolean }) {
  const parts = [productId];
  if (opts?.chatId) parts.push(`w${opts.chatId}`);
  else if (opts?.customerId) parts.push(`c${opts.customerId}`);
  if (opts?.price) parts.push("p");
  return parts.join("-");
}

export function parseProductPayload(payload: string) {
  const [productId, ...rest] = payload.split("-");
  const to = rest.find((x) => x.length > 1);
  return {
    productId,
    chatId: to?.startsWith("w") ? to.slice(1) : null,
    customerId: to?.startsWith("c") ? to.slice(1) : null,
    price: rest.includes("p"),
  };
}

async function resolveTarget(kind: TrackKind, token: string): Promise<Target | null> {
  if (kind === "q") {
    const id = readShareToken("q", token);
    const q = id ? await prisma.quotation.findUnique({ where: { id }, select: { id: true, tenantId: true, customerId: true, no: true } }) : null;
    if (!q) return null;
    return {
      tenantId: q.tenantId,
      kind: "quotation",
      targetId: q.id,
      refKey: `q:${q.id}`,
      customerId: q.customerId,
      chatId: null,
      productId: null,
      title: `报价单 ${q.no}`,
    };
  }
  if (kind === "inquiry" || kind === "shipping") {
    const chatId = readShareToken(kind, token);
    const chat = chatId ? await prisma.waChat.findUnique({ where: { id: chatId }, select: { id: true, tenantId: true, customerId: true } }) : null;
    if (!chat) return null;
    return {
      tenantId: chat.tenantId,
      kind,
      targetId: chat.id,
      refKey: `${kind}:${chat.id}`,
      customerId: chat.customerId,
      chatId: chat.id,
      productId: null,
      title: SHARE_KIND_LABELS[kind],
    };
  }
  const payload = readShareToken("p", token);
  if (!payload) return null;
  const to = parseProductPayload(payload);
  const p = await prisma.product.findUnique({
    where: { id: to.productId },
    select: { id: true, tenantId: true, name: true, nameEn: true, sku: true },
  });
  if (!p) return null;
  let customerId = to.customerId;
  if (to.chatId) {
    const chat = await prisma.waChat.findFirst({ where: { id: to.chatId, tenantId: p.tenantId }, select: { customerId: true } });
    customerId = chat?.customerId ?? null;
  } else if (customerId) {
    const c = await prisma.customer.findFirst({ where: { id: customerId, tenantId: p.tenantId }, select: { id: true } });
    customerId = c?.id ?? null;
  }
  return {
    tenantId: p.tenantId,
    kind: "product",
    targetId: p.id,
    refKey: `p:${p.id}:${to.chatId ? `w${to.chatId}` : to.customerId ? `c${to.customerId}` : "open"}`,
    customerId,
    chatId: to.chatId,
    productId: p.id,
    title: `产品卡 ${p.name}${p.sku ? `（${p.sku}）` : ""}`,
  };
}

// ── 浏览器 / 设备 ──

export function parseUserAgent(ua: string) {
  const s = ua || "";
  const tablet = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(s);
  const mobile = !tablet && /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(s);
  const device = tablet ? "tablet" : mobile ? "mobile" : "desktop";

  let os: string | null = null;
  const ios = /(?:iPhone|iPad|iPod).*?OS (\d+)[_.]?(\d+)?/i.exec(s);
  const android = /Android (\d+(?:\.\d+)?)/i.exec(s);
  if (ios) os = `${/iPad/i.test(s) ? "iPadOS" : "iOS"} ${ios[1]}${ios[2] ? `.${ios[2]}` : ""}`;
  else if (android) {
    // Android 机型：「Android 14; SM-S918B Build/…」
    const model = /Android [\d.]+;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\sBuild|\)|;)/i.exec(s)?.[1]?.trim();
    os = `Android ${android[1]}${model && model !== "K" ? ` · ${model}` : ""}`;
  } else if (/Windows NT/i.test(s)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "macOS";
  else if (/CrOS/i.test(s)) os = "ChromeOS";
  else if (/Linux/i.test(s)) os = "Linux";

  const browser = /WhatsApp/i.test(s)
    ? "WhatsApp 内置浏览器"
    : /MicroMessenger/i.test(s)
      ? "微信"
      : /FBAN|FBAV|Instagram/i.test(s)
        ? "Facebook / Instagram 内置浏览器"
        : /LinkedInApp/i.test(s)
          ? "LinkedIn 内置浏览器"
          : /Edg\//i.test(s)
            ? "Edge"
            : /SamsungBrowser/i.test(s)
              ? "三星浏览器"
              : /OPR\/|Opera/i.test(s)
                ? "Opera"
                : /Firefox|FxiOS/i.test(s)
                  ? "Firefox"
                  : /Chrome|CriOS/i.test(s)
                    ? "Chrome"
                    : /Safari/i.test(s)
                      ? "Safari"
                      : null;
  if (os === "macOS" && device === "desktop" && /iPad/i.test(s)) os = "iPadOS";
  return { device, os, browser };
}

/** 链接预览、爬虫、脚本：本来就不执行页面脚本，这里再拦一道 */
const isBot = (ua: string) => !/^Mozilla\//.test(ua) || /bot|crawl|spider|facebookexternalhit|headless|lighthouse/i.test(ua);

// ── IP 归属地（后台查，失败就空着） ──

function publicIp(ip: string | null) {
  if (!ip) return null;
  const v = ip.replace(/^::ffff:/, "");
  if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80)/i.test(v)) return null;
  return v;
}

export async function lookupIp(ip: string) {
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?lang=zh-CN&fields=success,country,region,city`, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    const j = (await r.json()) as { success?: boolean; country?: string; region?: string; city?: string };
    if (j.success) return { country: j.country || null, region: j.region || null, city: j.city || null };
  } catch {
    // 换一家
  }
  try {
    const r = await fetch(`https://freeipapi.com/api/json/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    const j = (await r.json()) as { countryName?: string; regionName?: string; cityName?: string };
    if (j.countryName) return { country: j.countryName || null, region: j.regionName || null, city: j.cityName || null };
  } catch {
    // 查不到就算了
  }
  return null;
}

// ── 开始 / 停留 ──

export type StartInput = { kind: TrackKind; token: string; ip: string | null; ua: string; referrer: string | null; at: number };

/** 开始一次访问；返回 visit id 和用于后续上报的签名。null 表示不记录 */
export async function startVisit(input: StartInput) {
  if (!input.ua || isBot(input.ua)) return null;
  const target = await resolveTarget(input.kind, input.token);
  if (!target) return null;
  const ip = publicIp(input.ip) ?? input.ip;
  const visitorKey = createHash("sha256")
    .update(`${ip ?? ""}|${input.ua}`)
    .digest("base64url")
    .slice(0, 24);
  const now = new Date();

  const recent = await prisma.shareVisit.findFirst({
    where: { tenantId: target.tenantId, refKey: target.refKey, visitorKey, lastSeenAt: { gt: new Date(now.getTime() - SAME_VISIT_MS) } },
    orderBy: { lastSeenAt: "desc" },
  });
  if (recent) {
    // 30 分钟内刷新或切回来：接着记在同一次访问上
    const events = (recent.events as VisitEvent[]) ?? [];
    if (events.length < MAX_EVENTS) events.push({ t: now.getTime() - recent.startedAt.getTime(), type: "open" });
    await prisma.shareVisit.update({ where: { id: recent.id }, data: { lastSeenAt: now, events } });
    return { id: recent.id, sig: visitSig(recent.id), isNew: false, target, visit: recent };
  }

  const ua = parseUserAgent(input.ua);
  const visit = await prisma.shareVisit.create({
    data: {
      tenantId: target.tenantId,
      kind: target.kind,
      targetId: target.targetId,
      refKey: target.refKey,
      customerId: target.customerId,
      chatId: target.chatId,
      productId: target.productId,
      visitorKey,
      ip,
      device: ua.device,
      os: ua.os,
      browser: ua.browser,
      ua: input.ua.slice(0, 500),
      referrer: input.referrer?.slice(0, 500) || null,
      startedAt: now,
      lastSeenAt: now,
      events: [{ t: 0, type: "open" }],
    },
  });
  await upsertActivity(target);
  return { id: visit.id, sig: visitSig(visit.id), isNew: true, target, visit };
}

/** 新访问查完归属地后补上，并刷新跟进记录里的地点 */
export async function locateVisit(visitId: string) {
  const v = await prisma.shareVisit.findUnique({ where: { id: visitId } });
  const ip = publicIp(v?.ip ?? null);
  if (!v || !ip) return;
  const geo = await lookupIp(ip);
  if (!geo) return;
  await prisma.shareVisit.update({ where: { id: v.id }, data: geo });
  const target = { tenantId: v.tenantId, refKey: v.refKey, customerId: v.customerId };
  if (target.customerId) await refreshActivityText(target.tenantId, target.refKey);
}

/** 同一个链接发给同一个客户：只留一条跟进记录，写打开次数、最近一次的地点和设备，并挪到最新 */
async function upsertActivity(target: Target) {
  if (!target.customerId) return;
  const existing = await prisma.activity.findFirst({
    where: { tenantId: target.tenantId, refKey: target.refKey, event: "share_view" },
    select: { id: true },
  });
  const content = await activityText(target.tenantId, target.refKey, target.title);
  if (existing) {
    await prisma.activity.update({ where: { id: existing.id }, data: { content, createdAt: new Date(), customerId: target.customerId } });
  } else {
    await prisma.activity.create({
      data: { tenantId: target.tenantId, customerId: target.customerId, type: "SYSTEM", event: "share_view", refKey: target.refKey, content },
    });
  }
}

async function activityText(tenantId: string, refKey: string, title?: string) {
  const [count, last] = await Promise.all([
    prisma.shareVisit.count({ where: { tenantId, refKey } }),
    prisma.shareVisit.findFirst({ where: { tenantId, refKey }, orderBy: { startedAt: "desc" } }),
  ]);
  const name = title ?? (await titleOf(tenantId, refKey));
  const where = last ? [placeText(last), deviceText(last)].filter(Boolean).join("，") : "";
  return `客户打开了${name}${count > 1 ? `，第 ${count} 次` : ""}${where ? `（${where}）` : ""}`;
}

async function refreshActivityText(tenantId: string, refKey: string) {
  const a = await prisma.activity.findFirst({ where: { tenantId, refKey, event: "share_view" }, select: { id: true } });
  if (!a) return;
  await prisma.activity.update({ where: { id: a.id }, data: { content: await activityText(tenantId, refKey) } });
}

async function titleOf(tenantId: string, refKey: string) {
  const [kind, id] = refKey.split(":");
  if (kind === "q") {
    const q = await prisma.quotation.findFirst({ where: { id, tenantId }, select: { no: true } });
    return `报价单 ${q?.no ?? ""}`.trim();
  }
  if (kind === "p") {
    const p = await prisma.product.findFirst({ where: { id, tenantId }, select: { name: true, sku: true } });
    return p ? `产品卡 ${p.name}${p.sku ? `（${p.sku}）` : ""}` : "产品卡";
  }
  return SHARE_KIND_LABELS[kind as ShareVisitKind] ?? "链接";
}

const visitSig = (id: string) => shareToken("v", id).split(".")[1];

export type PingInput = {
  id: string;
  sig: string;
  /** 距上次上报新增的前台时长 */
  activeMs?: number;
  maxScroll?: number;
  /** 距上次上报新增的各区块停留 */
  sections?: Record<string, number>;
  /** 新事件，at 为浏览器时间戳 */
  events?: { at: number; type: VisitEvent["type"]; name?: string }[];
};

const clampInt = (n: unknown, max: number) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0);
const cleanName = (s: unknown) => (typeof s === "string" ? s.replace(/[^\w-]/g, "").slice(0, 40) : "");

/** 停留上报：按增量累加；每次最多算 2 分钟，防止乱报 */
export async function pingVisit(input: PingInput) {
  if (!input.id || readShareToken("v", `${input.id}.${input.sig}`) !== input.id) return false;
  const v = await prisma.shareVisit.findUnique({ where: { id: input.id } });
  if (!v) return false;
  const now = new Date();
  if (now.getTime() - v.lastSeenAt.getTime() > 6 * 3600_000) return false;

  const sections = { ...((v.sections as Record<string, number>) ?? {}) };
  for (const [k, ms] of Object.entries(input.sections ?? {})) {
    const name = cleanName(k);
    if (!name || (!(name in sections) && Object.keys(sections).length >= MAX_SECTIONS)) continue;
    sections[name] = (sections[name] ?? 0) + clampInt(ms, 120_000);
  }
  const events = [...((v.events as VisitEvent[]) ?? [])];
  for (const e of (input.events ?? []).slice(0, 50)) {
    if (events.length >= MAX_EVENTS) break;
    if (!["section", "click", "hide", "show"].includes(e.type)) continue;
    const t = clampInt(Math.min(e.at, now.getTime()) - v.startedAt.getTime(), 7 * 86_400_000);
    events.push({ t, type: e.type, ...(e.name ? { name: cleanName(e.name) } : {}) });
  }
  events.sort((a, b) => a.t - b.t);

  await prisma.shareVisit.update({
    where: { id: v.id },
    data: {
      lastSeenAt: now,
      activeMs: v.activeMs + clampInt(input.activeMs, 120_000),
      maxScroll: Math.max(v.maxScroll, clampInt(input.maxScroll, 100)),
      sections: sections as Prisma.InputJsonValue,
      events: events as unknown as Prisma.InputJsonValue,
    },
  });
  return true;
}

// ── 读取（CRM 里看） ──

export function visitView(v: Awaited<ReturnType<typeof prisma.shareVisit.findFirstOrThrow>>) {
  const sections = Object.entries((v.sections as Record<string, number>) ?? {})
    .map(([name, ms]) => ({ name, ms }))
    .filter((s) => s.ms >= 1000)
    .sort((a, b) => b.ms - a.ms);
  return {
    id: v.id,
    startedAt: v.startedAt.toISOString(),
    lastSeenAt: v.lastSeenAt.toISOString(),
    activeMs: v.activeMs,
    maxScroll: v.maxScroll,
    place: placeText(v),
    ip: v.ip,
    device: v.device,
    os: v.os,
    browser: v.browser,
    referrer: v.referrer,
    sections,
    events: (v.events as VisitEvent[]) ?? [],
  };
}
