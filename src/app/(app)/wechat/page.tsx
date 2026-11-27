import type { Metadata } from "next";
import { prisma, tenantDb } from "@/server/db";
import { can } from "@/server/auth";
import { aiConfigured } from "@/server/ai";
import { ensureWxAccount, expireStagedWechatMessages, requireWechatUser } from "@/server/wechat";
import { WechatWorkspace } from "./wechat-workspace";

export const metadata: Metadata = { title: "微信" };

export default async function WechatPage({ searchParams }: PageProps<"/wechat">) {
  const user = await requireWechatUser();
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const account = await ensureWxAccount(user.tenantId, user.id);
  await expireStagedWechatMessages(account.id);

  const db = tenantDb(user.tenantId);
  const q = s("q").trim();
  const f = s("f");
  const chatId = s("chat");
  const contains = { contains: q, mode: "insensitive" as const };

  const [chats, activeChat, quickReplies, unreadChats, archivedCount] = await Promise.all([
    db.wxChat.findMany({
      where: {
        accountId: account.id,
        archived: f === "archived",
        ...(f === "unread"
          ? { unread: { gt: 0 } }
          : f === "customer"
            ? { customerId: { not: null } }
            : f === "unlinked"
              ? { customerId: null }
              : f === "group"
                ? { isGroup: true }
                : {}),
        ...(q
          ? {
              OR: [
                { name: contains },
                { remark: contains },
                { wechatNo: contains },
                { customer: { name: contains } },
              ],
            }
          : {}),
      },
      orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { lastMessageAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 300,
      include: { customer: { select: { id: true, name: true, country: true } } },
    }),
    chatId
      ? db.wxChat.findFirst({
          where: { id: chatId, accountId: account.id },
          include: {
            customer: { select: { id: true, name: true, country: true } },
            messages: { orderBy: { timestamp: "asc" }, take: 200 },
          },
        })
      : null,
    db.quickReply.findMany({
      orderBy: { sort: "asc" },
      take: 30,
      select: { id: true, title: true, body: true },
    }),
    db.wxChat.count({ where: { accountId: account.id, archived: false, unread: { gt: 0 } } }),
    db.wxChat.count({ where: { accountId: account.id, archived: true } }),
  ]);

  if (activeChat && activeChat.unread > 0) {
    await prisma.wxChat.update({ where: { id: activeChat.id }, data: { unread: 0 } }).catch(() => null);
  }

  const canAi = can(user, "ai.use") && aiConfigured();

  return (
    <WechatWorkspace
      account={{
        id: account.id,
        name: account.name,
        wechatNo: account.wechatNo,
        platform: account.platform,
        syncMode: account.syncMode === "all" ? "all" : "whitelist",
        remarkPrefix: account.remarkPrefix,
        status: account.status,
        lastError: account.lastError,
        lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
        syncMessages: account.syncMessages,
      }}
      filter={f}
      query={q}
      unreadChats={unreadChats}
      archivedCount={archivedCount}
      canAi={canAi}
      quickReplies={quickReplies}
      chats={chats.map((c) => ({
        id: c.id,
        wxKey: c.wxKey,
        wechatNo: c.wechatNo,
        remark: c.remark,
        name: c.name,
        isGroup: c.isGroup,
        syncEnabled: c.syncEnabled,
        customerId: c.customerId,
        customer: c.customer,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        lastText: c.lastText,
        unread: c.id === activeChat?.id ? 0 : c.unread,
        lastFromMe: c.lastFromMe,
        pinnedAt: c.pinnedAt?.toISOString() ?? null,
        archived: c.archived,
      }))}
      activeChat={
        activeChat
          ? {
              id: activeChat.id,
              wxKey: activeChat.wxKey,
              wechatNo: activeChat.wechatNo,
              remark: activeChat.remark,
              name: activeChat.name,
              isGroup: activeChat.isGroup,
              syncEnabled: activeChat.syncEnabled,
              customerId: activeChat.customerId,
              customer: activeChat.customer,
              pinnedAt: activeChat.pinnedAt?.toISOString() ?? null,
              archived: activeChat.archived,
              messages: activeChat.messages.map((m) => ({
                id: m.id,
                fromMe: m.fromMe,
                senderName: m.senderName,
                type: m.type,
                body: m.body,
                translation: m.translation,
                status: m.status,
                error: m.error,
                timestamp: m.timestamp.toISOString(),
                stagedAt: m.stagedAt?.toISOString() ?? null,
                confirmedAt: m.confirmedAt?.toISOString() ?? null,
              })),
            }
          : null
      }
    />
  );
}
