import "server-only";
import { prisma, tenantDb } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { docScopeWhere } from "@/server/documents";
import { inScope, ownedWhere, scopeOwnerIds } from "@/server/scope";
import { getObject } from "@/server/storage";
import { MAIL_INTENTS, MAIL_PRIORITIES } from "@/server/ai";
import { quotationShareUrl } from "@/server/share";
import { countryName, dayRange, followMethodLabel, formatDateTime, LEAD_STATUSES } from "@/lib/crm";
import { formatAmount, orderStatus, quotationStatus } from "@/lib/docs";

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

// ── 邮件 ──

const myMailbox = (user: CurrentUser) => ({ account: { userId: user.id } });

/** 收件箱 / 已发送列表：可按关键词、未读、客户、天数筛 */
export async function listMail(
  user: CurrentUser,
  a: { folder?: string; query?: string; unread?: boolean; customerId?: string; days?: number; priority?: string },
) {
  if (!can(user, "mail.use")) return { error: "没有邮件权限" };
  const db = tenantDb(user.tenantId);
  const q = (a.query ?? "").trim().slice(0, 80);
  const has = { contains: q, mode: "insensitive" as const };
  const days = Math.min(365, Math.max(1, Number(a.days) || 30));
  const rows = await db.mailMessage.findMany({
    where: {
      ...myMailbox(user),
      folder: a.folder === "sent" ? "SENT" : a.folder === "all" ? undefined : "INBOX",
      date: { gte: new Date(Date.now() - days * 86_400_000) },
      ...(a.unread ? { seen: false } : {}),
      ...(a.customerId ? { customerId: a.customerId } : {}),
      ...(a.priority && a.priority in MAIL_PRIORITIES ? { aiPriority: a.priority } : {}),
      ...(q ? { OR: [{ subject: has }, { fromAddr: has }, { fromName: has }, { snippet: has }, { text: has }] } : {}),
    },
    orderBy: { date: "desc" },
    take: 15,
    select: {
      id: true,
      folder: true,
      fromAddr: true,
      fromName: true,
      toList: true,
      subject: true,
      snippet: true,
      date: true,
      seen: true,
      aiSummary: true,
      aiIntent: true,
      aiPriority: true,
      doneAt: true,
      customer: { select: { id: true, name: true } },
    },
  });
  const accounts = await prisma.mailAccount.count({ where: { userId: user.id } });
  return {
    mailboxBound: accounts > 0,
    mails: rows.map((m) => ({
      mailId: m.id,
      href: `/mail?id=${m.id}`,
      at: formatDateTime(m.date, user.timezone),
      sent: m.folder === "SENT",
      from: m.fromName ? `${m.fromName} <${m.fromAddr}>` : m.fromAddr,
      to:
        m.folder === "SENT"
          ? (m.toList as { address?: string }[])
              .map((x) => x.address)
              .filter(Boolean)
              .slice(0, 3)
              .join(", ")
          : undefined,
      subject: clip(m.subject, 120),
      summary: m.aiSummary ? clip(m.aiSummary, 160) : clip(m.snippet, 160),
      intent: m.aiIntent ? (MAIL_INTENTS[m.aiIntent] ?? m.aiIntent) : null,
      priority: m.aiPriority ? MAIL_PRIORITIES[m.aiPriority] : null,
      unread: !m.seen,
      handled: !!m.doneAt,
      customer: m.customer?.name ?? null,
      customerId: m.customer?.id ?? null,
    })),
  };
}

