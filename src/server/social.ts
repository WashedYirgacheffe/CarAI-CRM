import "server-only";
import { createHash } from "node:crypto";
import { prisma, tenantDb } from "@/server/db";
import { decodeEntities, fetchHtml } from "@/server/web";
import { detectPlatform, handleOf, isProfileUrl, normalizeSocialUrl, platformInfo, type ResearchSocial } from "@/lib/social";

/*
 * 客户社媒：保存账号 + 跟踪更新。
 * 跟踪只走不用登录的公开渠道：
 *   有公开订阅源的（YouTube 频道、博客 RSS / Atom）→ 按条目记新内容；
 *   其它平台 → 读公开主页的标题和简介，变了就记一条「主页资料更新」；
 *   要登录才能看的（LinkedIn、Instagram 多数如此）→ 记下原因，等「社媒矩阵」的指纹浏览器方案上线后由真人账号环境去看。
 * 只有星级达到 Tenant.socialWatchStar 的客户才跟踪。
 */

const HOUR = 3_600_000;
/** 每个账号多久查一次 */
export const SOCIAL_CHECK_HOURS = Number(process.env.SOCIAL_CHECK_HOURS) || 6;
/** worker 每轮最多查几个账号（平台限流，慢慢来） */
const BATCH = 12;

export type SaveSocialInput = { url: string; platform?: string | null; handle?: string | null; source?: string };

/** 加一个客户社媒账号（同一链接已存在就更新平台 / 账号名） */
export async function saveCustomerSocial(tenantId: string, userId: string | null, customerId: string, input: SaveSocialInput) {
  const url = normalizeSocialUrl(input.url);
  if (!url) return { error: "链接格式不对" } as const;
  const platform = input.platform && input.platform !== "auto" ? platformInfo(input.platform).key : detectPlatform(url);
  const handle = input.handle?.trim() || handleOf(url);
  const db = tenantDb(tenantId);
  const existing = await db.customerSocial.findFirst({ where: { customerId, url }, select: { id: true } });
  if (existing) {
    await db.customerSocial.updateMany({ where: { id: existing.id }, data: { platform, handle } });
    return { id: existing.id, existed: true } as const;
  }
  const count = await db.customerSocial.count({ where: { customerId } });
  if (count >= 30) return { error: "一个客户最多存 30 个社媒账号" } as const;
  const row = await db.customerSocial.create({
    data: { tenantId, customerId, url, platform, handle, source: input.source ?? "manual", createdById: userId },
  });
  return { id: row.id, existed: false } as const;
}

// ── 穿透：从官网链接、搜索结果里挑出社媒主页 ──

