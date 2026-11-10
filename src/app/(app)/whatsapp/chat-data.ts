import "server-only";
import { waMediaOf } from "@/components/crm/wa-media";
import type { CurrentUser } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { countryName } from "@/lib/crm";

const avatarSrc = (id: string, key: string | null, at: Date | null) => (key ? `/api/whatsapp/avatar/${id}?v=${at?.getTime() ?? 0}` : null);

/** 一个 WhatsApp 会话的完整数据（消息、右侧面板），WhatsApp 页和工作台嵌入页共用 */
export async function loadChatView(user: CurrentUser, accountId: string, chatId: string) {
  const db = tenantDb(user.tenantId);
  const chat = await db.waChat.findFirst({
    where: { id: chatId, accountId: accountId },
    include: {
      customer: { select: { id: true, name: true, country: true, status: { select: { name: true } }, owner: { select: { name: true } } } },
      contact: { select: { name: true, title: true, email: true } },
    },
  });
  if (!chat) return null;
  const visible = { hiddenAt: null };
  const customerId = chat.customerId ?? null;
  const [messages, media, msgCount, starred, firstMsg, tasks, activities, quotations] = await Promise.all([
    db.waMessage.findMany({ where: { chatId: chat.id, ...visible }, orderBy: { timestamp: "desc" }, take: 300 }).then((r) => r.reverse()),
    db.waMessage.findMany({
      where: { chatId: chat.id, ...visible, mediaKey: { not: null }, type: { in: ["image", "video"] } },
      orderBy: { timestamp: "desc" },
      take: 12,
      select: { id: true, type: true },
    }),
    db.waMessage.count({ where: { chatId: chat.id, ...visible } }),
    db.waMessage.findMany({
      where: { chatId: chat.id, ...visible, starred: true },
      orderBy: { timestamp: "desc" },
      take: 30,
      select: { id: true, body: true, fromMe: true, timestamp: true, type: true },
    }),
    db.waMessage.findFirst({ where: { chatId: chat.id }, orderBy: { timestamp: "asc" }, select: { timestamp: true } }),
    db.task.findMany({
      where: { ownerId: user.id, OR: [{ link: `/whatsapp?chat=${chat.id}` }, ...(customerId ? [{ customerId }] : [])] },
      orderBy: [{ done: "asc" }, { dueAt: "asc" }],
      take: 30,
      include: { customer: { select: { name: true } } },
    }),
    customerId
      ? db.activity.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 15, include: { user: { select: { name: true } } } })
      : Promise.resolve([]),
    customerId
      ? db.quotation.findMany({
          where: { customerId },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { id: true, no: true, total: true, currency: true, status: true, approval: true, quoteDate: true },
        })
      : Promise.resolve([]),
  ]);
  const quotedIds = [...new Set(messages.map((m) => m.quotedId).filter((x): x is string => !!x))];
  const quotedRows = quotedIds.length
    ? await db.waMessage.findMany({ where: { id: { in: quotedIds } }, select: { id: true, fromMe: true, body: true, type: true } })
    : [];
  const quotedMap = new Map(quotedRows.map((r) => [r.id, r]));

  return {
    chat: {
      id: chat.id,
      name: chat.name,
      phone: chat.phone,
      unread: chat.unread,
      avatar: avatarSrc(chat.id, chat.avatarKey, chat.avatarAt),
      pinned: !!chat.pinnedAt,
      archived: chat.archived,
      customer: chat.customer ? { id: chat.customer.id, name: chat.customer.name } : null,
    },
    messages: messages.map((m) => {
      const qm = m.quotedId ? quotedMap.get(m.quotedId) : undefined;
      return {
        id: m.id,
        fromMe: m.fromMe,
        body: m.body,
        type: m.type,
        media: waMediaOf(m),
        status: m.status,
        error: m.error,
        timestamp: m.timestamp.toISOString(),
        starred: m.starred,
        translation: m.fromMe ? null : m.translation,
        quoted: qm ? { id: qm.id, fromMe: qm.fromMe, body: qm.body, type: qm.type } : null,
      };
    }),
    panel: {
      chat: {
        id: chat.id,
        name: chat.name,
        phone: chat.phone,
        avatar: avatarSrc(chat.id, chat.avatarKey, chat.avatarAt),
        customer: chat.customer
          ? {
              id: chat.customer.id,
              name: chat.customer.name,
              status: chat.customer.status?.name ?? null,
              country: chat.customer.country ? countryName(chat.customer.country) : null,
              owner: chat.customer.owner?.name ?? null,
            }
          : null,
        contact: chat.contact,
      },
      msgCount,
      firstAt: firstMsg?.timestamp.toISOString() ?? null,
      media,
      starred: starred.map((m) => ({
        id: m.id,
        body: m.body || (m.type !== "text" ? `[${m.type}]` : ""),
        fromMe: m.fromMe,
        timestamp: m.timestamp.toISOString(),
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt.toISOString(),
        done: t.done,
        customerId: t.customerId,
        customerName: t.customer?.name ?? null,
        kind: t.kind,
        note: t.note,
        link: t.link,
        snoozeCount: t.snoozeCount,
      })),
      activities: activities.map((a) => ({
        id: a.id,
        content: a.content,
        createdAt: a.createdAt.toISOString(),
        user: a.user?.name ?? null,
        follow: a.type === "FOLLOW_UP",
      })),
      quotations: quotations.map((x) => ({
        id: x.id,
        no: x.no,
        total: x.total.toString(),
        currency: x.currency,
        status: x.status,
        approval: x.approval,
        date: x.quoteDate.toISOString(),
      })),
    },
  };
}

export type ChatViewData = NonNullable<Awaited<ReturnType<typeof loadChatView>>>;
