import "server-only";
import { prisma, tenantDb } from "@/server/db";
import { scopeOwnerIds } from "@/server/scope";
import { can, type CurrentUser } from "@/server/auth";
import { getOrderForUser } from "@/server/documents";
import { round2 } from "@/lib/docs";
import { type DocData, type DocItem, type DocType, isDocType, normalizeDoc } from "@/lib/trade-docs/schema";

/*
 * AI 单据工作台的数据：存取单据、从订单 / 客户 / 产品带数据。
 * 单据只有负责人和其数据范围内的上级能看到（和报价单、订单的范围规则一致）。
 */

export type TradeDocRow = { id: string; type: DocType; no: string | null; buyer: string | null; updatedAt: Date };
export type ChatLog = { role: "user" | "assistant"; text: string; card?: unknown }[];

async function ownerWhere(user: CurrentUser) {
  const ids = await scopeOwnerIds(user);
  return ids ? { ownerId: { in: ids } } : {};
}

/** 卖方默认值：来自「设置 → 单据设置」 */
export async function sellerDefaults(tenantId: string): Promise<Partial<DocData>> {
  const t = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { name: true, docCompanyName: true, docAddress: true, docPhone: true, docEmail: true, docWebsite: true, docBankInfo: true },
  });
  const out: Partial<DocData> = {
    sellerName: (t.docCompanyName || t.name).toUpperCase(),
    sellerAddress: t.docAddress?.toUpperCase() ?? undefined,
    sellerTel: t.docPhone ?? undefined,
    sellerEmail: t.docEmail ?? undefined,
    sellerWebsite: t.docWebsite ?? undefined,
    bankInfo: t.docBankInfo ?? undefined,
  };
  if (t.docCompanyName && t.name !== t.docCompanyName && /[一-龥]/.test(t.name)) out.sellerNameCn = t.name;
  for (const k of Object.keys(out) as (keyof typeof out)[]) if (!out[k]) delete out[k];
  return out;
}

export async function listTradeDocs(user: CurrentUser, take = 60): Promise<TradeDocRow[]> {
  const rows = await tenantDb(user.tenantId).tradeDoc.findMany({
    where: await ownerWhere(user),
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, type: true, no: true, buyer: true, updatedAt: true },
  });
  return rows.filter((r) => isDocType(r.type)) as TradeDocRow[];
}

export async function getTradeDoc(user: CurrentUser, id: string) {
  const r = await tenantDb(user.tenantId).tradeDoc.findFirst({ where: { id, ...(await ownerWhere(user)) } });
  if (!r || !isDocType(r.type)) return null;
  return { id: r.id, type: r.type, data: normalizeDoc(r.data), chat: (Array.isArray(r.chat) ? r.chat : []) as ChatLog, updatedAt: r.updatedAt };
}

