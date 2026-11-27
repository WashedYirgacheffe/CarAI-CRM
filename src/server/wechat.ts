import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/server/db";
import { can, getCurrentUser, requireUser, type CurrentUser } from "@/server/auth";
import { runnerAuth } from "@/server/matrix";
import { googleTranslateCode } from "@/server/translate";
import { looksForeign } from "@/lib/lang";
import { resolveWechatSearchKey } from "@/lib/wechat";
import { redirect } from "next/navigation";

/** 有 wechat.use 或 whatsapp.use 均可使用微信模块（平滑兼容老租户角色） */
export const canUseWechat = (user: CurrentUser) => can(user, "wechat.use") || can(user, "whatsapp.use");

export async function requireWechatUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canUseWechat(user)) redirect("/forbidden");
  return user;
}

/** 校验来自桌面端设备令牌（Bearer md_...）或浏览器登录态的请求 */
export async function authWechatRequest(req: Request): Promise<{ tenantId: string; userId: string; deviceId: string | null } | null> {
  const runner = await runnerAuth(req);
  if (runner?.device) {
    return { tenantId: runner.tenantId, userId: runner.device.userId, deviceId: runner.device.id };
  }
  const user = await getCurrentUser();
  if (!user || !canUseWechat(user)) return null;
  return { tenantId: user.tenantId, userId: user.id, deviceId: null };
}

/** 确保业务员拥有微信桥接账号记录 */
export async function ensureWxAccount(tenantId: string, userId: string) {
  return prisma.wxAccount.upsert({
    where: { userId },
    create: { tenantId, userId, status: "DISCONNECTED" },
    update: {},
  });
}

/** 超过 10 分钟仍未收到发送回执的 STAGED 消息，自动转为 UNCONFIRMED 提醒防漏发 */
export async function expireStagedWechatMessages(accountId: string) {
  const cutoff = new Date(Date.now() - 10 * 60_000);
  await prisma.wxMessage.updateMany({
    where: { accountId, status: "STAGED", stagedAt: { lt: cutoff } },
    data: { status: "UNCONFIRMED" },
  });
}

/** 自动匹配 CRM 客户与联系人：优先微信号，其次备注名/昵称精确匹配 */
export async function matchWechatCustomer(
  tenantId: string,
  peer: { wechatNo?: string | null; remark?: string | null; name?: string | null },
): Promise<{ customerId: string; contactId: string | null } | null> {
  const wechatNo = peer.wechatNo?.trim();
  if (wechatNo) {
    const hit = await prisma.contact.findFirst({
      where: { tenantId, wechat: { equals: wechatNo, mode: "insensitive" } },
      select: { id: true, customerId: true },
    });
    if (hit) return { customerId: hit.customerId, contactId: hit.id };
  }

  const candidates = [peer.remark?.trim(), peer.name?.trim()].filter((v): v is string => !!v && v.length >= 2);
  for (const raw of candidates) {
    // 去掉常见的白名单前缀（如 "客户-"、"[客户]"）再匹配
    const clean = raw.replace(/^(?:客户[-_：:\s]*|\[客户\]\s*)/i, "").trim();
    if (clean.length < 2) continue;
    const contact = await prisma.contact.findFirst({
      where: {
        tenantId,
        OR: [
          { wechat: { equals: clean, mode: "insensitive" } },
          { name: { equals: clean, mode: "insensitive" } },
        ],
      },
      select: { id: true, customerId: true },
    });
    if (contact) return { customerId: contact.customerId, contactId: contact.id };

    const customer = await prisma.customer.findFirst({
      where: { tenantId, name: { equals: clean, mode: "insensitive" } },
      select: { id: true },
    });
    if (customer) return { customerId: customer.id, contactId: null };
  }
  return null;
}

// ── 桌面端只读增量同步上报 ──

export const WechatIngestPayload = z.object({
  account: z
    .object({
      wxid: z.string().max(120).optional(),
      wechatNo: z.string().max(120).optional(),
      name: z.string().max(120).optional(),
      platform: z.string().max(40).optional(),
      status: z.enum(["DISCONNECTED", "READY", "SYNCING", "ERROR"]).optional(),
      lastError: z.string().max(500).nullable().optional(),
    })
    .optional(),
  threads: z
    .array(
      z.object({
        wxKey: z.string().min(1).max(200),
        wechatNo: z.string().max(120).optional(),
        remark: z.string().max(200).optional(),
        name: z.string().max(200).optional(),
        isGroup: z.boolean().optional(),
        messages: z
          .array(
            z.object({
              wxMsgId: z.string().max(200).optional(),
              fromMe: z.boolean(),
              senderName: z.string().max(120).optional(),
              type: z.enum(["text", "image", "video", "audio", "document", "other"]).optional(),
              text: z.string().max(8000),
              at: z.number().optional(),
            }),
          )
          .max(500),
      }),
    )
    .max(200)
    .default([]),
});
export type WechatIngestPayload = z.infer<typeof WechatIngestPayload>;

