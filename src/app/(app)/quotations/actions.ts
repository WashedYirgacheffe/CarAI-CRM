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
import { QUOTATION_STATUSES, formatAmount, quotationStatus } from "@/lib/docs";

export type SaveDocResult = ActionState & { id?: string };

const denied = (message = "没有操作权限"): ActionState => ({ ok: false, message });
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

const quotationSchema = docBaseSchema.extend({
  title: optText(200),
  quoteDate: z.string().min(1, "请选择报价日期"),
  validUntil: z.string().optional(),
  deliveryTime: optText(200),
});

function revalidate(id?: string, customerId?: string | null) {
  revalidatePath("/quotations");
  if (id) revalidatePath(`/quotations/${id}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

/** 当前用户能编辑的报价单 */
async function editableQuotation(user: CurrentUser, id: string) {
  if (!can(user, "quotation.edit")) return null;
  const q = await tenantDb(user.tenantId).quotation.findFirst({ where: { id } });
  if (!q || !(await docInScope(user, q.ownerId))) return null;
  return q;
}

export async function saveQuotationAction(_p: ActionState, fd: FormData): Promise<SaveDocResult> {
  const user = await requireUser();
  const parsed = quotationSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const d = parsed.data;
  const tz = user.timezone;
  const quoteDate = parseLocalInput(d.quoteDate, tz);
  if (!quoteDate) return { ok: false, fieldErrors: { quoteDate: ["日期格式不正确"] } };
  const validUntil = parseLocalInput(d.validUntil, tz);
  if (validUntil && validUntil < quoteDate) return { ok: false, fieldErrors: { validUntil: ["有效期不能早于报价日期"] } };

  const db = tenantDb(user.tenantId);
  const { items: rawItems, fees, subtotal, total } = buildDocMoney(d);
  const items = await sanitizeProductIds(user.tenantId, rawItems);
  const rates = await getRates(user.tenantId);
  const header = {
    title: d.title,
    buyerName: d.buyerName,
    buyerContact: d.buyerContact,
    buyerEmail: d.buyerEmail,
    buyerPhone: d.buyerPhone,
    buyerAddress: d.buyerAddress,
    currency: d.currency,
    exchangeRate: rates[d.currency] ?? 1,
    quoteDate,
    validUntil,
    tradeTerm: d.tradeTerm,
    port: d.port,
    paymentTerm: d.paymentTerm,
    deliveryTime: d.deliveryTime,
    ...fees,
    subtotal,
    total,
    terms: d.terms,
    remark: d.remark,
  };

  if (d.id) {
    const q = await editableQuotation(user, d.id);
    if (!q) return denied();
    const opportunityId = await checkOpportunity(user, q.customerId, d.opportunityId);
    await prisma.$transaction([
      prisma.quotation.updateMany({ where: { tenantId: user.tenantId, id: q.id }, data: { ...header, opportunityId } }),
      prisma.quotationItem.deleteMany({ where: { quotationId: q.id } }),
      prisma.quotationItem.createMany({ data: items.map((it) => ({ ...it, quotationId: q.id })) }),
    ]);
    revalidate(q.id, q.customerId);
    return { ok: true, message: "报价单已保存", id: q.id };
  }

  if (!can(user, "quotation.create")) return denied();
  const found = await getCustomerForUser(user, d.customerId);
  if (!found?.access.edit) return denied("只能给自己（或下属）负责的客户开报价单");
  const opportunityId = await checkOpportunity(user, d.customerId, d.opportunityId);

  const created = await withDocNo(user.tenantId, "quotation", tz, (no) =>
    prisma.$transaction(async (tx) => {
      const q = await tx.quotation.create({
        data: {
          ...header,
          no,
          tenantId: user.tenantId,
          customerId: d.customerId,
          opportunityId,
          ownerId: found.customer.ownerId ?? user.id,
          createdById: user.id,
        },
      });
      await tx.quotationItem.createMany({ data: items.map((it) => ({ ...it, quotationId: q.id })) });
      return q;
    }),
  );
  await db.activity.create({
    data: {
      tenantId: user.tenantId,
      customerId: d.customerId,
      opportunityId,
      type: "SYSTEM",
      event: "quotation",
      content: `新建报价单 ${created.no}（${formatAmount(total, d.currency)}）`,
      userId: user.id,
    },
  });
  revalidate(created.id, d.customerId);
  return { ok: true, message: `报价单 ${created.no} 已创建`, id: created.id };
}

/** 商机必须属于该客户，否则忽略 */
async function checkOpportunity(user: CurrentUser, customerId: string, opportunityId: string | null) {
  if (!opportunityId) return null;
  const n = await tenantDb(user.tenantId).opportunity.count({ where: { id: opportunityId, customerId } });
  return n ? opportunityId : null;
}

const statusValues = QUOTATION_STATUSES.map((s) => s.value) as [string, ...string[]];

export async function setQuotationStatusAction(id: string, status: string): Promise<ActionState> {
  const user = await requireUser();
  const q = await editableQuotation(user, id);
  if (!q) return denied();
  if (!z.enum(statusValues).safeParse(status).success) return denied("状态不正确");
  if (q.status === status) return { ok: true };
  await tenantDb(user.tenantId).quotation.updateMany({
    where: { id },
    data: { status: status as (typeof QUOTATION_STATUSES)[number]["value"] },
  });
  await logActivity({
    tenantId: user.tenantId,
    customerId: q.customerId,
    opportunityId: q.opportunityId,
    event: "quotation",
    content: `报价单 ${q.no} 状态：${quotationStatus(q.status).label} → ${quotationStatus(status).label}`,
    userId: user.id,
  });
  revalidate(id, q.customerId);
  return { ok: true, message: `已标记为「${quotationStatus(status).label}」` };
}

/** 复制一份为新的草稿（常用于改价重报） */
export async function duplicateQuotationAction(id: string): Promise<SaveDocResult> {
  const user = await requireUser();
  if (!can(user, "quotation.create")) return denied();
  const db = tenantDb(user.tenantId);
  const src = await db.quotation.findFirst({ where: { id }, include: { items: { orderBy: { sort: "asc" } } } });
  if (!src || !(await docInScope(user, src.ownerId))) return denied();
  const found = await getCustomerForUser(user, src.customerId);
  if (!found?.access.edit) return denied("这个客户已不在你的负责范围内");
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { quotationValidDays: true } });
  const rates = await getRates(user.tenantId);
  const now = new Date();

  const copy = await withDocNo(user.tenantId, "quotation", user.timezone, (no) =>
    prisma.$transaction(async (tx) => {
      const q = await tx.quotation.create({
        data: {
          tenantId: src.tenantId,
          customerId: src.customerId,
          opportunityId: src.opportunityId,
          title: src.title,
          buyerName: src.buyerName,
          buyerContact: src.buyerContact,
          buyerEmail: src.buyerEmail,
          buyerPhone: src.buyerPhone,
          buyerAddress: src.buyerAddress,
          currency: src.currency,
          tradeTerm: src.tradeTerm,
          port: src.port,
          paymentTerm: src.paymentTerm,
          deliveryTime: src.deliveryTime,
          subtotal: src.subtotal,
          discount: src.discount,
          shippingFee: src.shippingFee,
          otherFee: src.otherFee,
          total: src.total,
          terms: src.terms,
          remark: src.remark,
          no,
          status: "DRAFT",
          exchangeRate: rates[src.currency] ?? src.exchangeRate,
          quoteDate: now,
          validUntil: t.quotationValidDays ? new Date(now.getTime() + t.quotationValidDays * 86_400_000) : null,
          ownerId: found.customer.ownerId ?? user.id,
          createdById: user.id,
        },
      });
      await tx.quotationItem.createMany({
        data: src.items.map((it) => ({
          quotationId: q.id,
          productId: it.productId,
          sort: it.sort,
          sku: it.sku,
          name: it.name,
          spec: it.spec,
          imageUrl: it.imageUrl,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
      });
      return q;
    }),
  );
  await logActivity({
    tenantId: user.tenantId,
    customerId: src.customerId,
    opportunityId: src.opportunityId,
    event: "quotation",
    content: `复制报价单 ${src.no} 为 ${copy.no}`,
    userId: user.id,
  });
  revalidate(copy.id, src.customerId);
  return { ok: true, message: `已复制为 ${copy.no}`, id: copy.id };
}

export async function deleteQuotationAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "quotation.delete")) return denied();
  const db = tenantDb(user.tenantId);
  const q = await db.quotation.findFirst({ where: { id } });
  if (!q || !(await docInScope(user, q.ownerId))) return denied();
  await db.quotation.deleteMany({ where: { id } });
  revalidate(undefined, q.customerId);
  return { ok: true, message: `报价单 ${q.no} 已删除` };
}