/** 国家代码 → 英文大写国名（单据用英文） */
function countryEn(code: string | null | undefined) {
  if (!code) return undefined;
  try {
    return (new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code).toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : undefined);
const dec = (v: { toString(): string } | null | undefined) => (v == null ? undefined : String(Number(v.toString())));

/** "60x40x30cm" / "60*40*30" → 立方米 */
function cartonCbm(size: string | null | undefined) {
  const m = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i.exec(size || "");
  if (!m) return 0;
  const k = { mm: 1e-9, cm: 1e-6, m: 1 }[(m[4] || "cm").toLowerCase() as "mm" | "cm" | "m"];
  return Number(m[1]) * Number(m[2]) * Number(m[3]) * k;
}

type ProductPack = { hsCode: string | null; cartonQty: number | null; cartonSize: string | null; grossWeight: unknown; netWeight: unknown; nameEn: string | null };

/** 按产品的装箱资料推算箱数、净毛重、体积 */
function packOf(qty: number, p: ProductPack | null | undefined): Partial<DocItem> {
  if (!p?.cartonQty || !qty) return p?.hsCode ? { hsCode: p.hsCode } : {};
  const cartons = Math.ceil(qty / p.cartonQty);
  const n = (v: unknown) => (v == null ? 0 : Number(String(v)));
  const cbm = cartonCbm(p.cartonSize);
  return {
    hsCode: p.hsCode ?? undefined,
    cartons: String(cartons),
    ...(n(p.netWeight) ? { nw: String(round2(cartons * n(p.netWeight))) } : {}),
    ...(n(p.grossWeight) ? { gw: String(round2(cartons * n(p.grossWeight))) } : {}),
    ...(cbm ? { cbm: String(Math.round(cartons * cbm * 1000) / 1000) } : {}),
  };
}

const SHIP_MODE: Record<string, string> = { sea: "BY SEA", air: "BY AIR", express: "BY EXPRESS", rail: "BY RAIL", truck: "BY TRUCK" };

/** 订单（+ 最近一票物流）→ 单据数据 */
export async function orderPrefill(user: CurrentUser, orderId: string): Promise<Partial<DocData> | null> {
  const o = await getOrderForUser(user, orderId);
  if (!o) return null;
  const productIds = o.items.map((i) => i.productId).filter(Boolean) as string[];
  const [products, customer] = await Promise.all([
    productIds.length
      ? tenantDb(user.tenantId).product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, hsCode: true, cartonQty: true, cartonSize: true, grossWeight: true, netWeight: true, nameEn: true },
        })
      : [],
    tenantDb(user.tenantId).customer.findFirst({ where: { id: o.customerId }, select: { country: true } }),
  ]);
  const pmap = new Map(products.map((p) => [p.id, p]));
  const items: DocItem[] = o.items.map((i) => {
    const qty = Number(i.quantity.toString());
    const p = i.productId ? pmap.get(i.productId) : null;
    return {
      itemNo: i.sku ?? undefined,
      name: i.name,
      desc: i.spec ?? undefined,
      imageUrl: i.imageUrl ?? undefined,
      unit: (i.unit || "pcs").toUpperCase(),
      qty: String(qty),
      unitPrice: String(Number(i.unitPrice.toString())),
      ...packOf(qty, p),
    };
  });
  const charges = [
    Number(o.shippingFee) ? { label: "FREIGHT", amount: dec(o.shippingFee) } : null,
    Number(o.otherFee) ? { label: "OTHER CHARGES", amount: dec(o.otherFee) } : null,
    Number(o.discount) ? { label: "DISCOUNT", amount: String(-Number(o.discount)) } : null,
  ].filter(Boolean) as DocData["charges"];
  const hs = [...new Set(items.map((i) => i.hsCode).filter(Boolean))];
  const s = o.shipments.filter((x) => x.status !== "CANCELLED").at(-1);
  const data: Partial<DocData> = {
    no: o.no,
    contractNo: o.no,
    date: isoDate(new Date()),
    buyerName: o.buyerName.toUpperCase(),
    buyerAddress: o.buyerAddress?.toUpperCase() ?? undefined,
    buyerContact: o.buyerContact ?? undefined,
    buyerTel: o.buyerPhone ?? undefined,
    buyerEmail: o.buyerEmail ?? undefined,
    currency: o.currency,
    tradeTerm: o.tradeTerm ?? undefined,
    tradePlace: o.port?.toUpperCase() ?? undefined,
    paymentTerm: o.paymentTerm?.toUpperCase() ?? undefined,
    deliveryTime: o.deliveryDate ? `BEFORE ${isoDate(o.deliveryDate)}` : undefined,
    marks: o.shippingMark ?? undefined,
    terms: o.terms ?? undefined,
    destCountry: countryEn(customer?.country),
    origin: "CHINA",
    hsCode: hs.length === 1 ? hs[0] : undefined,
    items,
    charges,
  };
  if (s) {
    Object.assign(data, {
      shipMode: SHIP_MODE[s.mode] ?? undefined,
      forwarder: s.forwarder ?? undefined,
      carrier: s.carrier ?? undefined,
      bookingNo: s.bookingNo ?? undefined,
      blNo: s.blNo ?? undefined,
      vessel: s.vessel ?? undefined,
      containerType: s.containerType ?? undefined,
      containers: s.containerNo
        ? s.containerNo
            .split(/[,，\s]+/)
            .filter(Boolean)
            .map((c) => [c, s.sealNo, s.containerType].filter(Boolean).join("/"))
            .join("\n")
        : undefined,
      loadingPort: s.portLoading?.toUpperCase() ?? undefined,
      dischargePort: s.portDischarge?.toUpperCase() ?? undefined,
      onBoardDate: isoDate(s.atd ?? s.etd),
      eta: isoDate(s.eta),
      totalPackages: s.packages ? String(s.packages) : undefined,
      totalGw: dec(s.grossWeight),
      totalCbm: dec(s.volume),
    });
  }
  for (const k of Object.keys(data) as (keyof DocData)[]) if (data[k] === undefined) delete data[k];
  return data;
}

