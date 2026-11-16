import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { enqueueMatrixJob, logMatrixEvent, runnableAccounts } from "@/server/matrix";
import { kickCloud } from "@/server/matrix-cloud";
import { googleTranslateCode } from "@/server/translate";
import { looksForeign } from "@/lib/lang";
import { INBOX_PLATFORMS, INBOX_SYNC_EVERY_MS, isChineseLang, maskContacts, maskHandle } from "@/lib/inbox";
import type { Prisma } from "@/generated/prisma/client";

/*
 * 社媒收件箱：运行器把私信同步上来（/api/matrix/runner/jobs/[id]/inbox），这里入库、去重、翻译、归到客户；
 * CRM 里回复 → 消息排队 → 回复任务领走时一次发完这个账号所有待发消息。
 */

// ── 运行器上报的格式 ──

export const InboxPayload = z.object({
  threads: z
    .array(
      z.object({
        /** 会话标识：链接里的会话 id，没有就用对方名字 */
        key: z.string().min(1).max(300),
        url: z.string().max(1000).optional(),
        peer: z
          .object({
            name: z.string().max(200).optional(),
            handle: z.string().max(200).optional(),
            url: z.string().max(1000).optional(),
            avatar: z.string().max(2000).optional(),
          })
          .optional(),
        messages: z
          .array(
            z.object({
              /** 平台消息 id（读接口时有；读页面时没有） */
              id: z.string().max(200).optional(),
              fromMe: z.boolean(),
              text: z.string().max(8000),
              type: z.enum(["text", "image", "video", "other"]).optional(),
              /** 毫秒时间戳（读接口时有） */
              at: z.number().optional(),
            }),
          )
          .max(300),
      }),
    )
    .max(100),
});
export type InboxPayload = z.infer<typeof InboxPayload>;

const norm = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 500);
const keyOf = (m: { fromMe: boolean; body: string }) => `${m.fromMe ? 1 : 0}|${norm(m.body)}`;
const digest = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 24);

/**
 * 读页面拿到的消息没有 id：和库里最近的消息按顺序对齐，只取对齐点之后的作为新消息。
 * 对不上（第一次同步、或者翻得太远）就取库里没有的。
 */
function newBySequence(stored: string[], incoming: string[]) {
  if (!stored.length) return incoming.map((_, i) => i);
  const last = stored.length - 1;
  for (let e = incoming.length - 1; e >= 0; e--) {
    if (incoming[e] !== stored[last]) continue;
    let ok = true;
    for (let k = 1; k <= Math.min(e, last, 5); k++) {
      if (incoming[e - k] !== stored[last - k]) {
        ok = false;
        break;
      }
    }
    if (ok) return incoming.map((_, i) => i).filter((i) => i > e);
  }
  const seen = new Set(stored);
  return incoming.map((k, i) => [k, i] as const).filter(([k]) => !seen.has(k)).map(([, i]) => i);
}

/** 对方主页 / 用户名和客户的社媒档案对上了就自动归到这个客户 */
async function matchCustomer(tenantId: string, platform: string, peer?: { handle?: string; url?: string }) {
  const handle = peer?.handle?.replace(/^@/, "").trim();
  const or: Prisma.CustomerSocialWhereInput[] = [];
  if (handle && handle.length >= 3) {
    or.push({ handle: { equals: handle, mode: "insensitive" } }, { handle: { equals: `@${handle}`, mode: "insensitive" } });
    or.push({ url: { contains: `/${handle}`, mode: "insensitive" } });
  }
  if (peer?.url) or.push({ url: { equals: peer.url.replace(/\/+$/, ""), mode: "insensitive" } });
  if (!or.length) return null;
  const hit = await prisma.customerSocial.findFirst({ where: { tenantId, platform, OR: or }, select: { customerId: true } });
  return hit?.customerId ?? null;
}

