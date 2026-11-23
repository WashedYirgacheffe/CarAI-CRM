"use server";

import { tenantDb } from "@/server/db";
import { requireUser } from "@/server/auth";
import { scopeOwnerIds } from "@/server/scope";
import {
  customerPrefill,
  findCustomers,
  findOrders,
  findProducts,
  getTradeDoc,
  listTradeDocs,
  orderPrefill,
  type ChatLog,
} from "@/server/trade-docs";
import { isDocType, normalizeDoc } from "@/lib/trade-docs/schema";

const cleanChat = (v: unknown): ChatLog =>
  (Array.isArray(v) ? v : [])
    .filter((m): m is ChatLog[number] => !!m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .slice(-80)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 20_000), ...(m.card ? { card: m.card } : {}) }));

/** 保存单据（新建或覆盖），返回 id */
export async function saveTradeDocAction(input: { id?: string | null; type: string; data: unknown; chat?: unknown }) {
  const user = await requireUser();
  if (!isDocType(input.type)) return { ok: false as const, message: "单据类型不对" };
  const data = normalizeDoc(input.data);
  const row = {
    type: input.type,
    no: (data.no || data.blNo || data.contractNo || "").slice(0, 100) || null,
    buyer: (data.buyerName || "").split("\n")[0].slice(0, 200) || null,
    data: JSON.parse(JSON.stringify(data)),
    chat: JSON.parse(JSON.stringify(cleanChat(input.chat))),
  };
  const db = tenantDb(user.tenantId);
  if (input.id) {
    const ids = await scopeOwnerIds(user);
    const hit = await db.tradeDoc.updateMany({ where: { id: input.id, ...(ids ? { ownerId: { in: ids } } : {}) }, data: row });
    if (hit.count) return { ok: true as const, id: input.id, docs: await listTradeDocs(user) };
  }
  const created = await db.tradeDoc.create({ data: { ...row, tenantId: user.tenantId, ownerId: user.id } });
  return { ok: true as const, id: created.id, docs: await listTradeDocs(user) };
}

export async function loadTradeDocAction(id: string) {
  const user = await requireUser();
  return getTradeDoc(user, id);
}

export async function deleteTradeDocAction(id: string) {
  const user = await requireUser();
  const ids = await scopeOwnerIds(user);
  await tenantDb(user.tenantId).tradeDoc.deleteMany({ where: { id, ...(ids ? { ownerId: { in: ids } } : {}) } });
  return listTradeDocs(user);
}

export async function searchSourcesAction(q: string) {
  const user = await requireUser();
  const [orders, customers] = await Promise.all([findOrders(user, q, 6), findCustomers(user, q, 6)]);
  return { orders, customers };
}

export async function orderPrefillAction(orderId: string) {
  const user = await requireUser();
  return orderPrefill(user, orderId);
}

export async function customerPrefillAction(customerId: string) {
  const user = await requireUser();
  return customerPrefill(user, customerId);
}

export async function searchProductsAction(q: string) {
  const user = await requireUser();
  return findProducts(user, q, 8);
}