/** 客户 → 买方信息 */
export async function customerPrefill(user: CurrentUser, customerId: string): Promise<Partial<DocData> | null> {
  if (!can(user, "customer.view")) return null;
  const c = await tenantDb(user.tenantId).customer.findFirst({
    where: { id: customerId, ...(await ownerWhere(user)) },
    select: {
      name: true,
      address: true,
      country: true,
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { name: true, email: true, phone: true } },
    },
  });
  if (!c) return null;
  const ct = c.contacts[0];
  const out: Partial<DocData> = {
    buyerName: c.name.toUpperCase(),
    buyerAddress: c.address?.toUpperCase() ?? undefined,
    buyerContact: ct?.name ?? undefined,
    buyerEmail: ct?.email ?? undefined,
    buyerTel: ct?.phone ?? undefined,
    destCountry: countryEn(c.country),
  };
  for (const k of Object.keys(out) as (keyof DocData)[]) if (out[k] === undefined) delete out[k];
  return out;
}

// ── 给 AI 和表单下拉用的查找 ──

export async function findOrders(user: CurrentUser, q = "", take = 8) {
  if (!can(user, "order.view")) return [];
  const ids = await scopeOwnerIds(user);
  const query = q.trim();
  const rows = await tenantDb(user.tenantId).order.findMany({
    where: {
      ...(ids ? { ownerId: { in: ids } } : {}),
      ...(query ? { OR: [{ no: { contains: query, mode: "insensitive" as const } }, { buyerName: { contains: query, mode: "insensitive" as const } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, no: true, buyerName: true, currency: true, total: true, status: true, orderDate: true },
  });
  return rows.map((r) => ({ ...r, total: Number(r.total), orderDate: isoDate(r.orderDate) }));
}

export async function findCustomers(user: CurrentUser, q = "", take = 8) {
  if (!can(user, "customer.view")) return [];
  const query = q.trim();
  return tenantDb(user.tenantId).customer.findMany({
    where: { ...(await ownerWhere(user)), ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}) },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, name: true, country: true },
  });
}

export async function findProducts(user: CurrentUser, q = "", take = 10) {
  if (!can(user, "product.view")) return [];
  const query = q.trim();
  const rows = await tenantDb(user.tenantId).product.findMany({
    where: {
      status: "ACTIVE",
      ...(query
        ? {
            OR: [
              { sku: { contains: query, mode: "insensitive" as const } },
              { name: { contains: query, mode: "insensitive" as const } },
              { nameEn: { contains: query, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      sku: true,
      name: true,
      nameEn: true,
      spec: true,
      unit: true,
      price: true,
      currency: true,
      imageUrl: true,
      hsCode: true,
      cartonQty: true,
      cartonSize: true,
      grossWeight: true,
      netWeight: true,
    },
  });
  return rows.map((p) => ({
    ...p,
    price: Number(p.price),
    grossWeight: p.grossWeight == null ? null : Number(p.grossWeight),
    netWeight: p.netWeight == null ? null : Number(p.netWeight),
    cbmPerCarton: Math.round(cartonCbm(p.cartonSize) * 10000) / 10000 || null,
  }));
}
