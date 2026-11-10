import "server-only";
import { prisma } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { dayRange } from "@/lib/crm";
import type { Prisma } from "@/generated/prisma/client";

/**
 * 统一待办收件箱：把「该我动手的事」放进一个列表
 * - 提醒：已到期 + 今天到期、没完成的
 * - 邮件：最近 14 天收件箱里，AI 判为高优先、或客户发来的询盘 / 议价 / 下单 / 投诉 / 付款，我还没回复、也没标「已处理」的
 * - WhatsApp：对方发来、还没读的会话
 */

const MAIL_DAYS = 14;
const ACTION_INTENTS = ["inquiry", "quotation", "order", "complaint", "payment"];

function mailWhere(user: CurrentUser): Prisma.MailMessageWhereInput {
  return {
    tenantId: user.tenantId,
    account: { userId: user.id },
    folder: "INBOX",
    doneAt: null,
    date: { gte: new Date(Date.now() - MAIL_DAYS * 86_400_000) },
    AND: [
      { OR: [{ aiPriority: "high" }, { customerId: { not: null }, aiIntent: { in: ACTION_INTENTS } }] },
      // 推广邮件即使被标了高优先也不算
      { OR: [{ aiIntent: null }, { aiIntent: { notIn: ["marketing", "spam"] } }] },
    ],
  };
}

/** 已经回过的：本人发出的邮件里有 In-Reply-To / References 指向它 */
async function repliedIds(user: CurrentUser, messageIds: string[]) {
  if (!messageIds.length) return new Set<string>();
  const sent = await prisma.mailMessage.findMany({
    where: {
      tenantId: user.tenantId,
      account: { userId: user.id },
      folder: "SENT",
      OR: [{ inReplyTo: { in: messageIds } }, { references: { hasSome: messageIds } }],
    },
    select: { inReplyTo: true, references: true },
  });
  const set = new Set<string>();
  for (const s of sent) {
    if (s.inReplyTo) set.add(s.inReplyTo);
    for (const r of s.references) set.add(r);
  }
  return set;
}

async function pendingMail(user: CurrentUser, take: number) {
  const rows = await prisma.mailMessage.findMany({
    where: mailWhere(user),
    orderBy: { date: "desc" },
    take,
    select: {
      id: true,
      messageId: true,
      fromAddr: true,
      fromName: true,
      subject: true,
      snippet: true,
      aiSummary: true,
      aiPriority: true,
      aiIntent: true,
      seen: true,
      date: true,
      customer: { select: { id: true, name: true } },
    },
  });
  const replied = await repliedIds(
    user,
    rows.map((r) => r.messageId).filter((x): x is string => !!x),
  );
  return rows.filter((r) => !r.messageId || !replied.has(r.messageId));
}

const waWhere = (user: CurrentUser): Prisma.WaChatWhereInput => ({
  tenantId: user.tenantId,
  account: { userId: user.id },
  unread: { gt: 0 },
  lastFromMe: false,
  archived: false,
});

export async function getTodo(user: CurrentUser) {
  const { end } = dayRange(user.timezone);
  const [tasks, mail, wa] = await Promise.all([
    prisma.task.findMany({
      where: { tenantId: user.tenantId, ownerId: user.id, done: false, dueAt: { lt: end } },
      orderBy: { dueAt: "asc" },
      take: 100,
      include: { customer: { select: { name: true } } },
    }),
    can(user, "mail.use") ? pendingMail(user, 80) : [],
    can(user, "whatsapp.use")
      ? prisma.waChat.findMany({
          where: waWhere(user),
          orderBy: { lastMessageAt: "desc" },
          take: 50,
          select: {
            id: true,
            name: true,
            phone: true,
            lastText: true,
            lastMessageAt: true,
            unread: true,
            customer: { select: { id: true, name: true } },
          },
        })
      : [],
  ]);
  return { tasks, mail, wa, now: Date.now() };
}

/** 图标栏「待办」上的数字：今天及以前的提醒 + 待回邮件 + 待回 WhatsApp 会话 */
export async function countTodo(user: CurrentUser) {
  const { end } = dayRange(user.timezone);
  const [tasks, mail, wa] = await Promise.all([
    prisma.task.count({ where: { tenantId: user.tenantId, ownerId: user.id, done: false, dueAt: { lt: end } } }),
    can(user, "mail.use") ? pendingMail(user, 80).then((r) => r.length) : 0,
    can(user, "whatsapp.use") ? prisma.waChat.count({ where: waWhere(user) }) : 0,
  ]);
  return tasks + mail + wa;
}
