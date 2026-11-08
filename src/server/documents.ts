import "server-only";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { scopeOwnerIds } from "@/server/scope";
import { can, type CurrentUser } from "@/server/auth";
import { CURRENCIES } from "@/lib/crm";
import { computeTotals, lineAmount, round2, round4 } from "@/lib/docs";

/** 企业汇率表：1 外币 = x 人民币 */
export async function getRates(tenantId: string): Promise<Record<string, number>> {
  const rows = await tenantDb(tenantId).exchangeRate.findMany();
  const rates: Record<string, number> = { CNY: 1 };
  for (const r of rows) rates[r.currency] = Number(r.rate);
  return rates;
}

/** 单据的数据范围：负责人在范围内（全公司范围时也包括负责人已被删除的单据） */
export async function docScopeWhere(user: CurrentUser) {
  const ids = await scopeOwnerIds(user);
  return ids ? { ownerId: { in: ids } } : {};
}

export async function docInScope(user: CurrentUser, ownerId: string | null) {
  const ids = await scopeOwnerIds(user);
  return ids === null || (!!ownerId && ids.includes(ownerId));
}

/** 企业时区下的 yyyymmdd */
function ymd(tz: string, date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}`;
}

/** 下一个单号：QT20261107-001 / SO20261107-001（按天流水） */
export async function nextDocNo(tenantId: string, kind: "quotation" | "order", tz: string) {
  const prefix = `${kind === "quotation" ? "QT" : "SO"}${ymd(tz)}-`;
  const where = { tenantId, no: { startsWith: prefix } };
  const last =
    kind === "quotation"
      ? await prisma.quotation.findFirst({ where, orderBy: { no: "desc" }, select: { no: true } })
      : await prisma.order.findFirst({ where, orderBy: { no: "desc" }, select: { no: true } });
  const seq = last ? Number(last.no.slice(prefix.length)) + 1 : 1;
  return prefix + String(seq).padStart(3, "0");
}

export function isUniqueError(e: unknown) {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
}

/** 单号撞了（两人同时开单）就重取单号再试 */
export async function withDocNo<T>(
  tenantId: string,
  kind: "quotation" | "order",
  tz: string,
  fn: (no: string) => Promise<T>,
) {
  for (let i = 0; ; i++) {
    const no = await nextDocNo(tenantId, kind, tz);
    try {
      return await fn(no);
    } catch (e) {
      if (i >= 4 || !isUniqueError(e)) throw e;
    }
  }
}

// ── 表单解析 ──

const optText = (max = 500) => z.string().trim().max(max).optional().transform((v) => v || null);
const money = z.coerce.number({ message: "金额格式不正确" }).min(0, "不能为负").max(1e11).default(0);

const itemSchema = z.object({
  productId: z.string().nullish().transform((v) => v || null),
  sku: z.string().trim().max(100).nullish().transform((v) => v || null),
  name: z.string().trim().min(1, "明细里有产品名称为空").max(300),
  spec: z.string().trim().max(2000).nullish().transform((v) => v || null),
  imageUrl: z.string().trim().max(500).nullish().transform((v) => v || null),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  quantity: z.coerce.number({ message: "数量格式不正确" }).positive("数量要大于 0").max(1e9),
  unitPrice: z.coerce.number({ message: "单价格式不正确" }).min(0, "单价不能为负").max(1e9),
});

const itemsSchema = z
  .string()
  .transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "明细格式不正确" });
      return z.NEVER;
    }
  })
  .pipe(z.array(itemSchema).min(1, "至少添加一行产品明细").max(200, "明细最多 200 行"));

/** 报价单、订单共用的表头字段 */
export const docBaseSchema = z.object({
  id: z.string().optional(),
  customerId: z.string().min(1, "请选择客户"),
  opportunityId: z.string().optional().transform((v) => v || null),
  buyerName: z.string().trim().min(1, "请填写买方名称").max(300),
  buyerContact: optText(100),
  buyerEmail: optText(200),
  buyerPhone: optText(100),
  buyerAddress: optText(500),
  currency: z.enum(CURRENCIES),
  tradeTerm: optText(20),
  port: optText(100),
  paymentTerm: optText(300),
  discount: money,
  shippingFee: money,
  otherFee: money,
  terms: optText(5000),
  remark: optText(2000),
  items: itemsSchema,
});

export type DocBase = z.infer<typeof docBaseSchema>;

/** 计算明细金额与合计，得到可直接写库的数据 */
export function buildDocMoney(d: DocBase) {
  const items = d.items.map((it, sort) => ({
    ...it,
    sort,
    quantity: round4(it.quantity),
    unitPrice: round4(it.unitPrice),
    amount: lineAmount(it.quantity, it.unitPrice),
  }));
  const fees = { discount: round2(d.discount), shippingFee: round2(d.shippingFee), otherFee: round2(d.otherFee) };
  const { subtotal, total } = computeTotals(items, fees);
  return { items, fees, subtotal, total };
}

/** 明细里引用的产品必须属于本企业，否则清掉引用 */
export async function sanitizeProductIds<T extends { productId: string | null }>(tenantId: string, items: T[]) {
  const ids = [...new Set(items.map((i) => i.productId).filter(Boolean))] as string[];
  if (!ids.length) return items;
  const found = await tenantDb(tenantId).product.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const ok = new Set(found.map((p) => p.id));
  return items.map((i) => (i.productId && !ok.has(i.productId) ? { ...i, productId: null } : i));
}

/** 编辑器需要的数据：在售产品、汇率、数据范围内的客户（含联系人和商机） */
export async function docEditorData(user: CurrentUser) {
  const db = tenantDb(user.tenantId);
  const ids = await scopeOwnerIds(user);
  const customerWhere = ids ? { ownerId: { in: ids } } : { ownerId: { not: null } };
  const [products, rates, customers] = await Promise.all([
    db.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      take: 2000,
      select: { id: true, sku: true, name: true, nameEn: true, spec: true, unit: true, price: true, currency: true, imageUrl: true },
    }),
    getRates(user.tenantId),
    db.customer.findMany({
      where: customerWhere,
      orderBy: { updatedAt: "desc" },
      take: 1000,
      select: {
        id: true,
        name: true,
        address: true,
        contacts: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: { id: true, name: true, email: true, phone: true },
        },
        opportunities: {
          where: { stage: { kind: "OPEN" } },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true },
        },
      },
    }),
  ]);
  return {
    rates,
    products: products.map((p) => ({ ...p, price: Number(p.price) })),
    customers,
  };
}

export type DocEditorData = Awaited<ReturnType<typeof docEditorData>>;

/** Decimal 字段转成可序列化的明细 */
export function serializeItems(
  items: {
    productId: string | null;
    sku: string | null;
    name: string;
    spec: string | null;
    imageUrl: string | null;
    unit: string;
    quantity: { toString(): string };
    unitPrice: { toString(): string };
  }[],
) {
  return items.map((i) => ({
    productId: i.productId,
    sku: i.sku,
    name: i.name,
    spec: i.spec,
    imageUrl: i.imageUrl,
    unit: i.unit,
    quantity: Number(i.quantity.toString()),
    unitPrice: Number(i.unitPrice.toString()),
  }));
}

/** 读取报价单及当前用户的权限；看不到时返回 null */
export async function getQuotationForUser(user: CurrentUser, id: string) {
  if (!can(user, "quotation.view")) return null;
  const q = await tenantDb(user.tenantId).quotation.findFirst({
    where: { id },
    include: {
      items: { orderBy: { sort: "asc" } },
      owner: { select: { name: true } },
      customer: { select: { id: true, name: true } },
      opportunity: { select: { id: true, name: true } },
      orders: { select: { id: true, no: true, status: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!q || !(await docInScope(user, q.ownerId))) return null;
  return q;
}

/** 读取订单及当前用户的权限；看不到时返回 null */
export async function getOrderForUser(user: CurrentUser, id: string) {
  if (!can(user, "order.view")) return null;
  const o = await tenantDb(user.tenantId).order.findFirst({
    where: { id },
    include: {
      items: { orderBy: { sort: "asc" } },
      owner: { select: { name: true } },
      customer: { select: { id: true, name: true } },
      opportunity: { select: { id: true, name: true } },
      quotation: { select: { id: true, no: true } },
      payments: { orderBy: { receivedAt: "asc" } },
    },
  });
  if (!o || !(await docInScope(user, o.ownerId))) return null;
  return o;
}

/**
 * 编辑已有单据时：客户可能已不在当前用户范围内、关联商机可能已关闭，
 * 编辑器的下拉里仍要有它们，否则保存时会被清掉。
 */
export function withCurrentCustomer(
  customers: DocEditorData["customers"],
  current: { id: string; name: string },
  opportunity: { id: string; name: string } | null,
) {
  const list = customers.some((c) => c.id === current.id)
    ? customers
    : [{ id: current.id, name: current.name, address: null, contacts: [], opportunities: [] }, ...customers];
  if (!opportunity) return list;
  return list.map((c) =>
    c.id === current.id && !c.opportunities.some((o) => o.id === opportunity.id)
      ? { ...c, opportunities: [opportunity, ...c.opportunities] }
      : c,
  );
}

/** 单据抬头（卖方信息）；没填英文名时退回企业名称 */
export async function getSeller(tenantId: string) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return {
    name: t.docCompanyName || t.name,
    address: t.docAddress,
    phone: t.docPhone,
    email: t.docEmail,
    website: t.docWebsite,
    bankInfo: t.docBankInfo,
  };
}
