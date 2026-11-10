import "server-only";
import { prisma, tenantDb } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { docScopeWhere } from "@/server/documents";
import { inScope } from "@/server/scope";
import { quotationShareUrl } from "@/server/share";
import { dayRange, followMethodLabel, formatDateTime } from "@/lib/crm";
import { formatAmount, quotationStatus } from "@/lib/docs";

/** AI 只读查询：给起草邮件 / 消息 / 报价单提供素材 */

const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** 客户近况：跟进、报价单、邮件、WhatsApp 最近的消息 */
export async function customerContext(user: CurrentUser, customerId: string) {
  const found = await getCustomerForUser(user, customerId);
  if (!found) return { error: "客户不存在或没有权限" };
  const c = found.customer;
  const db = tenantDb(user.tenantId);
  const tz = user.timezone;
  const wa = can(user, "whatsapp.use") ? await prisma.waAccount.findUnique({ where: { userId: user.id }, select: { id: true } }) : null;
  const [acts, quotes, mails, chats, contacts] = await Promise.all([
    db.activity.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 8, include: { user: { select: { name: true } } } }),
    can(user, "quotation.view") ? db.quotation.findMany({ where: { customerId }, orderBy: { quoteDate: "desc" }, take: 5 }) : [],
    can(user, "mail.use")
      ? db.mailMessage.findMany({
          where: { customerId, account: { userId: user.id } },
          orderBy: { date: "desc" },
          take: 5,
          select: { folder: true, subject: true, snippet: true, date: true, fromAddr: true },
        })
      : [],
    wa ? db.waChat.findMany({ where: { accountId: wa.id, customerId }, orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } }, take: 3 }) : [],
    db.contact.findMany({ where: { customerId }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 5 }),
  ]);
  const msgs = chats[0] ? (await db.waMessage.findMany({ where: { chatId: chats[0].id }, orderBy: { timestamp: "desc" }, take: 12 })).reverse() : [];
  return {
    customer: { customerId: c.id, name: c.name, country: c.country, status: c.status?.name ?? null, canEdit: found.access.edit },
    contacts: contacts.map((x) => ({ name: x.name, title: x.title, email: x.email, whatsapp: x.whatsapp, primary: x.isPrimary })),
    activities: acts.map((a) => ({
      at: formatDateTime(a.createdAt, tz),
      by: a.user?.name,
      method: followMethodLabel(a.method),
      text: clip(a.content, 200),
    })),
    quotations: quotes.map((q) => ({
      quotationId: q.id,
      no: q.no,
      date: formatDateTime(q.quoteDate, tz).slice(0, 10),
      total: formatAmount(q.total.toString(), q.currency),
      status: quotationStatus(q.status).label,
      shareUrl: quotationShareUrl(q.id),
    })),
    mails: mails.map((m) => ({ at: formatDateTime(m.date, tz), sent: m.folder === "SENT", subject: m.subject, snippet: clip(m.snippet, 160) })),
    whatsappChats: chats.map((ch) => ({ chatId: ch.id, name: ch.name || (ch.phone ? `+${ch.phone}` : "WhatsApp") })),
    latestWhatsapp: msgs.map((m) => ({ at: formatDateTime(m.timestamp, tz), fromMe: m.fromMe, text: clip(m.body, 300) || `[${m.type}]` })),
  };
}