/** 运行器同步上来的私信入库，返回新收到的消息数 */
export async function ingestInbox(tenantId: string, accountId: string, data: InboxPayload) {
  const account = await prisma.matrixAccount.findFirst({
    where: { id: accountId, tenantId },
    select: { id: true, platform: true, ownerId: true, inboxAt: true },
  });
  if (!account) return 0;
  // 第一次同步拉的是历史消息，不算未读
  const first = !account.inboxAt;
  let received = 0;
  const toTranslate: { id: string; threadId: string; text: string }[] = [];

  for (const t of data.threads) {
    const peer = t.peer ?? {};
    let thread = await prisma.socialThread.findUnique({ where: { accountId_externalId: { accountId, externalId: t.key } } });
    if (!thread) {
      thread = await prisma.socialThread.create({
        data: {
          tenantId,
          accountId,
          platform: account.platform,
          externalId: t.key,
          url: t.url ?? null,
          peerName: peer.name ?? null,
          peerHandle: peer.handle ?? null,
          peerUrl: peer.url ?? null,
          peerAvatar: peer.avatar ?? null,
          assigneeId: account.ownerId,
          customerId: await matchCustomer(tenantId, account.platform, peer),
        },
      });
    } else {
      thread = await prisma.socialThread.update({
        where: { id: thread.id },
        data: {
          ...(t.url ? { url: t.url } : {}),
          ...(peer.name ? { peerName: peer.name } : {}),
          ...(peer.handle ? { peerHandle: peer.handle } : {}),
          ...(peer.url ? { peerUrl: peer.url } : {}),
          ...(peer.avatar ? { peerAvatar: peer.avatar } : {}),
          ...(!thread.customerId ? { customerId: await matchCustomer(tenantId, account.platform, peer) } : {}),
        },
      });
    }

    const msgs = t.messages.filter((m) => m.text.trim() || m.type !== "text");
    if (!msgs.length) continue;
    let fresh: number[];
    if (msgs.every((m) => m.id)) {
      const have = new Set(
        (
          await prisma.socialMessage.findMany({
            where: { threadId: thread.id, externalId: { in: msgs.map((m) => m.id!) } },
            select: { externalId: true },
          })
        ).map((m) => m.externalId),
      );
      fresh = msgs.map((m, i) => [m, i] as const).filter(([m]) => !have.has(m.id!)).map(([, i]) => i);
    } else {
      const stored = (
        await prisma.socialMessage.findMany({
          where: { threadId: thread.id, status: { not: "failed" } },
          orderBy: { timestamp: "desc" },
          take: 150,
          select: { fromMe: true, body: true },
        })
      ).reverse();
      fresh = newBySequence(
        stored.map(keyOf),
        msgs.map((m) => keyOf({ fromMe: m.fromMe, body: m.text })),
      );
    }
    if (!fresh.length) continue;

    const now = Date.now();
    let inbound = 0;
    let last: { at: Date; text: string; fromMe: boolean } | null = null;
    for (const [n, i] of fresh.entries()) {
      const m = msgs[i];
      const at = new Date(m.at && m.at > 1e12 ? m.at : now - (fresh.length - n));
      const body = m.text.slice(0, 8000);
      // CRM 里发出去的消息同步回来：认领那条，补上平台 id，不再重复建
      if (m.fromMe) {
        const mine = await prisma.socialMessage.findFirst({
          where: { threadId: thread.id, fromMe: true, externalId: null, status: { in: ["sent", "sending"] }, body },
          orderBy: { timestamp: "desc" },
          select: { id: true },
        });
        if (mine) {
          await prisma.socialMessage.update({
            where: { id: mine.id },
            data: { externalId: m.id ?? `h:${digest(`${thread.id}|${now}|${n}|${body}`)}`, status: "sent" },
          });
          last = { at, text: body, fromMe: true };
          continue;
        }
      }
      const ext = m.id ?? `h:${digest(`${thread.id}|${now}|${n}|${keyOf({ fromMe: m.fromMe, body })}`)}`;
      const created = await prisma.socialMessage
        .create({
          data: {
            tenantId,
            threadId: thread.id,
            externalId: ext,
            fromMe: m.fromMe,
            type: m.type ?? "text",
            body,
            status: m.fromMe ? "sent" : "received",
            timestamp: at,
          },
          select: { id: true },
        })
        .catch(() => null);
      if (!created) continue;
      if (!m.fromMe) {
        inbound++;
        if (body.trim() && looksForeign(body, 2)) toTranslate.push({ id: created.id, threadId: thread.id, text: body });
      }
      last = { at, text: body, fromMe: m.fromMe };
    }
    received += inbound;
    if (last && (!thread.lastMessageAt || last.at >= thread.lastMessageAt)) {
      await prisma.socialThread.update({
        where: { id: thread.id },
        data: {
          lastMessageAt: last.at,
          lastText: last.text.slice(0, 300) || "[图片 / 视频]",
          lastFromMe: last.fromMe,
          ...(!first && inbound ? { unread: { increment: inbound }, archived: false } : {}),
        },
      });
    }
  }

  await prisma.matrixAccount.update({ where: { id: accountId }, data: { inboxAt: new Date() } });
  if (toTranslate.length) await translateInbound(toTranslate);
  return first ? 0 : received;
}

