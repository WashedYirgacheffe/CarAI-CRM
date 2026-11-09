"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { getCustomerForUser, logActivity } from "@/server/customers";
import {
  buildDocMoney,
  docBaseSchema,
  docInScope,
  getRates,
  sanitizeProductIds,
  withDocNo,
} from "@/server/documents";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { parseLocalInput } from "@/lib/crm";
import { ORDER_STATUSES, formatAmount, orderStatus, round2 } from "@/lib/docs";
import type { SaveDocResult } from "@/app/(app)/quotations/actions";

const denied = (message = "没有操作权限"): ActionState => ({ ok: false, message });
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

const orderSchema = docBaseSchema.extend({
  quotationId: z.string().optional().transform((v) => v || null),
  orderDate: z.string().min(1, "请选择下单日期"),
  deliveryDate: z.string().optional(),
  shippingMark: optText(1000),
  asDraft: z.string().optional(),
});

function revalidate(id?: string, customerId?: string | null) {
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/orders/${id}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

async function editableOrder(user: CurrentUser, id: string) {
  if (!can(user, "order.edit")) return null;
  const o = await tenantDb(user.tenantId).order.findFirst({ where: { id } });
  if (!o || !(await docInScope(user, o.ownerId))) return null;
  return o;
}

export async function saveOrderAction(_p: ActionState, fd: FormData): Promise<SaveDocResult> {
  const user = await requireUser();
  const parsed = orderSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const d = parsed.data;
  const tz = user.timezone;
  const orderDate = parseLocalInput(d.orderDate, tz);
  if (!orderDate) return { ok: false, fieldErrors: { orderDate: ["日期格式不正确"] } };
  const deliveryDate = parseLocalInput(d.deliveryDate, tz);

  const db = tenantDb(user.tenantId);
  const { items: rawItems, fees, subtotal, total } = buildDocMoney(d);
  const items = await sanitizeProductIds(user.tenantId, rawItems);
  const rates = await getRates(user.tenantId);
  const header = {
    buyerName: d.buyerName,
    buyerContact: d.buyerContact,
    buyerEmail: d.buyerEmail,
    buyerPhone: d.buyerPhone,
    buyerAddress: d.buyerAddress,
    currency: d.currency,
    exchangeRate: rates[d.currency] ?? 1,
    orderDate,
    deliveryDate,
    tradeTerm: d.tradeTerm,
    port: d.port,
    paymentTerm: d.paymentTerm,
    shippingMark: d.shippingMark,
    ...fees,
    subtotal,
    total,
    terms: d.terms,
    remark: d.remark,
  };

  if (d.id) {
    const o = await editableOrder(user, d.id);
    if (!o) return denied();
    const opportunityId = await checkOpportunity(user, o.customerId, d.opportunityId);
    await prisma.$transaction([
      prisma.order.updateMany({ where: { tenantId: user.tenantId, id: o.id }, data: { ...header, opportunityId } }),
      prisma.orderItem.deleteMany({ where: { orderId: o.id } }),
      prisma.orderItem.createMany({ data: items.map((it) => ({ ...it, orderId: o.id })) }),
    ]);
    revalidate(o.id, o.customerId);
    return { ok: true, message: "订单已保存", id: o.id };
  }

  if (!can(user, "order.create")) return denied();
  const found = await getCustomerForUser(user, d.customerId);
  if (!found?.access.edit) return denied("只能给自己（或下属）负责的客户建订单");
  const opportunityId = await checkOpportunity(user, d.customerId, d.opportunityId);

  // 来源报价单：必须是同一个客户、且在自己的范围内
  let quotation: { id: string; no: string; status: string } | null = null;
  if (d.quotationId) {
    const q = await db.quotation.findFirst({ where: { id: d.quotationId, customerId: d.customerId } });
    if (q && (await docInScope(user, q.ownerId))) quotation = q;
  }

  const draft = !!d.asDraft;
  const created = await withDocNo(user.tenantId, "order", tz, (no) =>
    prisma.$transaction(async (tx) => {
      const o = await tx.order.create({
        data: {
          ...header,
          no,
          tenantId: user.tenantId,
          customerId: d.customerId,
          opportunityId,
          quotationId: quotation?.id ?? null,
          status: draft ? "DRAFT" : "CONFIRMED",
          ownerId: found.customer.ownerId ?? user.id,
          createdById: user.id,
        },
      });
      await tx.orderItem.createMany({ data: items.map((it) => ({ ...it, orderId: o.id })) });
      if (quotation && quotation.status !== "CONVERTED") {
        await tx.quotation.updateMany({ where: { tenantId: user.tenantId, id: quotation.id }, data: { status: "CONVERTED" } });
      }
      return o;
    }),
  );

  await logActivity({
    tenantId: user.tenantId,
    customerId: d.customerId,
    opportunityId,
    event: "order",
    content: `新建${draft ? "草稿" : ""}订单 ${created.no}（${formatAmount(total, d.currency)}）${quotation ? `，来自报价单 ${quotation.no}` : ""}`,
    userId: user.id,
  });
  // 草稿不推进商机，确认后再推进
  const won = opportunityId && !draft ? await winOpportunity(user, opportunityId) : null;

  revalidate(created.id, d.customerId);
  if (quotation) revalidatePath(`/quotations/${quotation.id}`);
  if (won) revalidatePath("/opportunities");
  return {
    ok: true,
    message: `${draft ? "草稿" : ""}订单 ${created.no} 已创建${won ? `，商机已移到「${won}」` : ""}`,
    id: created.id,
  };
}

async function checkOpportunity(user: CurrentUser, customerId: string, opportunityId: string | null) {
  if (!opportunityId) return null;
  const n = await tenantDb(user.tenantId).opportunity.count({ where: { id: opportunityId, customerId } });
  return n ? opportunityId : null;
}

/** 下单后把进行中的商机移到第一个「赢单」阶段，返回阶段名 */
async function winOpportunity(user: CurrentUser, opportunityId: string) {
  const db = tenantDb(user.tenantId);
  const opp = await db.opportunity.findFirst({ where: { id: opportunityId }, include: { stage: true } });
  if (!opp || opp.stage.kind !== "OPEN") return null;
  const won = await db.stage.findFirst({ where: { kind: "WON" }, orderBy: { sort: "asc" } });
  if (!won) return null;
  const now = new Date();
  await db.opportunity.updateMany({ where: { id: opp.id }, data: { stageId: won.id, stageChangedAt: now, closedAt: now } });
  await logActivity({
    tenantId: user.tenantId,
    customerId: opp.customerId,
    opportunityId: opp.id,
    event: "stage",
    content: `商机「${opp.name}」阶段：${opp.stage.name} → ${won.name}（已下单）`,
    userId: user.id,
  });
  return won.name;
}

const statusValues = ORDER_STATUSES.map((s) => s.value) as [string, ...string[]];

export async function setOrderStatusAction(id: string, status: string): Promise<ActionState> {
  const user = await requireUser();
  const o = await editableOrder(user, id);
  if (!o) return denied();
  if (!z.enum(statusValues).safeParse(status).success) return denied("状态不正确");
  if (o.status === status) return { ok: true };
  await tenantDb(user.tenantId).order.updateMany({
    where: { id },
    data: { status: status as (typeof ORDER_STATUSES)[number]["value"] },
  });
  await logActivity({
    tenantId: user.tenantId,
    customerId: o.customerId,
    opportunityId: o.opportunityId,
    event: "order",
    content: `订单 ${o.no} 状态：${orderStatus(o.status).label} → ${orderStatus(status).label}`,
    userId: user.id,
  });
  // 草稿确认后才推进商机到赢单
  const won = o.status === "DRAFT" && status !== "CANCELLED" && o.opportunityId ? await winOpportunity(user, o.opportunityId) : null;
  if (won) revalidatePath("/opportunities");
  revalidate(id, o.customerId);
  return { ok: true, message: `已标记为「${orderStatus(status).label}」${won ? `，商机已移到「${won}」` : ""}` };
}

export async function deleteOrderAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "order.delete")) return denied();
  const db = tenantDb(user.tenantId);
  const o = await db.order.findFirst({ where: { id } });
  if (!o || !(await docInScope(user, o.ownerId))) return denied();
  await db.order.deleteMany({ where: { id } });
  revalidate(undefined, o.customerId);
  return { ok: true, message: `订单 ${o.no} 已删除` };
}