/** 读一封邮件的全文（以及同一个往来里的前几封） */
export async function readMail(user: CurrentUser, mailId: string) {
  if (!can(user, "mail.use")) return { error: "没有邮件权限" };
  const db = tenantDb(user.tenantId);
  const m = await db.mailMessage.findFirst({
    where: { id: mailId, ...myMailbox(user) },
    select: {
      id: true,
      accountId: true,
      folder: true,
      fromAddr: true,
      fromName: true,
      toList: true,
      ccList: true,
      subject: true,
      text: true,
      snippet: true,
      date: true,
      attachments: true,
      aiSummary: true,
      messageId: true,
      inReplyTo: true,
      customer: { select: { id: true, name: true } },
      lead: { select: { id: true, companyName: true } },
    },
  });
  if (!m) return { error: "邮件不存在，或不是你邮箱里的" };
  const before = m.inReplyTo
    ? await db.mailMessage.findMany({
        where: {
          accountId: m.accountId,
          OR: [{ messageId: m.inReplyTo }, { references: { has: m.inReplyTo } }],
          id: { not: m.id },
          date: { lt: m.date },
        },
        orderBy: { date: "desc" },
        take: 3,
        select: { fromAddr: true, date: true, subject: true, text: true, snippet: true },
      })
    : [];
  const addr = (l: unknown) =>
    (l as { name?: string; address?: string }[])
      .map((x) => (x.name ? `${x.name} <${x.address}>` : x.address))
      .filter(Boolean)
      .join(", ");
  return {
    mailId: m.id,
    href: `/mail?id=${m.id}`,
    sent: m.folder === "SENT",
    at: formatDateTime(m.date, user.timezone),
    from: m.fromName ? `${m.fromName} <${m.fromAddr}>` : m.fromAddr,
    fromEmail: m.fromAddr,
    to: addr(m.toList),
    cc: addr(m.ccList) || undefined,
    subject: m.subject,
    aiSummary: m.aiSummary,
    text: (m.text ?? m.snippet)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 6000),
    attachments: (m.attachments as { filename?: string; contentType?: string; size?: number }[]).map((x) => x.filename).filter(Boolean),
    customer: m.customer ? { customerId: m.customer.id, name: m.customer.name } : null,
    lead: m.lead ? { leadId: m.lead.id, company: m.lead.companyName } : null,
    earlierInThread: before.map((b) => ({ from: b.fromAddr, at: formatDateTime(b.date, user.timezone), text: clip(b.text ?? b.snippet, 600) })),
  };
}

// ── WhatsApp ──

async function myWa(user: CurrentUser) {
  if (!can(user, "whatsapp.use")) return null;
  return prisma.waAccount.findUnique({ where: { userId: user.id }, select: { id: true, status: true } });
}

export async function listWaChats(user: CurrentUser, a: { query?: string; unread?: boolean }) {
  const wa = await myWa(user);
  if (!wa) return { error: can(user, "whatsapp.use") ? "还没有连接 WhatsApp" : "没有 WhatsApp 权限" };
  const q = (a.query ?? "").trim().slice(0, 60);
  const has = { contains: q, mode: "insensitive" as const };
  const rows = await tenantDb(user.tenantId).waChat.findMany({
    where: {
      accountId: wa.id,
      archived: false,
      ...(a.unread ? { unread: { gt: 0 } } : {}),
      ...(q ? { OR: [{ name: has }, { phone: { contains: q.replace(/\D/g, "") || q } }, { customer: { name: has } }, { lastText: has }] } : {}),
    },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 15,
    select: {
      id: true,
      name: true,
      phone: true,
      lastMessageAt: true,
      lastText: true,
      lastFromMe: true,
      unread: true,
      customer: { select: { id: true, name: true } },
    },
  });
  return {
    connected: wa.status === "CONNECTED",
    chats: rows.map((c) => ({
      chatId: c.id,
      href: `/whatsapp?chat=${c.id}`,
      name: c.name || (c.phone ? `+${c.phone}` : "WhatsApp"),
      phone: c.phone ? `+${c.phone}` : null,
      at: c.lastMessageAt ? formatDateTime(c.lastMessageAt, user.timezone) : null,
      last: `${c.lastFromMe ? "我：" : ""}${clip(c.lastText, 120)}`,
      unread: c.unread,
      customer: c.customer?.name ?? null,
      customerId: c.customer?.id ?? null,
    })),
  };
}

/** 一个会话最近的聊天记录（外文消息带中文翻译；图片给出 messageId，可以用 view_image 看） */
export async function readWaChat(user: CurrentUser, chatId: string, limit = 30) {
  const wa = await myWa(user);
  if (!wa) return { error: "没有连接 WhatsApp 或没有权限" };
  const db = tenantDb(user.tenantId);
  const chat = await db.waChat.findFirst({
    where: { id: chatId, accountId: wa.id },
    select: { id: true, name: true, phone: true, customer: { select: { id: true, name: true } } },
  });
  if (!chat) return { error: "会话不存在" };
  const n = Math.min(60, Math.max(5, Number(limit) || 30));
  const msgs = (await db.waMessage.findMany({ where: { chatId: chat.id, hiddenAt: null }, orderBy: { timestamp: "desc" }, take: n })).reverse();
  return {
    chatId: chat.id,
    href: `/whatsapp?chat=${chat.id}`,
    name: chat.name || (chat.phone ? `+${chat.phone}` : "WhatsApp"),
    customer: chat.customer ? { customerId: chat.customer.id, name: chat.customer.name } : null,
    messages: msgs.map((m) => ({
      at: formatDateTime(m.timestamp, user.timezone),
      fromMe: m.fromMe,
      type: m.type,
      text: clip(m.body, 600) || undefined,
      translation: m.translation ? clip(m.translation, 600) : undefined,
      ...(m.type === "image" && m.mediaKey ? { imageMessageId: m.id } : {}),
      ...(m.mediaName ? { file: m.mediaName } : {}),
      failed: m.status === "FAILED" || undefined,
    })),
  };
}

