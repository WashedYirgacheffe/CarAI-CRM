"use server";

import { prisma, tenantDb } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { AiError, aiComplete, aiConfigured, clip } from "@/server/ai";
import { countryName, followMethodLabel, formatDate } from "@/lib/crm";

export type InsightResult = { ok: true; content: string; createdAt: string } | { ok: false; message: string };

const KINDS = { summary: "customer_summary", brief: "customer_brief", next: "customer_next" } as const;

/** 客户近况 / 背景速览 / 跟进建议。结果缓存，refresh=true 时重新生成（客户页打开后才按需调用） */
export async function customerInsightAction(customerId: string, kind: keyof typeof KINDS, refresh = false): Promise<InsightResult> {
  const user = await requireUser();
  if (!can(user, "ai.use")) return { ok: false, message: "没有使用 AI 的权限" };
  if (!aiConfigured()) return { ok: false, message: "管理员还没有配置 AI 服务" };
  const found = await getCustomerForUser(user, customerId);
  if (!found) return { ok: false, message: "客户不存在" };
  const db = tenantDb(user.tenantId);
  const key = KINDS[kind];

  if (!refresh) {
    const cached = await db.aiInsight.findFirst({ where: { kind: key, targetId: customerId } });
    if (cached) return { ok: true, content: cached.content, createdAt: cached.createdAt.toISOString() };
  }

  const c = found.customer;
  const tz = user.timezone;
  const [contacts, activities, mails, chats, opps, quotes, orders] = await Promise.all([
    db.contact.findMany({ where: { customerId }, take: 10 }),
    db.activity.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } }),
    db.mailMessage.findMany({
      where: { customerId },
      orderBy: { date: "desc" },
      take: kind === "brief" ? 5 : 8,
      select: { folder: true, subject: true, text: true, snippet: true, date: true, fromAddr: true },
    }),
    db.waChat.findMany({ where: { customerId }, select: { id: true } }),
    db.opportunity.findMany({ where: { customerId }, include: { stage: true }, take: 10 }),
    db.quotation.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 5, include: { items: { take: 5 } } }),
    db.order.findMany({ where: { customerId }, orderBy: { orderDate: "desc" }, take: 5 }),
  ]);
  const wa = chats.length
    ? (await db.waMessage.findMany({ where: { chatId: { in: chats.map((x) => x.id) } }, orderBy: { timestamp: "desc" }, take: 20 })).reverse()
    : [];

  const profile = [
    `客户：${c.name}`,
    c.country && `国家：${countryName(c.country)}`,
    (c.website || c.domain) && `网站 / 域名：${c.website ?? c.domain}`,
    c.customerType && `类型：${c.customerType}`,
    c.source && `来源：${c.source}`,
    c.mainProducts && `主营产品：${c.mainProducts}`,
    c.annualVolume && `年采购额：${c.annualVolume}`,
    c.status?.name && `客户状态：${c.status.name}`,
    `星级：${c.star}`,
    c.tags.length && `标签：${c.tags.join("、")}`,
    c.remark && `备注：${clip(c.remark, 500)}`,
    `创建于 ${formatDate(c.createdAt, tz)}；最近联系 ${c.lastContactAt ? formatDate(c.lastContactAt, tz) : "从未"}；下次跟进 ${c.nextFollowAt ? formatDate(c.nextFollowAt, tz) : "未安排"}`,
  ]
    .filter(Boolean)
    .join("\n");
  const contactText = contacts.map((x) => `- ${x.name}${x.title ? `（${x.title}）` : ""}${x.email ? ` ${x.email}` : ""}`).join("\n");
  const actText = activities
    .map(
      (a) =>
        `- ${formatDate(a.createdAt, tz)} ${a.type === "FOLLOW_UP" ? `${a.user?.name ?? ""} ${followMethodLabel(a.method)}跟进` : "系统"}：${clip(a.content, 300)}`,
    )
    .join("\n");
  const mailText = mails
    .map(
      (m) =>
        `- ${formatDate(m.date, tz)} ${m.folder === "SENT" ? "我方发出" : `客户来信（${m.fromAddr}）`}《${m.subject}》：${clip(m.text ?? m.snippet, kind === "next" ? 800 : 300)}`,
    )
    .join("\n");
  const waText = wa.map((m) => `- ${formatDate(m.timestamp, tz)} ${m.fromMe ? "我方" : "客户"}：${clip(m.body, 200)}`).join("\n");
  const oppText = opps.map((o) => `- ${o.name}：${o.amount} ${o.currency}，阶段「${o.stage.name}」`).join("\n");
  const quoteText = quotes
    .map((q) => `- ${q.no} ${formatDate(q.quoteDate, tz)} ${q.total} ${q.currency} 状态 ${q.status}；产品：${q.items.map((i) => i.name).join("、")}`)
    .join("\n");
  const orderText = orders
    .map((o) => `- ${o.no} ${formatDate(o.orderDate, tz)} ${o.total} ${o.currency} 状态 ${o.status}，已收 ${o.paidAmount}`)
    .join("\n");

  const context = [
    `【客户资料】\n${profile}`,
    contactText && `【联系人】\n${contactText}`,
    oppText && `【商机】\n${oppText}`,
    quoteText && `【报价单】\n${quoteText}`,
    orderText && `【订单】\n${orderText}`,
    actText && `【跟进动态（新→旧）】\n${actText}`,
    mailText && `【往来邮件（新→旧）】\n${mailText}`,
    waText && `【WhatsApp 最近消息】\n${waText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const task =
    kind === "summary"
      ? `根据下面的 CRM 资料，用简体中文给业务员写这个客户的「近况摘要」，让他三秒钟知道现在什么情况。纯文本，不要 Markdown，三行，每行以「· 」开头，每行不超过 40 字：
· 最近在聊什么（最近一次往来是什么时候、谁发的、说了什么）
· 卡在哪里 / 在等谁（我方欠客户什么，或客户欠我们什么）
· 下一步该做什么
只依据资料，没有往来记录就直说「还没有往来」，不要编造。`
      : kind === "brief"
        ? `根据下面的 CRM 资料，给业务员写一份「客户背景速览」，帮助他快速了解这个客户。用简体中文纯文本，不要用 Markdown 标题或加粗，分四段，每段以「· 」开头：
· 客户画像：是什么类型的公司、在哪个市场、规模和采购能力的判断（依据网站域名和资料推断；拿不准的明确说「推测」，不要编造具体数字）
· 采购需求：关注哪些产品、品类、价格或认证要求
· 合作进展：目前走到哪一步（询盘 / 报价 / 样品 / 下单 / 复购），关键往来
· 注意事项：沟通风格、风险点或机会点
总长度不超过 350 字。`
        : `根据下面的 CRM 资料，作为外贸销售主管，给负责这个客户的业务员提出跟进建议。用简体中文纯文本，不要用 Markdown 标题或加粗，格式如下：
现状：一两句话判断当前所处阶段和客户温度（热 / 温 / 冷），以及最需要关注的问题。
建议：
1. …（具体动作，比如发什么、问什么、什么时间之前完成）
2. …
3. …
推荐话术：给出一段可以直接发给客户的英文消息（邮件或 WhatsApp 均可，100 词以内），需要业务员确认的信息用 [方括号] 标出。
不要编造价格、交期等资料里没有的数字。`;

  try {
    const content = await aiComplete({
      system: "你是经验丰富的外贸 B2B 销售顾问，熟悉询盘、报价、打样、下单、收款和复购的全过程。回答务实、具体、简洁。",
      messages: [{ role: "user", content: `${task}\n\n${clip(context, 14000)}` }],
      maxTokens: 3000,
    });
    const row = await prisma.aiInsight.upsert({
      where: { tenantId_kind_targetId: { tenantId: user.tenantId, kind: key, targetId: customerId } },
      create: { tenantId: user.tenantId, kind: key, targetId: customerId, content },
      update: { content, createdAt: new Date() },
    });
    return { ok: true, content, createdAt: row.createdAt.toISOString() };
  } catch (e) {
    return { ok: false, message: e instanceof AiError ? e.message : "AI 生成失败，请稍后重试" };
  }
}
