import "server-only";
import { prisma } from "@/server/db";
import { LEAD_OPEN_STATUSES, extractDomain } from "@/lib/crm";
import { touchCustomer } from "@/server/pool";
import type { MailAddress } from "@/server/mail/store";

export const AUTOMATED = /(^|[._-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|newsletter|bounce|alerts?)([._-]|@)/i;

export type ArchiveInput = {
  tenantId: string;
  accountId: string;
  /** 邮箱所属业务员 */
  userId: string;
  ownAddress: string;
  autoLead: boolean;
  direction: "in" | "out";
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  snippet: string;
  date: Date;
  /** 群发、退信、自动回复等不建线索 */
  automated?: boolean;
};

export type ArchiveResult = { customerId: string | null; contactId: string | null; leadId: string | null };

/** 本企业所有已绑定邮箱，往来是同事之间的邮件时不归档 */
async function internalAddresses(tenantId: string) {
  const rows = await prisma.mailAccount.findMany({ where: { tenantId }, select: { email: true } });
  const users = await prisma.user.findMany({ where: { tenantId }, select: { email: true } });
  return new Set([...rows, ...users].map((r) => r.email.toLowerCase()));
}

/**
 * 自动建档：
 * 1. 对方邮箱是某个联系人 → 归到该客户
 * 2. 对方邮箱域名和某个客户相同 → 归到该客户，并自动加为联系人
 * 3. 都匹配不到、是来信、邮箱开启了「陌生来信建线索」→ 新建线索（同一邮箱已有未处理线索时复用）
 * 匹配到客户时写一条动态：发出的邮件记为邮件跟进（会刷新最近跟进时间），收到的记为系统动态。
 */
export async function archiveMail(m: ArchiveInput): Promise<ArchiveResult> {
  const internal = await internalAddresses(m.tenantId);
  internal.add(m.ownAddress.toLowerCase());
  const others = (m.direction === "in" ? [m.from] : [...m.to, ...m.cc]).filter(
    (a) => a.address && !internal.has(a.address.toLowerCase()),
  );
  if (!others.length) return { customerId: null, contactId: null, leadId: null };

  let customerId: string | null = null;
  let contactId: string | null = null;

  for (const a of others) {
    const contact = await prisma.contact.findFirst({
      where: { tenantId: m.tenantId, email: { equals: a.address, mode: "insensitive" } },
      select: { id: true, customerId: true },
    });
    if (contact) {
      customerId = contact.customerId;
      contactId = contact.id;
      break;
    }
  }

  if (!customerId) {
    for (const a of others) {
      const domain = extractDomain(a.address);
      if (!domain) continue;
      const customer = await prisma.customer.findFirst({ where: { tenantId: m.tenantId, domain }, select: { id: true } });
      if (customer) {
        customerId = customer.id;
        const contact = await prisma.contact.create({
          data: {
            tenantId: m.tenantId,
            customerId,
            name: a.name?.trim() || a.address.split("@")[0],
            email: a.address,
            remark: "收发邮件时自动添加",
          },
        });
        contactId = contact.id;
        await prisma.activity.create({
          data: {
            tenantId: m.tenantId,
            customerId,
            type: "SYSTEM",
            event: "contact_auto",
            content: `根据邮件自动添加联系人 ${contact.name} <${a.address}>`,
          },
        });
        break;
      }
    }
  }

  if (customerId) {
    const subject = m.subject || "(无主题)";
    if (m.direction === "out") {
      await prisma.activity.create({
        data: {
          tenantId: m.tenantId,
          customerId,
          type: "FOLLOW_UP",
          method: "EMAIL",
          event: "mail_out",
          content: `【发送邮件】${subject}${m.snippet ? `\n${m.snippet}` : ""}`,
          userId: m.userId,
          createdAt: m.date,
        },
      });
      await touchCustomer(m.tenantId, customerId, m.date, ["lastMailSentAt"]);
    } else {
      await prisma.activity.create({
        data: {
          tenantId: m.tenantId,
          customerId,
          type: "SYSTEM",
          event: "mail_in",
          content: `收到 ${m.from.name || m.from.address} 的邮件：${subject}`,
          createdAt: m.date,
        },
      });
      await touchCustomer(m.tenantId, customerId, m.date, ["lastMailRecvAt"]);
    }
    return { customerId, contactId, leadId: null };
  }

  if (m.direction !== "in" || !m.autoLead || m.automated || AUTOMATED.test(m.from.address)) {
    return { customerId: null, contactId: null, leadId: null };
  }

  const existing = await prisma.lead.findFirst({
    where: {
      tenantId: m.tenantId,
      email: { equals: m.from.address, mode: "insensitive" },
      status: { in: [...LEAD_OPEN_STATUSES] },
    },
    select: { id: true },
  });
  if (existing) return { customerId: null, contactId: null, leadId: existing.id };

  const domain = extractDomain(m.from.address);
  const lead = await prisma.lead.create({
    data: {
      tenantId: m.tenantId,
      companyName: domain ? domain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase()) : null,
      contactName: m.from.name?.trim() || null,
      email: m.from.address,
      source: "邮件来信",
      inquiry: `${m.subject || "(无主题)"}\n${m.snippet}`.slice(0, 2000),
      ownerId: m.userId,
      assignedAt: new Date(),
    },
  });
  return { customerId: null, contactId: null, leadId: lead.id };
}
