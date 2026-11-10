import "server-only";
import { prisma, tenantDb } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { getRates } from "@/server/documents";
import { inScope } from "@/server/scope";
import { CURRENCIES, FOLLOW_METHODS, formatDateTime, parseLocalInput } from "@/lib/crm";
import { TRADE_TERMS, computeTotals, convertPrice, dateInput, formatAmount, round4 } from "@/lib/docs";
import { REMINDER_KINDS, TIME_PRESETS, presetLocal, type TimePreset } from "@/lib/reminders";
import type { ActionCard, AiActionKind } from "@/lib/ai-actions";

type P = Record<string, unknown>;
const str = (v: unknown, max = 5000) => (v == null ? "" : String(v).trim().slice(0, max));

async function ownChat(user: CurrentUser, id: string) {
  if (!can(user, "whatsapp.use") || !id) return null;
  return tenantDb(user.tenantId).waChat.findFirst({ where: { id, account: { userId: user.id } } });
}
const chatName = (c: { name: string | null; phone: string | null }) => c.name || (c.phone ? `+${c.phone}` : "WhatsApp");

/** 报价单明细：产品库里的取资料和价格（换算到报价币种），没给单价就用产品价 */
async function quoteItems(user: CurrentUser, raw: unknown, currency: string) {
  const list = (Array.isArray(raw) ? raw : []).slice(0, 50) as P[];
  const ids = list.map((i) => str(i.productId)).filter(Boolean);
  const [products, rates] = await Promise.all([
    ids.length ? tenantDb(user.tenantId).product.findMany({ where: { id: { in: ids } } }) : [],
    getRates(user.tenantId),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = [];
  for (const i of list) {
    const p = byId.get(str(i.productId));
    const quantity = Number(i.quantity) > 0 ? Number(i.quantity) : (p?.moq ?? 1);
    const given = i.unitPrice != null && i.unitPrice !== "" ? Number(i.unitPrice) : NaN;
    const unitPrice = Number.isFinite(given) && given >= 0 ? given : p ? convertPrice(Number(p.price), p.currency, currency, rates) : NaN;
    const name = p ? p.nameEn || p.name : str(i.name, 300);
    if (!name) return "明细里有产品没写名称";
    if (!Number.isFinite(unitPrice)) return `「${name}」没有单价：产品库里没有这个产品，请给出 unitPrice`;
    items.push({
      productId: p?.id ?? null,
      sku: p?.sku ?? (str(i.sku, 100) || null),
      name,
      spec: p?.spec ?? (str(i.spec, 2000) || null),
      imageUrl: p?.imageUrl ?? null,
      unit: p?.unit ?? (str(i.unit, 20) || "pcs"),
      quantity,
      unitPrice: round4(unitPrice),
    });
  }
  if (!items.length) return "报价单至少要有一行产品（先用 search_products 找产品）";
  return items;
}

/** 校验 AI 给的参数，补齐需要的信息，生成确认卡片；有问题返回给模型看的错误说明 */
export async function prepareAction(user: CurrentUser, kind: AiActionKind, p: P): Promise<ActionCard | string> {
  const db = tenantDb(user.tenantId);
  switch (kind) {
    case "send_whatsapp": {
      const chat = await ownChat(user, str(p.chatId));
      if (!chat) return "chatId 无效（必须是用户自己的 WhatsApp 会话）或没有 WhatsApp 权限";
      const text = str(p.text, 4000);
      if (!text) return "text 不能为空";
      return {
        kind,
        title: `发 WhatsApp 给 ${chatName(chat)}`,
        fields: [],
        edit: [{ key: "text", label: "消息内容", multiline: true }],
        params: { chatId: chat.id, text },
        confirm: "发送",
        outward: true,
      };
    }
    case "send_email": {
      if (!can(user, "mail.use")) return "用户没有邮件权限";
      const account = await db.mailAccount.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
      const to = str(p.to, 500);
      const subject = str(p.subject, 500);
      const text = str(p.text, 20000);
      const compose = `/mail/compose?${new URLSearchParams({ to, subject, body: text }).toString()}`.slice(0, 6000);
      if (!account) return "用户还没有绑定发件邮箱，请用 open_page 打开 /settings/mailboxes";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+/.test(to)) return "to 必须是邮箱地址（先用 customer_channels 查联系人邮箱）";
      if (!subject && !text) return "主题和正文不能都为空";
      return {
        kind,
        title: `发邮件给 ${to}`,
        fields: [{ label: "发件邮箱", value: account.email }],
        edit: [
          { key: "subject", label: "主题" },
          { key: "text", label: "正文", multiline: true },
        ],
        params: { accountId: account.id, to, subject, text },
        confirm: "发送邮件",
        outward: true,
        alt: { label: "在写信页打开", href: compose },
      };
    }
    case "create_quotation": {
      if (!can(user, "quotation.create")) return "用户没有新建报价单的权限";
      const found = await getCustomerForUser(user, str(p.customerId));
      if (!found?.access.edit) return "customerId 无效，或只能给自己（或下属）负责的客户开报价单";
      const c = found.customer;
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
      const currency = (CURRENCIES as readonly string[]).includes(str(p.currency).toUpperCase())
        ? str(p.currency).toUpperCase()
        : tenant.defaultCurrency;
      const items = await quoteItems(user, p.items, currency);
      if (typeof items === "string") return items;
      const contact = await db.contact.findFirst({ where: { customerId: c.id }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
      const tradeTerm = (TRADE_TERMS as readonly string[]).includes(str(p.tradeTerm).toUpperCase()) ? str(p.tradeTerm).toUpperCase() : "FOB";
      const { total } = computeTotals(items, { discount: 0, shippingFee: 0, otherFee: 0 });
      const params: Record<string, string> = {
        customerId: c.id,
        buyerName: c.name,
        buyerContact: contact?.name ?? "",
        buyerEmail: contact?.email ?? "",
        buyerPhone: contact?.phone ?? "",
        buyerAddress: c.address ?? "",
        currency,
        tradeTerm,
        port: str(p.port, 100),
        paymentTerm: str(p.paymentTerm, 300),
        title: str(p.title, 200),
        quoteDate: dateInput(user.timezone),
        validUntil: tenant.quotationValidDays ? dateInput(user.timezone, tenant.quotationValidDays) : "",
        terms: tenant.docQuotationTerms ?? "",
        remark: str(p.remark, 2000),
        items: JSON.stringify(items),
      };
      return {
        kind,
        title: `给 ${c.name} 起草报价单`,
        fields: [
          ...items.map((i) => ({ label: i.name, value: `${i.quantity} ${i.unit} × ${formatAmount(i.unitPrice, currency)}` })),
          { label: "合计", value: `${formatAmount(total, currency)} ${tradeTerm}${params.port ? ` ${params.port}` : ""}` },
          { label: "有效期至", value: params.validUntil || "—" },
        ],
        edit: [{ key: "remark", label: "备注", multiline: true }],
        params,
        confirm: "保存为草稿",
      };
    }
    case "send_quotation": {
      const chat = await ownChat(user, str(p.chatId));
      if (!chat) return "chatId 无效（必须是用户自己的 WhatsApp 会话）";
      const q = await db.quotation.findFirst({ where: { id: str(p.quotationId) } });
      if (!q || (chat.customerId && q.customerId !== chat.customerId)) return "quotationId 无效，或报价单不属于这个会话的客户";
      if (q.approval === "PENDING" || q.approval === "REJECTED") return "报价单在审批中或被驳回，不能发送";
      return {
        kind,
        title: `把报价单 ${q.no} 发到 WhatsApp`,
        fields: [
          { label: "会话", value: chatName(chat) },
          { label: "金额", value: formatAmount(q.total.toString(), q.currency) },
          { label: "内容", value: "问候 + 在线查看链接 + 金额，客户打开会记一条动态" },
        ],
        params: { chatId: chat.id, quotationId: q.id },
        confirm: "发送",
        outward: true,
      };
    }
    case "send_product": {
      const chat = await ownChat(user, str(p.chatId));
      if (!chat) return "chatId 无效（必须是用户自己的 WhatsApp 会话）";
      const prod = await db.product.findFirst({ where: { id: str(p.productId) } });
      if (!prod) return "productId 无效（先用 search_products）";
      const withPrice = p.withPrice === true || p.withPrice === "true";
      return {
        kind,
        title: `把产品发到 WhatsApp：${chatName(chat)}`,
        fields: [
          { label: "产品", value: `${prod.nameEn || prod.name}（${prod.sku}）` },
          { label: "带价格", value: withPrice ? `是（${formatAmount(prod.price.toString(), prod.currency)} / ${prod.unit}）` : "否" },
        ],
        params: { chatId: chat.id, productId: prod.id, withPrice: String(withPrice) },
        confirm: "发送",
        outward: true,
      };
    }
    case "send_form": {
      const chat = await ownChat(user, str(p.chatId));
      if (!chat) return "chatId 无效（必须是用户自己的 WhatsApp 会话）";
      const form = str(p.form) === "shipping" ? "shipping" : "inquiry";
      return {
        kind,
        title: `发${form === "inquiry" ? "询价表单" : "收货信息表单"}给 ${chatName(chat)}`,
        fields: [{ label: "说明", value: "客户填完会回到这个会话，并自动记到客户资料" }],
        params: { chatId: chat.id, form },
        confirm: "发送",
        outward: true,
      };
    }
    case "create_task": {
      const title = str(p.title, 200);
      if (!title) return "title 不能为空";
      const when = str(p.when);
      const preset = TIME_PRESETS.find((t) => t.key === when);
      const dueAt = preset ? presetLocal(preset.key as TimePreset, user.timezone) : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when) ? when : "";
      if (!dueAt || !parseLocalInput(dueAt, user.timezone)) return "when 要么是快捷时间 key，要么是 YYYY-MM-DDTHH:mm（企业时区）";
      let customerName = "";
      const customerId = str(p.customerId);
      if (customerId) {
        const found = await getCustomerForUser(user, customerId);
        if (!found?.access.edit) return "customerId 无效或无权给该客户建提醒";
        customerName = found.customer.name;
      }
      const kindKey = str(p.reminder) in REMINDER_KINDS ? str(p.reminder) : "";
      return {
        kind,
        title: "添加提醒",
        fields: [
          { label: "时间", value: formatDateTime(parseLocalInput(dueAt, user.timezone)!, user.timezone) },
          ...(customerName ? [{ label: "客户", value: customerName }] : []),
          ...(kindKey ? [{ label: "场景", value: REMINDER_KINDS[kindKey].label }] : []),
        ],
        edit: [{ key: "title", label: "内容" }],
        params: { title, dueAt, customerId, kind: kindKey },
        confirm: "添加",
      };
    }
    case "add_followup": {
      const found = await getCustomerForUser(user, str(p.customerId));
      if (!found?.access.edit) return "customerId 无效，或只有负责人（或其上级）可以写跟进";
      const method = FOLLOW_METHODS.some((m) => m.value === str(p.method)) ? str(p.method) : "OTHER";
      const content = str(p.content, 5000);
      if (!content) return "content 不能为空";
      return {
        kind,
        title: `给 ${found.customer.name} 写跟进`,
        fields: [{ label: "方式", value: FOLLOW_METHODS.find((m) => m.value === method)!.label }],
        edit: [{ key: "content", label: "跟进内容", multiline: true }],
        params: { customerId: found.customer.id, method, content },
        confirm: "保存跟进",
      };
    }
    case "create_lead": {
      if (!can(user, "lead.create")) return "用户没有新建线索的权限";
      const keys = ["companyName", "contactName", "email", "phone", "whatsapp", "country", "source", "products", "inquiry"] as const;
      const params = Object.fromEntries(keys.map((k) => [k, str(p[k], k === "inquiry" ? 10000 : 300)]));
      if (!params.companyName && !params.contactName && !params.email && !params.whatsapp && !params.phone)
        return "公司名、联系人、邮箱、电话至少给一项";
      const labels: Record<string, string> = {
        companyName: "公司",
        contactName: "联系人",
        email: "邮箱",
        phone: "电话",
        whatsapp: "WhatsApp",
        country: "国家",
        source: "来源",
        products: "意向产品",
      };
      return {
        kind,
        title: "新建询盘线索",
        fields: Object.entries(labels)
          .filter(([k]) => params[k])
          .map(([k, label]) => ({ label, value: params[k] })),
        edit: [{ key: "inquiry", label: "询盘内容", multiline: true }],
        params,
        confirm: "创建线索",
      };
    }
    case "enroll_sequence":
    case "set_sequence_status": {
      if (!can(user, "mail.use")) return "用户没有邮件营销权限";
      const seq = await db.mailSequence.findFirst({
        where: { id: str(p.sequenceId) },
        include: { _count: { select: { steps: true, enrollments: true } } },
      });
      if (!seq || !(await inScope(user, seq.ownerId))) return "sequenceId 无效（先用 list_sequences）";
      if (kind === "set_sequence_status") {
        const active = p.active === true || p.active === "true";
        return {
          kind,
          title: `${active ? "启动" : "暂停"}营销序列「${seq.name}」`,
          fields: [{ label: "收件人", value: `${seq._count.enrollments} 位` }],
          params: { sequenceId: seq.id, active: String(active) },
          confirm: active ? "启动" : "暂停",
          outward: active,
        };
      }
      const ids = (Array.isArray(p.customerIds) ? p.customerIds : str(p.customerIds).split(","))
        .map((x) => str(x, 40))
        .filter(Boolean)
        .slice(0, 500);
      const customers = ids.length ? await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, ownerId: true } }) : [];
      const ok = [];
      for (const c of customers) if (c.ownerId && (await inScope(user, c.ownerId))) ok.push(c);
      if (!ok.length) return "customerIds 里没有有效客户（数据范围内的客户 id）";
      return {
        kind,
        title: `把 ${ok.length} 位客户加入营销序列「${seq.name}」`,
        fields: [
          {
            label: "客户",
            value:
              ok
                .slice(0, 8)
                .map((c) => c.name)
                .join("、") + (ok.length > 8 ? ` 等 ${ok.length} 位` : ""),
          },
          { label: "序列", value: `${seq._count.steps} 封邮件，${seq.status === "ACTIVE" ? "进行中，会按计划自动发出" : "已暂停，启动后才发"}` },
        ],
        params: { sequenceId: seq.id, customerIds: ok.map((c) => c.id).join(",") },
        confirm: "加入序列",
        outward: seq.status === "ACTIVE",
        alt: { label: "打开序列", href: `/marketing/${seq.id}` },
      };
    }
  }
}