/** candidates：官网上链出去的（site=true）排在前面，搜索结果在后 */
export function pickSocials(candidates: { url: string; source: string; site: boolean; title?: string }[], companyHint: string): ResearchSocial[] {
  const out: ResearchSocial[] = [];
  const seen = new Set<string>();
  const hint = companyHint
    .toLowerCase()
    .replace(/\b(co|ltd|llc|inc|gmbh|bv|sa|srl|corp|company|limited|group)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
  for (const c of candidates) {
    const url = normalizeSocialUrl(c.url);
    if (!url || !isProfileUrl(url)) continue;
    const platform = detectPlatform(url);
    const handle = handleOf(url);
    // 同一平台只留一个主页（官网上链出去的优先，它们排在前面）
    const key = `${platform}:${(handle ?? url).toLowerCase()}`;
    if (seen.has(key) || out.some((x) => x.platform === platform)) continue;
    // 搜索结果来的：账号名或标题里要能看出是这家公司
    if (!c.site && hint.length >= 3) {
      const h = `${handle ?? ""} ${c.title ?? ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!h.includes(hint.slice(0, Math.min(hint.length, 8)))) continue;
    }
    seen.add(key);
    out.push({ platform, url, handle, source: c.source, title: c.title });
    if (out.length >= 10) break;
  }
  return out;
}

// ── 跟踪 ──

type FeedItem = { id: string; title: string; url: string | null; summary: string | null; image: string | null; publishedAt: Date };

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : null;
};
const attr = (xml: string, name: string, a: string) => xml.match(new RegExp(`<${name}\\b[^>]*\\b${a}=["']([^"']+)["']`, "i"))?.[1] ?? null;

/** RSS / Atom 的条目（够用的简单解析，最多 15 条） */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = [...xml.matchAll(/<(entry|item)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]).slice(0, 15);
  const items: FeedItem[] = [];
  for (const b of blocks) {
    const link = attr(b, "link", "href") ?? tag(b, "link");
    const id = tag(b, "yt:videoId") ?? tag(b, "id") ?? tag(b, "guid") ?? link;
    const title = tag(b, "title") ?? tag(b, "media:title");
    const when = tag(b, "published") ?? tag(b, "pubDate") ?? tag(b, "updated") ?? tag(b, "dc:date");
    const d = when ? new Date(when) : new Date();
    if (!id || !title) continue;
    items.push({
      id: id.slice(0, 300),
      title: title.slice(0, 300),
      url: link,
      summary: (tag(b, "media:description") ?? tag(b, "description") ?? tag(b, "summary"))?.slice(0, 500) ?? null,
      image: attr(b, "media:thumbnail", "url") ?? attr(b, "enclosure", "url"),
      publishedAt: Number.isNaN(+d) ? new Date() : d,
    });
  }
  return items;
}

const meta = (html: string, key: string) =>
  html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ??
  html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, "i"))?.[1] ??
  null;

/** 主页上的订阅源地址（YouTube 频道页、博客都有 rel=alternate） */
function feedOf(html: string, base: string): string | null {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const l = m[0];
    if (!/rel=["']alternate["']/i.test(l) || !/(rss|atom)\+xml/i.test(l)) continue;
    const href = l.match(/href=["']([^"']+)["']/i)?.[1];
    if (href)
      try {
        return new URL(decodeEntities(href), base).toString();
      } catch {
        /* 下一个 */
      }
  }
  const ch = html.match(/"(?:channelId|externalId)":"(UC[\w-]{20,})"/)?.[1];
  return ch ? `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}` : null;
}

const AGO: Record<string, number> = { second: 1e3, minute: 6e4, hour: HOUR, day: 24 * HOUR, week: 7 * 24 * HOUR, month: 30 * 24 * HOUR, year: 365 * 24 * HOUR };

/** YouTube 频道「视频」页里的最新视频（页面内嵌的数据，不用登录） */
async function youtubeItems(url: string): Promise<FeedItem[]> {
  const base = url.replace(/\/(videos|featured|shorts|streams|about|playlists)\/?$/, "");
  const { html } = await fetchHtml(`${base}/videos`, 15_000);
  const items: FeedItem[] = [];
  for (const chunk of html.split('"lockupViewModel":{').slice(1, 16)) {
    const id = chunk.match(/i\.ytimg\.com\/vi\/([\w-]{11})\//)?.[1];
    const raw = chunk.match(/"title":\{"content":"((?:[^"\\]|\\.)*)"/)?.[1];
    if (!id || !raw || items.some((x) => x.id === id)) continue;
    let title = raw;
    try {
      title = JSON.parse(`"${raw}"`);
    } catch {
      /* 保留原样 */
    }
    // 「2 weeks ago」或「2w ago」
    const ago = chunk.match(/"content":"(\d+) ?(seconds?|minutes?|hours?|days?|weeks?|months?|years?|mo|[smhdwy]) ago"/);
    const unit = ago ? (ago[2] === "mo" ? "month" : (Object.keys(AGO).find((k) => k[0] === ago[2][0]) ?? "day")) : null;
    items.push({
      id,
      title: title.slice(0, 300),
      url: `https://www.youtube.com/watch?v=${id}`,
      summary: null,
      image: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      publishedAt: ago && unit ? new Date(Date.now() - Number(ago[1]) * AGO[unit]) : new Date(),
    });
  }
  return items;
}

const LOGIN_WALL = /authwall|join linkedin|sign in to|log in to see|log into facebook|login • instagram|you must log in|请登录|captcha/i;

type CheckResult = { added: number; error?: string };