/** 收到的外文消息译成中文，顺便记下对方语言 */
async function translateInbound(rows: { id: string; threadId: string; text: string }[]) {
  try {
    const out = await googleTranslateCode(
      rows.map((r) => r.text),
      "zh-CN",
    );
    const langs = new Map<string, string>();
    for (const [i, r] of rows.entries()) {
      const { text, src } = out[i];
      if (src && !isChineseLang(src)) langs.set(r.threadId, src);
      if (text.trim() && text.trim() !== r.text.trim()) await prisma.socialMessage.update({ where: { id: r.id }, data: { translation: text } });
    }
    for (const [threadId, lang] of langs) await prisma.socialThread.update({ where: { id: threadId }, data: { peerLang: lang } });
  } catch (e) {
    console.warn("inbox translate failed:", (e as Error).message);
  }
}

// ── 回复 ──

/** 回复任务被领走：取这个账号所有待发消息，标成发送中 */
export async function claimReplies(accountId: string) {
  const rows = await prisma.socialMessage.findMany({
    where: { status: "queued", thread: { accountId } },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { id: true, body: true, thread: { select: { externalId: true, url: true, peerName: true } } },
  });
  if (rows.length) await prisma.socialMessage.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "sending" } });
  return rows.map((r) => ({ id: r.id, text: r.body, thread: { key: r.thread.externalId, url: r.thread.url, name: r.thread.peerName } }));
}

/** 回复任务结束：按运行器回报更新每条消息；没回报到的算失败 */
export async function settleReplies(accountId: string, results: { id: string; ok: boolean; error?: string }[], fallbackError: string | null) {
  for (const r of results) {
    await prisma.socialMessage.updateMany({
      where: { id: r.id, status: "sending" },
      data: r.ok ? { status: "sent", error: null } : { status: "failed", error: (r.error ?? "发送失败").slice(0, 300) },
    });
  }
  await prisma.socialMessage.updateMany({
    where: { status: "sending", thread: { accountId }, id: { notIn: results.map((r) => r.id) } },
    data: { status: "failed", error: (fallbackError ?? "运行器没有回报发送结果").slice(0, 300) },
  });
  // 跑的时候又有新消息排进来：再排一个
  const left = await prisma.socialMessage.findFirst({ where: { status: "queued", thread: { accountId } }, select: { tenantId: true } });
  if (left) await enqueueMatrixJob({ tenantId: left.tenantId, accountId, kind: "reply", userId: null });
}

// ── 定时同步 ──

/** 开了「收私信」的已登录账号，每 10 分钟排一个同步任务 */
export async function scheduleInboxSync() {
  const cutoff = new Date(Date.now() - INBOX_SYNC_EVERY_MS + 30_000);
  const due = await prisma.matrixAccount.findMany({
    where: {
      inboxSync: true,
      status: "active",
      proxyId: { not: null },
      platform: { in: [...INBOX_PLATFORMS] },
      jobs: { none: { OR: [{ kind: "inbox", createdAt: { gte: cutoff } }, { status: { in: ["queued", "running", "waiting"] } }] } },
    },
    select: { id: true, tenantId: true, deviceId: true },
    take: 500,
  });
  const tenants = new Set<string>();
  const runnable = await runnableAccounts(due);
  for (const a of runnable) {
    await enqueueMatrixJob({ tenantId: a.tenantId, accountId: a.id, kind: "inbox", userId: null, payload: { auto: true } });
    tenants.add(a.tenantId);
  }
  for (const tenantId of tenants) await kickCloud(tenantId);
  return runnable.length;
}

/** 手动「立即同步」 */
export async function syncInboxNow(tenantId: string, accountId: string, userId: string) {
  await enqueueMatrixJob({ tenantId, accountId, kind: "inbox", userId });
  await logMatrixEvent({ tenantId, accountId, userId, action: "inbox:sync" });
}

// ── 权限与脱敏 ──

/** 能看到哪些会话：管理全部社媒账号的看全部，其他人只看分给自己的 */
export function threadScope(user: CurrentUser): Prisma.SocialThreadWhereInput {
  if (can(user, "matrix.manage")) return { tenantId: user.tenantId };
  return { tenantId: user.tenantId, assigneeId: user.id };
}

export const canUseInbox = (user: CurrentUser) => can(user, "matrix.use") || can(user, "matrix.manage");

/** 没有 matrix.reveal 的人：主页链接隐藏、用户名和消息里的联系方式打码 */
export function revealer(user: CurrentUser) {
  const ok = can(user, "matrix.reveal");
  return {
    ok,
    handle: (h: string | null) => (ok ? h : maskHandle(h)),
    url: (u: string | null) => (ok ? u : null),
    text: (t: string) => (ok ? t : maskContacts(t)),
  };
}
