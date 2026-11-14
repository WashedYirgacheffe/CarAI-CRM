import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";

/**
 * WhatsApp 页轮询用：只回一个很短的「版本号」，有新消息、未读变化、发送状态变了、媒体下载好了才会变。
 * 页面拿到新版本号才整页刷新，不再每 4 秒把会话列表和消息全拉一遍。
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const account = await prisma.waAccount.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true, syncStatus: true, syncProgress: true, avatarAt: true },
  });
  if (!account) return Response.json({ s: "none" });
  const db = tenantDb(user.tenantId);
  const chatId = req.nextUrl.searchParams.get("chat");
  const [chats, chat] = await Promise.all([
    db.waChat.aggregate({
      where: { accountId: account.id },
      _count: true,
      _max: { lastMessageAt: true, avatarAt: true, pinnedAt: true },
      _sum: { unread: true },
    }),
    chatId
      ? db.waMessage.groupBy({
          by: ["status"],
          where: { chatId, accountId: account.id, hiddenAt: null },
          _count: { _all: true, mediaKey: true },
          _max: { timestamp: true },
        })
      : null,
  ]);
  const t = (d: Date | null | undefined) => d?.getTime() ?? 0;
  const parts = [
    account.status,
    account.syncStatus,
    account.syncProgress,
    t(account.avatarAt),
    chats._count,
    t(chats._max.lastMessageAt),
    t(chats._max.avatarAt),
    t(chats._max.pinnedAt),
    chats._sum.unread ?? 0,
    ...(chat ?? []).map((g) => `${g.status}:${g._count._all}:${g._count.mediaKey}:${t(g._max.timestamp)}`),
  ];
  return Response.json({ s: parts.join("|") }, { headers: { "Cache-Control": "no-store" } });
}