// ── 收款 ──

async function refreshPaid(tenantId: string, orderId: string) {
  const sum = await tenantDb(tenantId).orderPayment.aggregate({ where: { orderId }, _sum: { amount: true } });
  await tenantDb(tenantId).order.updateMany({ where: { id: orderId }, data: { paidAmount: sum._sum.amount ?? 0 } });
}

const paymentSchema = z.object({
  orderId: z.string().min(1),
  amount: z.coerce.number({ message: "金额格式不正确" }).positive("金额要大于 0").max(1e11),
  receivedAt: z.string().min(1, "请选择收款日期"),
  method: optText(50),
  remark: optText(500),
});

export async function addPaymentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = paymentSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const d = parsed.data;
  const o = await editableOrder(user, d.orderId);
  if (!o) return denied();
  const receivedAt = parseLocalInput(d.receivedAt, user.timezone);
  if (!receivedAt) return { ok: false, fieldErrors: { receivedAt: ["日期格式不正确"] } };
  const amount = round2(d.amount);
  await tenantDb(user.tenantId).orderPayment.create({
    data: {
      tenantId: user.tenantId,
      orderId: o.id,
      amount,
      receivedAt,
      method: d.method,
      remark: d.remark,
      createdById: user.id,
    },
  });
  await refreshPaid(user.tenantId, o.id);
  await logActivity({
    tenantId: user.tenantId,
    customerId: o.customerId,
    opportunityId: o.opportunityId,
    event: "payment",
    content: `订单 ${o.no} 收款 ${formatAmount(amount, o.currency)}${d.method ? `（${d.method}）` : ""}`,
    userId: user.id,
  });
  revalidate(o.id, o.customerId);
  return { ok: true, message: "收款已登记" };
}

export async function deletePaymentAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const db = tenantDb(user.tenantId);
  const p = await db.orderPayment.findFirst({ where: { id } });
  if (!p) return denied("收款记录不存在");
  const o = await editableOrder(user, p.orderId);
  if (!o) return denied();
  await db.orderPayment.deleteMany({ where: { id } });
  await refreshPaid(user.tenantId, o.id);
  revalidate(o.id, o.customerId);
  return { ok: true, message: "收款记录已删除" };
}