export async function searchProducts(user: CurrentUser, raw: string) {
  const q = raw.trim().slice(0, 60);
  const has = { contains: q, mode: "insensitive" as const };
  const rows = await tenantDb(user.tenantId).product.findMany({
    where: { status: "ACTIVE", ...(q ? { OR: [{ name: has }, { nameEn: has }, { sku: has }, { model: has }, { spec: has }] } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  return {
    products: rows.map((p) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      nameEn: p.nameEn,
      model: p.model,
      price: `${Number(p.price)} ${p.currency}`,
      unit: p.unit,
      moq: p.moq,
    })),
  };
}

export async function listQuotations(user: CurrentUser, customerId?: string) {
  if (!can(user, "quotation.view")) return { error: "没有查看报价单的权限" };
  const rows = await tenantDb(user.tenantId).quotation.findMany({
    where: { AND: [await docScopeWhere(user), customerId ? { customerId } : {}] },
    orderBy: { quoteDate: "desc" },
    take: 8,
    include: { customer: { select: { name: true } } },
  });
  return {
    quotations: rows.map((q) => ({
      quotationId: q.id,
      no: q.no,
      customer: q.customer.name,
      customerId: q.customerId,
      date: formatDateTime(q.quoteDate, user.timezone).slice(0, 10),
      total: formatAmount(q.total.toString(), q.currency),
      status: quotationStatus(q.status).label,
      shareUrl: quotationShareUrl(q.id),
    })),
  };
}

export async function listTasks(user: CurrentUser, when: string) {
  const { start, end } = dayRange(user.timezone);
  const week = new Date(end.getTime() + 6 * 86_400_000);
  const dueAt = when === "overdue" ? { lt: start } : when === "today" ? { gte: start, lt: end } : when === "week" ? { lt: week } : undefined;
  const rows = await tenantDb(user.tenantId).task.findMany({
    where: { ownerId: user.id, done: false, ...(dueAt ? { dueAt } : {}) },
    orderBy: { dueAt: "asc" },
    take: 20,
    include: { customer: { select: { name: true } } },
  });
  return {
    tasks: rows.map((t) => ({
      title: t.title,
      due: formatDateTime(t.dueAt, user.timezone),
      customer: t.customer?.name ?? null,
      overdue: t.dueAt < new Date(),
    })),
  };
}

export async function listSequences(user: CurrentUser) {
  if (!can(user, "mail.use")) return { error: "没有邮件营销权限" };
  const rows = await tenantDb(user.tenantId).mailSequence.findMany({
    orderBy: { updatedAt: "desc" },
    take: 20,
    include: { _count: { select: { steps: true, enrollments: true } } },
  });
  const out = [];
  for (const s of rows) {
    if (!(await inScope(user, s.ownerId))) continue;
    out.push({ sequenceId: s.id, name: s.name, active: s.status === "ACTIVE", emails: s._count.steps, recipients: s._count.enrollments });
  }
  return { sequences: out };
}

/** 用户当前所在页面：让「这个客户」「这封邮件」能对上号 */
export async function pageContext(user: CurrentUser, page: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(page, "http://x");
  } catch {
    return "";
  }
  const path = url.pathname;
  const db = tenantDb(user.tenantId);
  const lines = [`页面：${path}`];
  const customer = path.match(/^\/customers\/([^/]+)$/)?.[1];
  if (customer) {
    const found = await getCustomerForUser(user, customer);
    if (found) lines.push(`正在看客户「${found.customer.name}」（customerId=${found.customer.id}）。用户说「这个客户 / 他 / 这家」就是指它。`);
  }
  const mailId = path === "/mail" ? url.searchParams.get("id") : null;
  if (mailId && can(user, "mail.use")) {
    const m = await db.mailMessage.findFirst({
      where: { id: mailId, account: { userId: user.id } },
      select: { folder: true, fromAddr: true, fromName: true, subject: true, snippet: true, text: true, aiSummary: true, customerId: true },
    });
    if (m)
      lines.push(
        `正在看一封${m.folder === "SENT" ? "自己发出的" : "收到的"}邮件：发件人 ${m.fromName ?? ""} <${m.fromAddr}>，主题「${clip(m.subject, 150)}」${
          m.customerId ? `，已归档到客户 customerId=${m.customerId}` : "，还没归档到客户"
        }。${m.aiSummary ? `AI 摘要：${clip(m.aiSummary, 200)}。` : ""}正文开头：${clip(m.text ?? m.snippet, 1200)}
用户说「这封邮件 / 回复他」就是指它；起草回复用 propose_action send_email，to 用发件人邮箱，主题用 "Re: 原主题"，正文用对方来信的语言。`,
      );
  }
  const quote = path.match(/^\/quotations\/([^/]+)$/)?.[1];
  if (quote && can(user, "quotation.view")) {
    const q = await db.quotation.findFirst({
      where: { AND: [await docScopeWhere(user), { id: quote }] },
      include: { customer: { select: { name: true } } },
    });
    if (q)
      lines.push(
        `正在看报价单 ${q.no}（quotationId=${q.id}），客户「${q.customer.name}」（customerId=${q.customerId}），金额 ${formatAmount(q.total.toString(), q.currency)}，状态 ${quotationStatus(q.status).label}。`,
      );
  }
  return lines.join("\n");
}