const normBody = (t: string) => t.replace(/\s+/g, " ").trim();
const shortHash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 24);

/** 桌面端上报增量微信会话与消息，完成去重、发送回执自动闭环、客户归属与外文翻译 */
export async function ingestWechatSync(
  tenantId: string,
  userId: string,
  payload: WechatIngestPayload,
  deviceId?: string | null,
) {
  const account = await ensureWxAccount(tenantId, userId);
  const firstSync = !account.lastSyncAt;
  const now = new Date();

  let inserted = 0;
  let confirmed = 0;
  const toTranslate: { id: string; text: string }[] = [];

  for (const t of payload.threads) {
    let chat = await prisma.wxChat.findUnique({
      where: { accountId_wxKey: { accountId: account.id, wxKey: t.wxKey } },
    });

    if (!chat) {
      const matched = await matchWechatCustomer(tenantId, {
        wechatNo: t.wechatNo,
        remark: t.remark,
        name: t.name,
      });
      chat = await prisma.wxChat.create({
        data: {
          tenantId,
          accountId: account.id,
          wxKey: t.wxKey,
          wechatNo: t.wechatNo?.trim() || null,
          remark: t.remark?.trim() || null,
          name: t.name?.trim() || null,
          isGroup: t.isGroup ?? t.wxKey.endsWith("@chatroom"),
          customerId: matched?.customerId ?? null,
          contactId: matched?.contactId ?? null,
        },
      });
    } else {
      const updates: Record<string, unknown> = {};
      if (t.wechatNo?.trim() && t.wechatNo.trim() !== chat.wechatNo) updates.wechatNo = t.wechatNo.trim();
      if (t.remark?.trim() && t.remark.trim() !== chat.remark) updates.remark = t.remark.trim();
      if (t.name?.trim() && t.name.trim() !== chat.name) updates.name = t.name.trim();
      if (!chat.customerId) {
        const matched = await matchWechatCustomer(tenantId, {
          wechatNo: t.wechatNo ?? chat.wechatNo,
          remark: t.remark ?? chat.remark,
          name: t.name ?? chat.name,
        });
        if (matched) {
          updates.customerId = matched.customerId;
          updates.contactId = matched.contactId;
        }
      }
      if (Object.keys(updates).length) {
        chat = await prisma.wxChat.update({ where: { id: chat.id }, data: updates });
      }
    }

    const validMsgs = t.messages.filter((m) => m.text.trim() || (m.type && m.type !== "text"));
    if (!validMsgs.length) continue;

    let inboundCount = 0;
    let lastMsg: { at: Date; text: string; fromMe: boolean } | null = null;

    for (const [idx, m] of validMsgs.entries()) {
      const at = new Date(m.at && m.at > 1e12 ? m.at : m.at && m.at > 1e9 ? m.at * 1000 : Date.now() - (validMsgs.length - idx) * 10);
      const body = m.text.slice(0, 8000);
      const wxMsgId = m.wxMsgId?.trim() || `h:${shortHash(`${chat.id}|${Math.floor(at.getTime() / 1000)}|${m.fromMe ? 1 : 0}|${normBody(body).slice(0, 200)}`)}`;

      // 发送回执自动闭环：认领同会话最近 15 分钟内已上屏待确认的草稿
      if (m.fromMe) {
        const recentWindow = new Date(at.getTime() - 15 * 60_000);
        const stagedList = await prisma.wxMessage.findMany({
          where: {
            chatId: chat.id,
            fromMe: true,
            wxMsgId: null,
            status: { in: ["STAGED", "UNCONFIRMED"] },
            stagedAt: { gte: recentWindow },
          },
          orderBy: { stagedAt: "desc" },
          take: 10,
          select: { id: true, body: true },
        });
        const hit = stagedList.find((s) => normBody(s.body) === normBody(body));
        if (hit) {
          await prisma.wxMessage
            .update({
              where: { id: hit.id },
              data: { wxMsgId, status: "SENT", confirmedAt: at, timestamp: at, error: null },
            })
            .catch(() => null);
          confirmed++;
          if (!lastMsg || at >= lastMsg.at) lastMsg = { at, text: body, fromMe: true };
          continue;
        }
      }

      const created = await prisma.wxMessage
        .create({
          data: {
            tenantId,
            accountId: account.id,
            chatId: chat.id,
            wxMsgId,
            fromMe: m.fromMe,
            senderName: m.senderName?.trim() || null,
            type: m.type ?? "text",
            body,
            status: m.fromMe ? "SENT" : "RECEIVED",
            confirmedAt: m.fromMe ? at : null,
            timestamp: at,
          },
          select: { id: true },
        })
        .catch(() => null);

      if (!created) continue;
      inserted++;
      if (!m.fromMe) {
        inboundCount++;
        if (body.trim() && looksForeign(body, 2)) toTranslate.push({ id: created.id, text: body });
      }
      if (!lastMsg || at >= lastMsg.at) lastMsg = { at, text: body, fromMe: m.fromMe };
    }

    if (lastMsg && (!chat.lastMessageAt || lastMsg.at >= chat.lastMessageAt)) {
      await prisma.wxChat.update({
        where: { id: chat.id },
        data: {
          lastMessageAt: lastMsg.at,
          lastText: lastMsg.text.slice(0, 300) || "[图片 / 文件]",
          lastFromMe: lastMsg.fromMe,
          ...(!firstSync && inboundCount > 0 ? { unread: { increment: inboundCount }, archived: false } : {}),
        },
      });
    }
  }

  await prisma.wxAccount.update({
    where: { id: account.id },
    data: {
      ...(payload.account?.wxid ? { wxid: payload.account.wxid } : {}),
      ...(payload.account?.wechatNo ? { wechatNo: payload.account.wechatNo } : {}),
      ...(payload.account?.name ? { name: payload.account.name } : {}),
      ...(payload.account?.platform ? { platform: payload.account.platform } : {}),
      ...(deviceId ? { deviceId } : {}),
      status: payload.account?.status ?? "READY",
      lastError: payload.account?.lastError !== undefined ? payload.account.lastError : null,
      ...(payload.threads.length > 0 ? { lastSyncAt: now, syncMessages: { increment: inserted } } : {}),
    },
  });

  if (toTranslate.length) {
    try {
      const translated = await googleTranslateCode(
        toTranslate.map((r) => r.text),
        "zh-CN",
      );
      for (const [i, row] of toTranslate.entries()) {
        const text = translated[i]?.text?.trim();
        if (text && text !== row.text.trim()) {
          await prisma.wxMessage.update({ where: { id: row.id }, data: { translation: text } });
        }
      }
    } catch (e) {
      console.warn("wechat translate failed:", (e as Error).message);
    }
  }

  await expireStagedWechatMessages(account.id);
  return { accountId: account.id, inserted, confirmed };
}

