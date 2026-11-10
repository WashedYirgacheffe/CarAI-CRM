import "server-only";
import { prisma } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { LEAD_OPEN_STATUSES } from "@/lib/crm";
import type { BadgeKey } from "@/lib/nav";

/**
 * 图标栏 / 顶栏提醒 / 工作台的提醒数：
 * - 线索：分配给我、还没处理的新线索；有分配权限的再加上待分配的
 * - 邮件：我绑定的邮箱里收件箱未读
 * - WhatsApp：我的账号下未读消息数
 * - 日程：我已到点还没完成的提醒
 */
export async function getBadges(user: CurrentUser): Promise<Record<BadgeKey, number>> {
  const t = user.tenantId;
  const [myLeads, poolLeads, mail, wa, tasks] = await Promise.all([
    can(user, "lead.view") ? prisma.lead.count({ where: { tenantId: t, ownerId: user.id, status: "NEW" } }) : 0,
    can(user, "lead.view") && can(user, "lead.assign")
      ? prisma.lead.count({ where: { tenantId: t, ownerId: null, status: { in: [...LEAD_OPEN_STATUSES] } } })
      : 0,
    can(user, "mail.use")
      ? prisma.mailMessage.count({ where: { tenantId: t, account: { userId: user.id }, folder: "INBOX", seen: false } })
      : 0,
    can(user, "whatsapp.use")
      ? prisma.waChat.aggregate({ where: { tenantId: t, account: { userId: user.id } }, _sum: { unread: true } }).then((r) => r._sum.unread ?? 0)
      : 0,
    prisma.task.count({ where: { tenantId: t, ownerId: user.id, done: false, dueAt: { lte: new Date() } } }),
  ]);
  return { leads: myLeads + poolLeads, mail, whatsapp: wa, tasks };
}

export type DueReminder = {
  id: string;
  title: string;
  kind: string | null;
  note: string | null;
  dueAt: string;
  link: string | null;
  customerId: string | null;
  customerName: string | null;
};

/** 顶栏铃铛里列出的到点提醒（最近 6 条） */
export async function getDueReminders(user: CurrentUser): Promise<DueReminder[]> {
  const rows = await prisma.task.findMany({
    where: { tenantId: user.tenantId, ownerId: user.id, done: false, dueAt: { lte: new Date() } },
    orderBy: { dueAt: "desc" },
    take: 6,
    include: { customer: { select: { name: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    kind: t.kind,
    note: t.note,
    dueAt: t.dueAt.toISOString(),
    link: t.link,
    customerId: t.customerId,
    customerName: t.customer?.name ?? null,
  }));
}
