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
import { ORDER_STATUSES, dateInput, formatAmount, orderStatus, round2 } from "@/lib/docs";
import type { SaveDocResult } from "@/app/(app)/quotations/actions";
import { audit } from "@/server/audit";
import { clearDocApproval, docApprovalDecision, submitDocApproval } from "@/server/approvals";

/** 保存后按折扣决定审批状态，返回提示语后缀。confirm = 审批通过后把草稿改成已确认 */
async function applyApproval(
  user: CurrentUser,
  o: { id: string; no: string; customerId: string },
  next: { subtotal: number; discount: number },
  prev: { approval: string; subtotal: number; discount: number } | null,
  confirm = false,
) {
  const { decision, pct, limit } = await docApprovalDecision(user, next, prev);
  if (decision === "pending") {
    await prisma.order.updateMany({ where: { tenantId: user.tenantId, id: o.id }, data: { approval: "PENDING" } });
    await submitDocApproval(user, "order", o, pct, limit, { confirm });
    revalidatePath("/approvals");
    return `；折扣 ${pct}% 超过 ${limit}%，已提交审批${confirm ? "，通过后自动确认订单" : ""}`;
  }
  if (decision === "clear") {
    await prisma.order.updateMany({ where: { tenantId: user.tenantId, id: o.id }, data: { approval: "NONE" } });
    await clearDocApproval(user.tenantId, "order", o.id);
    revalidatePath("/approvals");
  }
  return "";
}

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
    const tip = await applyApproval(
      user,
      o,
      { subtotal, discount: fees.discount },
      { approval: o.approval, subtotal: Number(o.subtotal), discount: Number(o.discount) },
    );
    await audit(user, {
      action: "update",
      entity: "order",
      entityId: o.id,
      entityName: o.no,
      summary: `修改了订单 ${o.no}（${formatAmount(total, d.currency)}${Number(o.total) !== total ? `，原 ${formatAmount(Number(o.total), o.currency)}` : ""}）`,
    });
    revalidate(o.id, o.customerId);
    return { ok: true, message: `订单已保存${tip}`, id: o.id };
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

  const pre = await docApprovalDecision(user, { subtotal, discount: fees.discount }, null);
  const needApproval = pre.decision === "pending";
  // 折扣超限：先存成草稿，审批通过后自动确认
  const draft = !!d.asDraft || needApproval;
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
  const tip = await applyApproval(user, created, { subtotal, discount: fees.discount }, null, needApproval && !d.asDraft);
  await audit(user, {
    action: "create",
    entity: "order",
    entityId: created.id,
    entityName: created.no,
    summary: `新建了${draft ? "草稿" : ""}订单 ${created.no}（${found.customer.name}，${formatAmount(total, d.currency)}）`,
  });
  // 草稿不推进商机，确认后再推进
  const won = opportunityId && !draft ? await winOpportunity(user, opportunityId) : null;

  revalidate(created.id, d.customerId);
  if (quotation) revalidatePath(`/quotations/${quotation.id}`);
  if (won) revalidatePath("/opportunities");
  return {
    ok: true,
    message: `${draft ? "草稿" : ""}订单 ${created.no} 已创建${won ? `，商机已移到「${won}」` : ""}${tip}`,
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
  if ((o.approval === "PENDING" || o.approval === "REJECTED") && status !== "DRAFT" && status !== "CANCELLED") {
    return denied(o.approval === "PENDING" ? "订单折扣还在审批中，通过后才能往下走" : "订单折扣审批被驳回，请修改折扣后重新保存");
  }
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
  await audit(user, {
    action: "status",
    entity: "order",
    entityId: o.id,
    entityName: o.no,
    summary: `订单 ${o.no} 状态：${orderStatus(o.status).label} → ${orderStatus(status).label}`,
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
  await clearDocApproval(user.tenantId, "order", id);
  await audit(user, { action: "delete", entity: "order", entityId: id, entityName: o.no, summary: `删除了订单 ${o.no}（${formatAmount(Number(o.total), o.currency)}）` });
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
  fee: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .pipe(z.number({ message: "手续费格式不正确" }).min(0, "不能为负").max(1e9).nullable()),
  receivedAt: z.string().min(1, "请选择收款日期"),
  method: optText(50),
  payer: optText(200),
  fileId: optText(40),
  remark: optText(500),
});

/** 回款单号 RC20261117-01：当天第几笔 */
async function nextReceiptNo(tenantId: string, tz: string) {
  const day = dateInput(tz).replaceAll("-", "");
  const prefix = `RC${day}-`;
  const n = await tenantDb(tenantId).orderPayment.count({ where: { no: { startsWith: prefix } } });
  return `${prefix}${String(n + 1).padStart(2, "0")}`;
}

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
  // 水单只能挂这个客户（或没归属客户）的文件
  const fileId = d.fileId
    ? ((
        await tenantDb(user.tenantId).crmFile.findFirst({
          where: { id: d.fileId, OR: [{ customerId: o.customerId }, { customerId: null }] },
          select: { id: true },
        })
      )?.id ?? null)
    : null;
  const no = await nextReceiptNo(user.tenantId, user.timezone);
  await tenantDb(user.tenantId).orderPayment.create({
    data: {
      tenantId: user.tenantId,
      orderId: o.id,
      no,
      amount,
      fee: d.fee === null ? null : round2(d.fee),
      payer: d.payer,
      receivedAt,
      method: d.method,
      remark: d.remark,
      fileId,
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
  await audit(user, {
    action: "create",
    entity: "payment",
    entityId: o.id,
    entityName: no,
    summary: `订单 ${o.no} 登记收款 ${formatAmount(amount, o.currency)}（${no}${d.method ? `，${d.method}` : ""}）`,
  });
  revalidate(o.id, o.customerId);
  revalidatePath("/payments");
  return { ok: true, message: `收款已登记（${no}）` };
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
  await audit(user, {
    action: "delete",
    entity: "payment",
    entityId: o.id,
    entityName: p.no ?? o.no,
    summary: `删除了订单 ${o.no} 的收款 ${formatAmount(Number(p.amount), o.currency)}${p.no ? `（${p.no}）` : ""}`,
  });
  revalidate(o.id, o.customerId);
  revalidatePath("/payments");
  return { ok: true, message: "收款记录已删除" };
}

// ── 收款计划 ──

const planSchema = z
  .array(
    z.object({
      label: z.string().trim().min(1, "请填写每期的名称").max(60),
      amount: z.coerce.number({ message: "金额格式不正确" }).positive("每期金额要大于 0").max(1e11),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请选择到期日"),
    }),
  )
  .max(24, "最多 24 期");

/** 整体替换订单的收款计划（传空数组 = 清空） */
export async function savePaymentPlanAction(orderId: string, rows: unknown): Promise<ActionState> {
  const user = await requireUser();
  const o = await editableOrder(user, orderId);
  if (!o) return denied();
  const parsed = planSchema.safeParse(rows);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "收款计划格式不正确" };
  const plans = parsed.data.map((p, sort) => ({
    tenantId: user.tenantId,
    orderId: o.id,
    sort,
    label: p.label,
    amount: round2(p.amount),
    dueDate: parseLocalInput(`${p.dueDate}T00:00`, user.timezone)!,
  }));
  const sum = round2(plans.reduce((s, p) => s + p.amount, 0));
  const total = round2(Number(o.total));
  await prisma.$transaction([
    prisma.paymentPlan.deleteMany({ where: { tenantId: user.tenantId, orderId: o.id } }),
    prisma.paymentPlan.createMany({ data: plans }),
  ]);
  await audit(user, {
    action: "update",
    entity: "payment",
    entityId: o.id,
    entityName: o.no,
    summary: plans.length
      ? `设置了订单 ${o.no} 的收款计划：${parsed.data.map((p) => `${p.label} ${formatAmount(p.amount, o.currency)}（${p.dueDate}）`).join("；")}`
      : `清空了订单 ${o.no} 的收款计划`,
  });
  revalidate(o.id, o.customerId);
  revalidatePath("/payments");
  const diff = round2(total - sum);
  return {
    ok: true,
    message: !plans.length
      ? "收款计划已清空"
      : diff === 0
        ? "收款计划已保存"
        : `收款计划已保存（合计比订单金额${diff > 0 ? "少" : "多"} ${formatAmount(Math.abs(diff), o.currency)}）`,
  };
}