/** 查一个账号：有订阅源按条目，没有就比对主页资料 */
export async function checkSocial(id: string): Promise<CheckResult> {
  const s = await prisma.customerSocial.findUnique({ where: { id }, include: { customer: { select: { name: true } } } });
  if (!s) return { added: 0, error: "账号不存在" };
  const now = new Date();
  // 还没记到过任何东西（之前查失败过也算第一次）
  const first = !s.fingerprint && !(await prisma.socialPost.count({ where: { socialId: s.id } }));
  try {
    let feedUrl = s.feedUrl;
    let html: string | null = null;
    let items: FeedItem[] | null = null;
    // YouTube 的公开订阅源时好时坏，先读频道的「视频」页
    if (s.platform === "youtube") items = await youtubeItems(s.url).catch(() => null);
    if (!items?.length) {
      if (!feedUrl) {
        const page = await fetchHtml(s.url, 15_000);
        html = page.html;
        feedUrl = feedOf(html, page.url);
      }
      if (feedUrl) {
        try {
          items = parseFeed((await fetchHtml(feedUrl, 15_000)).html);
        } catch {
          items = null;
        }
        if (!items?.length) feedUrl = null;
      }
    }
    if (items?.length) {
      const known = new Set(
        (await prisma.socialPost.findMany({ where: { socialId: s.id, externalId: { in: items.map((i) => i.id) } }, select: { externalId: true } })).map(
          (x) => x.externalId,
        ),
      );
      // 第一次把这一页都记成已读的历史，免得一加账号就刷屏；之后只有没见过的才算新内容
      const fresh = items.filter((i) => !known.has(i.id));
      for (const i of fresh) {
        await prisma.socialPost.create({
          data: {
            tenantId: s.tenantId,
            socialId: s.id,
            customerId: s.customerId,
            externalId: i.id,
            kind: "post",
            title: i.title,
            url: i.url,
            summary: i.summary,
            image: i.image,
            publishedAt: i.publishedAt,
            readAt: first ? now : null,
          },
        });
      }
      const added = first ? 0 : fresh.length;
      if (added) await logActivity(s, `${platformInfo(s.platform).label} 有 ${added} 条新内容：${fresh[0].title}`);
      await prisma.customerSocial.update({
        where: { id: s.id },
        data: { feedUrl, checkedAt: now, lastError: null, ...(added ? { changedAt: now } : {}) },
      });
      return { added };
    }

    // 没有订阅源：比对主页的标题和简介
    const raw = html ?? (await fetchHtml(s.url, 15_000)).html;
    const title = decodeEntities(meta(raw, "og:title") ?? raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
    const desc = decodeEntities(meta(raw, "og:description") ?? meta(raw, "description") ?? "").trim();
    if (LOGIN_WALL.test(`${title} ${desc}`) || (!title && !desc)) throw new Error("需要登录才能看，暂时无法自动跟踪");
    const fp = createHash("sha256").update(`${title}\n${desc}`).digest("hex").slice(0, 24);
    let added = 0;
    if (s.fingerprint && s.fingerprint !== fp) {
      const r = await prisma.socialPost.createMany({
        data: [
          {
            tenantId: s.tenantId,
            socialId: s.id,
            customerId: s.customerId,
            externalId: `page:${fp}`,
            kind: "profile",
            title: title ? `主页更新：${title}` : "主页资料有更新",
            url: s.url,
            summary: desc.slice(0, 500) || null,
            image: meta(raw, "og:image"),
            publishedAt: now,
          },
        ],
        skipDuplicates: true,
      });
      added = r.count;
      if (added) await logActivity(s, `${platformInfo(s.platform).label} 主页资料有更新${desc ? `：${desc.slice(0, 80)}` : ""}`);
    }
    await prisma.customerSocial.update({
      where: { id: s.id },
      data: { fingerprint: fp, checkedAt: now, lastError: null, ...(added ? { changedAt: now } : {}) },
    });
    return { added };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    const error = /\b(401|403|429|451|999)\b/.test(msg) ? "平台拒绝了未登录访问，暂时无法自动跟踪" : msg;
    await prisma.customerSocial.update({ where: { id: s.id }, data: { checkedAt: now, lastError: error } });
    return { added: 0, error };
  }
}

async function logActivity(s: { tenantId: string; customerId: string; id: string }, content: string) {
  await prisma.activity.create({
    data: { tenantId: s.tenantId, customerId: s.customerId, type: "SYSTEM", event: "social", refKey: `social:${s.id}`, content },
  });
}

/** worker：查到期的账号（星级够的客户、没关跟踪、平台能跟踪） */
export async function runSocialWatch(log: (...a: unknown[]) => void) {
  const tenants = await prisma.tenant.findMany({ where: { socialWatchStar: { gt: 0 } }, select: { id: true, socialWatchStar: true } });
  const due = new Date(Date.now() - SOCIAL_CHECK_HOURS * HOUR);
  // 要登录的平台失败后一天才重试一次
  const failedDue = new Date(Date.now() - 24 * HOUR);
  let left = BATCH;
  for (const t of tenants) {
    if (left <= 0) break;
    const rows = await prisma.customerSocial.findMany({
      where: {
        tenantId: t.id,
        watch: true,
        platform: { notIn: ["whatsapp", "wechat", "telegram"] },
        customer: { star: { gte: t.socialWatchStar } },
        OR: [{ checkedAt: null }, { checkedAt: { lt: due }, lastError: null }, { checkedAt: { lt: failedDue } }],
      },
      orderBy: { checkedAt: { sort: "asc", nulls: "first" } },
      take: left,
      select: { id: true, url: true },
    });
    left -= rows.length;
    for (const r of rows) {
      const res = await checkSocial(r.id);
      if (res.added) log("[social]", r.url, `+${res.added}`);
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  }
}