/** 获取桌面端所需的白名单与同步策略配置 */
export async function getWechatSyncConfig(tenantId: string, userId: string) {
  const account = await ensureWxAccount(tenantId, userId);
  const [chats, contacts] = await Promise.all([
    prisma.wxChat.findMany({
      where: { accountId: account.id, syncEnabled: true, archived: false },
      select: { wxKey: true, wechatNo: true, remark: true, name: true, customerId: true },
      take: 500,
    }),
    prisma.contact.findMany({
      where: { tenantId, wechat: { not: null } },
      select: { wechat: true, name: true },
      take: 500,
    }),
  ]);

  return {
    accountId: account.id,
    syncMode: account.syncMode,
    remarkPrefix: account.remarkPrefix,
    lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
    whitelist: {
      wxKeys: chats.map((c) => c.wxKey).filter((k) => !k.startsWith("manual:")),
      wechatNos: Array.from(
        new Set([
          ...chats.map((c) => c.wechatNo).filter((v): v is string => !!v),
          ...contacts.map((c) => c.wechat).filter((v): v is string => !!v),
        ]),
      ),
      remarks: chats.map((c) => c.remark).filter((v): v is string => !!v),
    },
  };
}

/** 创建半自动「已上屏」消息，并返回安全搜索锚点供桌面端唤起微信 */
export async function stageWechatReply(
  user: CurrentUser,
  chatId: string,
  input: { body: string; type?: string; searchKeyOverride?: string },
) {
  const account = await ensureWxAccount(user.tenantId, user.id);
  const chat = await prisma.wxChat.findFirst({
    where: { id: chatId, accountId: account.id, tenantId: user.tenantId },
  });
  if (!chat) throw new Error("微信会话不存在");

  const body = input.body.trim().slice(0, 8000);
  if (!body) throw new Error("消息内容不能为空");

  const now = new Date();
  const msg = await prisma.wxMessage.create({
    data: {
      tenantId: user.tenantId,
      accountId: account.id,
      chatId: chat.id,
      fromMe: true,
      type: input.type ?? "text",
      body,
      status: "STAGED",
      sentById: user.id,
      stagedAt: now,
      timestamp: now,
    },
  });

  await prisma.wxChat.update({
    where: { id: chat.id },
    data: {
      lastMessageAt: now,
      lastText: body.slice(0, 300),
      lastFromMe: true,
      archived: false,
    },
  });

  const anchor = resolveWechatSearchKey(chat);
  return {
    messageId: msg.id,
    searchKey: input.searchKeyOverride?.trim() || anchor.key,
    searchKind: anchor.kind,
    body,
  };
}
