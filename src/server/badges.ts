import "server-only";
import { prisma } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { LEAD_OPEN_STATUSES } from "@/lib/crm";
import type { BadgeKey } from "@/lib/nav";

/**
 * 侧边栏 / 工作台的提醒数：
 * - 线索：分配给我、还没处理的新线索；有分配权限的再加上待分配的
 * - 邮件：我绑定的邮箱里收件箱未读
 * - WhatsApp：我的账号下未读消息数
 */
export async function getBadges(user: CurrentUser): Promise<Record<BadgeKey, number>> {
  const t = user.tenantId;
  const [myLeads, poolLeads, mail, wa] = await Promise.all([
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
  ]);
  return { leads: myLeads + poolLeads, mail, whatsapp: wa };
}