/** WhatsApp 里的一张图片，转成 data URL 给模型看 */
export async function waImage(user: CurrentUser, messageId: string): Promise<{ url: string; note: string } | { error: string }> {
  const wa = await myWa(user);
  if (!wa) return { error: "没有连接 WhatsApp 或没有权限" };
  const m = await tenantDb(user.tenantId).waMessage.findFirst({
    where: { id: messageId, accountId: wa.id },
    select: { type: true, mediaKey: true, mediaMime: true, mediaSize: true, body: true, chat: { select: { name: true, phone: true } } },
  });
  if (!m?.mediaKey || m.type !== "image") return { error: "这条消息不是图片，或图片没有下载到" };
  if ((m.mediaSize ?? 0) > 4_000_000) return { error: "图片太大，看不了" };
  const mime = /^image\/(jpeg|png|webp|gif)$/.test(m.mediaMime ?? "") ? m.mediaMime! : "image/jpeg";
  const buf = await getObject(m.mediaKey);
  return {
    url: `data:${mime};base64,${buf.toString("base64")}`,
    note: `WhatsApp「${m.chat.name || m.chat.phone || ""}」里的图片${m.body ? `，配文：${clip(m.body, 200)}` : ""}`,
  };
}

// ── 客户、线索、商机、订单 ──

export async function listCustomers(user: CurrentUser, a: { query?: string; country?: string; idleDays?: number; minStar?: number; sort?: string }) {
  if (!can(user, "customer.view")) return { error: "没有查看客户的权限" };
  const db = tenantDb(user.tenantId);
  const q = (a.query ?? "").trim().slice(0, 60);
  const has = { contains: q, mode: "insensitive" as const };
  const idle = Number(a.idleDays) || 0;
  const rows = await db.customer.findMany({
    where: {
      AND: [
        await ownedWhere(user),
        q ? { OR: [{ name: has }, { domain: has }, { mainProducts: has }, { tags: { has: q } }] } : {},
        a.country ? { country: a.country.toUpperCase().slice(0, 2) } : {},
        idle > 0 ? { OR: [{ lastContactAt: null }, { lastContactAt: { lt: new Date(Date.now() - idle * 86_400_000) } }] } : {},
        Number(a.minStar) > 0 ? { star: { gte: Number(a.minStar) } } : {},
      ],
    },
    orderBy:
      a.sort === "stale"
        ? { lastContactAt: { sort: "asc", nulls: "first" } }
        : a.sort === "star"
          ? [{ star: "desc" }, { lastContactAt: { sort: "desc", nulls: "last" } }]
          : a.sort === "new"
            ? { createdAt: "desc" }
            : { lastContactAt: { sort: "desc", nulls: "last" } },
    take: 15,
    select: {
      id: true,
      name: true,
      country: true,
      star: true,
      lastContactAt: true,
      nextFollowAt: true,
      mainProducts: true,
      status: { select: { name: true } },
      owner: { select: { name: true } },
    },
  });
  return {
    customers: rows.map((c) => ({
      customerId: c.id,
      href: `/customers/${c.id}`,
      name: c.name,
      country: c.country ? countryName(c.country) : null,
      star: c.star,
      status: c.status?.name ?? null,
      owner: c.owner?.name ?? null,
      lastContact: c.lastContactAt ? formatDateTime(c.lastContactAt, user.timezone) : "从未联系",
      nextFollow: c.nextFollowAt ? formatDateTime(c.nextFollowAt, user.timezone) : null,
      products: c.mainProducts ? clip(c.mainProducts, 60) : null,
    })),
  };
}

