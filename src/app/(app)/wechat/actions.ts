"use server";

import { revalidatePath } from "next/cache";
import { prisma, tenantDb } from "@/server/db";
import { ensureWxAccount, ingestWechatSync, requireWechatUser, stageWechatReply } from "@/server/wechat";
import { parsePastedWechatLog } from "@/lib/wechat";
import { aiComplete, aiConfigured } from "@/server/ai";
import { can } from "@/server/auth";

export async function createWechatChatAction(input: {
  wechatNo?: string;
  remark?: string;
  name?: string;
  isGroup?: boolean;
  customerId?: string | null;
}) {
  const user = await requireWechatUser();
  const account = await ensureWxAccount(user.tenantId, user.id);
  const wechatNo = input.wechatNo?.trim() || null;
  const remark = input.remark?.trim() || null;
  const name = input.name?.trim() || null;
  if (!wechatNo && !remark && !name) {
    return { error: "请至少填写微信号、备注名或昵称中的一项" };
  }

  const wxKey = wechatNo ? `wxno:${wechatNo}` : `manual:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const existing = wechatNo
    ? await prisma.wxChat.findFirst({ where: { accountId: account.id, OR: [{ wxKey }, { wechatNo }] } })
    : null;

  if (existing) {
    return { ok: true, chatId: existing.id, existed: true };
  }

  const chat = await prisma.wxChat.create({
    data: {
      tenantId: user.tenantId,
      accountId: account.id,
      wxKey,
      wechatNo,
      remark,
      name,
      isGroup: !!input.isGroup,
      syncEnabled: true,
      customerId: input.customerId || null,
      lastMessageAt: new Date(),
    },
  });

  revalidatePath("/wechat");
  return { ok: true, chatId: chat.id };
}

export async function updateWechatChatAction(
  chatId: string,
  patch: {
    wechatNo?: string | null;
    remark?: string | null;
    name?: string | null;
    syncEnabled?: boolean;
    pinned?: boolean;
    archived?: boolean;
    markRead?: boolean;
  },
) {
  const user = await requireWechatUser();
  const account = await ensureWxAccount(user.tenantId, user.id);
  const chat = await prisma.wxChat.findFirst({
    where: { id: chatId, accountId: account.id, tenantId: user.tenantId },
  });
  if (!chat) return { error: "会话不存在" };

  await prisma.wxChat.update({
    where: { id: chat.id },
    data: {
      ...(patch.wechatNo !== undefined ? { wechatNo: patch.wechatNo?.trim() || null } : {}),
      ...(patch.remark !== undefined ? { remark: patch.remark?.trim() || null } : {}),
      ...(patch.name !== undefined ? { name: patch.name?.trim() || null } : {}),
      ...(patch.syncEnabled !== undefined ? { syncEnabled: patch.syncEnabled } : {}),
      ...(patch.pinned !== undefined ? { pinnedAt: patch.pinned ? new Date() : null } : {}),
      ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
      ...(patch.markRead ? { unread: 0 } : {}),
    },
  });

  revalidatePath("/wechat");
  return { ok: true };
}

export async function linkWechatCustomerAction(chatId: string, customerId: string | null) {
  const user = await requireWechatUser();
  const account = await ensureWxAccount(user.tenantId, user.id);
  const chat = await prisma.wxChat.findFirst({
    where: { id: chatId, accountId: account.id, tenantId: user.tenantId },
  });
  if (!chat) return { error: "会话不存在" };

  let contactId: string | null = null;
  if (customerId) {
    const db = tenantDb(user.tenantId);
    const customer = await db.customer.findFirst({
      where: { id: customerId },
      select: { id: true, contacts: { orderBy: { isPrimary: "desc" }, take: 1, select: { id: true, wechat: true } } },
    });
    if (!customer) return { error: "客户不存在" };
    const primary = customer.contacts[0];
    if (primary) {
      contactId = primary.id;
      if (chat.wechatNo && !primary.wechat) {
        await prisma.contact.update({ where: { id: primary.id }, data: { wechat: chat.wechatNo } }).catch(() => null);
      }
    }
  }

  await prisma.wxChat.update({
    where: { id: chat.id },
    data: { customerId: customerId || null, contactId },
  });

  revalidatePath("/wechat");
  return { ok: true };
}

export async function stageWechatMessageAction(input: { chatId: string; body: string; searchKeyOverride?: string }) {
  const user = await requireWechatUser();
  try {
    const staged = await stageWechatReply(user, input.chatId, {
      body: input.body,
      searchKeyOverride: input.searchKeyOverride,
    });
    revalidatePath("/wechat");
    return { ok: true, ...staged };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "上屏记录创建失败" };
  }
}

export async function confirmWechatMessageAction(messageId: string, status: "SENT" | "FAILED", error?: string) {
  const user = await requireWechatUser();
  const account = await ensureWxAccount(user.tenantId, user.id);
  const msg = await prisma.wxMessage.findFirst({
    where: { id: messageId, accountId: account.id, tenantId: user.tenantId },
  });
  if (!msg) return { error: "消息不存在" };

  await prisma.wxMessage.update({
    where: { id: msg.id },
    data: {
      status,
      confirmedAt: status === "SENT" ? new Date() : null,
      error: status === "FAILED" ? (error || "上屏失败").slice(0, 300) : null,
    },
  });

  revalidatePath("/wechat");
  return { ok: true };
}

export async function importPastedWechatLogAction(input: { chatId: string; rawText: string; defaultFromMe?: boolean }) {
  const user = await requireWechatUser();
  const account = await ensureWxAccount(user.tenantId, user.id);
  const chat = await prisma.wxChat.findFirst({
    where: { id: input.chatId, accountId: account.id, tenantId: user.tenantId },
  });
  if (!chat) return { error: "会话不存在" };

  const lines = parsePastedWechatLog(input.rawText, {
    myName: account.name,
    defaultFromMe: input.defaultFromMe ?? false,
  });
  if (!lines.length) return { error: "未识别到有效聊天内容" };

  const res = await ingestWechatSync(user.tenantId, user.id, {
    threads: [
      {
        wxKey: chat.wxKey,
        wechatNo: chat.wechatNo ?? undefined,
        remark: chat.remark ?? undefined,
        name: chat.name ?? undefined,
        isGroup: chat.isGroup,
        messages: lines.map((l) => ({
          fromMe: l.fromMe,
          senderName: l.senderName,
          text: l.text,
          type: "text",
          at: l.at,
        })),
      },
    ],
  });

  revalidatePath("/wechat");
  return { ok: true, count: lines.length, inserted: res.inserted, confirmed: res.confirmed };
}

export async function updateWechatSettingsAction(input: {
  syncMode: "whitelist" | "all";
  remarkPrefix: string;
  name?: string;
  wechatNo?: string;
}) {
  const user = await requireWechatUser();
  const account = await ensureWxAccount(user.tenantId, user.id);
  await prisma.wxAccount.update({
    where: { id: account.id },
    data: {
      syncMode: input.syncMode,
      remarkPrefix: input.remarkPrefix.trim().slice(0, 30) || "客户-",
      ...(input.name !== undefined ? { name: input.name.trim().slice(0, 80) || null } : {}),
      ...(input.wechatNo !== undefined ? { wechatNo: input.wechatNo.trim().slice(0, 80) || null } : {}),
    },
  });
  revalidatePath("/wechat");
  return { ok: true };
}

export async function searchCustomersForWechatAction(query: string) {
  const user = await requireWechatUser();
  const db = tenantDb(user.tenantId);
  const q = query.trim();
  const rows = await db.customer.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { contacts: { some: { OR: [{ name: { contains: q, mode: "insensitive" } }, { wechat: { contains: q, mode: "insensitive" } }] } } },
          ],
        }
      : {},
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, name: true, country: true },
  });
  return rows;
}

export async function draftWechatReplyAction(chatId: string, instruction?: string) {
  const user = await requireWechatUser();
  if (!can(user, "ai.use") || !aiConfigured()) {
    return { error: "当前未配置 AI 服务或无 AI 权限" };
  }
  const account = await ensureWxAccount(user.tenantId, user.id);
  const chat = await prisma.wxChat.findFirst({
    where: { id: chatId, accountId: account.id, tenantId: user.tenantId },
    include: {
      customer: { select: { name: true, country: true, remark: true } },
      messages: { orderBy: { timestamp: "desc" }, take: 12 },
    },
  });
  if (!chat) return { error: "会话不存在" };

  const history = [...chat.messages]
    .reverse()
    .map((m) => `${m.fromMe ? "我方" : m.senderName || "客户"}: ${m.body}`)
    .join("\n");

  const prompt = [
    "你是一名专业的外贸销售顾问，请根据以下微信聊天记录草拟一条自然、简洁、适合微信直接发送的回复。",
    "要求：口语化、不要带邮件抬头落款、直接输出可发送的正文（不要解释）。如果客户用英文则用英文，中文则用中文。",
    chat.customer ? `客户信息：${chat.customer.name}${chat.customer.country ? ` (${chat.customer.country})` : ""}` : "",
    instruction?.trim() ? `补充要求：${instruction.trim()}` : "",
    history ? `最近聊天记录：\n${history}` : "（暂无历史消息，请礼貌破冰跟进）",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const text = await aiComplete({ messages: [{ role: "user", content: prompt }], maxTokens: 400 });
    return { ok: true, text: text.trim() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI 生成失败" };
  }
}