export async function listLeads(user: CurrentUser, a: { status?: string; query?: string }) {
  if (!can(user, "lead.view")) return { error: "没有查看线索的权限" };
  const ids = await scopeOwnerIds(user);
  const q = (a.query ?? "").trim().slice(0, 60);
  const has = { contains: q, mode: "insensitive" as const };
  const status = LEAD_STATUSES.some((s) => s.value === a.status) ? a.status : undefined;
  const rows = await tenantDb(user.tenantId).lead.findMany({
    where: {
      AND: [
        ids ? { OR: [{ ownerId: { in: ids } }, { ownerId: null }] } : {},
        status ? { status: status as never } : { status: { in: ["NEW", "QUALIFYING", "CONTACTED"] } },
        q ? { OR: [{ companyName: has }, { contactName: has }, { email: has }, { products: has }, { inquiry: has }] } : {},
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true,
      companyName: true,
      contactName: true,
      email: true,
      country: true,
      source: true,
      products: true,
      inquiry: true,
      status: true,
      createdAt: true,
      owner: { select: { name: true } },
    },
  });
  return {
    leads: rows.map((l) => ({
      leadId: l.id,
      href: `/leads?tab=all&q=${encodeURIComponent(l.companyName || l.email || l.contactName || "")}`,
      company: l.companyName,
      contact: l.contactName,
      email: l.email,
      country: l.country ? countryName(l.country) : null,
      source: l.source,
      products: l.products ? clip(l.products, 80) : null,
      inquiry: l.inquiry ? clip(l.inquiry, 200) : null,
      status: LEAD_STATUSES.find((s) => s.value === l.status)?.label ?? l.status,
      owner: l.owner?.name ?? "未分配",
      at: formatDateTime(l.createdAt, user.timezone),
    })),
  };
}

export async function listOpportunities(user: CurrentUser, a: { stage?: string; customerId?: string }) {
  if (!can(user, "opportunity.view")) return { error: "没有查看商机的权限" };
  const ids = await scopeOwnerIds(user);
  const rows = await tenantDb(user.tenantId).opportunity.findMany({
    where: {
      AND: [
        ids ? { ownerId: { in: ids } } : {},
        a.customerId ? { customerId: a.customerId } : {},
        a.stage === "won"
          ? { stage: { kind: "WON" } }
          : a.stage === "lost"
            ? { stage: { kind: "LOST" } }
            : a.stage === "all"
              ? {}
              : { stage: { kind: "OPEN" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 15,
    select: {
      id: true,
      name: true,
      amount: true,
      currency: true,
      expectedCloseAt: true,
      stageChangedAt: true,
      stage: { select: { name: true, probability: true } },
      customer: { select: { id: true, name: true } },
      owner: { select: { name: true } },
    },
  });
  return {
    opportunities: rows.map((o) => ({
      opportunityId: o.id,
      href: `/customers/${o.customer.id}`,
      name: o.name,
      customer: o.customer.name,
      customerId: o.customer.id,
      amount: formatAmount(o.amount.toString(), o.currency),
      stage: `${o.stage.name}（${o.stage.probability}%）`,
      expectedClose: o.expectedCloseAt ? formatDateTime(o.expectedCloseAt, user.timezone).slice(0, 10) : null,
      stuckDays: Math.floor((Date.now() - o.stageChangedAt.getTime()) / 86_400_000),
      owner: o.owner?.name ?? null,
    })),
  };
}

export async function listOrders(user: CurrentUser, a: { status?: string; customerId?: string; unpaid?: boolean }) {
  if (!can(user, "order.view")) return { error: "没有查看订单的权限" };
  const rows = await tenantDb(user.tenantId).order.findMany({
    where: {
      AND: [
        await docScopeWhere(user),
        a.customerId ? { customerId: a.customerId } : {},
        a.status ? { status: a.status.toUpperCase() as never } : { status: { notIn: ["CANCELLED"] } },
      ],
    },
    orderBy: { orderDate: "desc" },
    take: 30,
    select: {
      id: true,
      no: true,
      status: true,
      currency: true,
      total: true,
      paidAmount: true,
      orderDate: true,
      deliveryDate: true,
      customer: { select: { id: true, name: true } },
    },
  });
  const list = rows
    .map((o) => ({ o, due: Number(o.total) - Number(o.paidAmount) }))
    .filter(({ due }) => !a.unpaid || due > 0.009)
    .slice(0, 15);
  return {
    orders: list.map(({ o, due }) => ({
      orderId: o.id,
      href: `/orders/${o.id}`,
      no: o.no,
      customer: o.customer.name,
      customerId: o.customer.id,
      status: orderStatus(o.status).label,
      total: formatAmount(o.total.toString(), o.currency),
      unpaid: due > 0.009 ? formatAmount(due, o.currency) : null,
      date: formatDateTime(o.orderDate, user.timezone).slice(0, 10),
      delivery: o.deliveryDate ? formatDateTime(o.deliveryDate, user.timezone).slice(0, 10) : null,
    })),
  };
}
