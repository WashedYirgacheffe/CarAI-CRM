import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, tenantDb } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { audit } from "@/server/audit";
import { logActivity } from "@/server/customers";
import { allMembers } from "@/server/scope";
import { deleteCustomers, privateRows, releaseCustomers, transferCustomers } from "@/server/customer-ops";

export const APPROVAL_KINDS: Record<string, string> = {
  quotation: "报价单折扣",
  order: "订单折扣",
  customer_release: "退回公海",
  customer_delete: "删除客户",
  customer_transfer: "转移客户",
};

export type ApprovalRules = { discountPct: number; release: boolean; del: boolean; transfer: boolean };

export async function approvalRules(tenantId: string): Promise<ApprovalRules> {
  const t = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { approvalDiscountPct: true, approvalRelease: true, approvalDelete: true, approvalTransfer: true },
  });
  return { discountPct: t.approvalDiscountPct, release: t.approvalRelease, del: t.approvalDelete, transfer: t.approvalTransfer };
}

/** 折扣占小计的百分比（保留一位小数） */
export function discountPct(subtotal: number, discount: number) {
  if (!(subtotal > 0) || !(discount > 0)) return 0;
  return Math.round((discount / subtotal) * 1000) / 10;
}

/**
 * 报价单 / 订单保存时判断要不要审批。
 * 返回 "pending"（要提交审批）、"clear"（不再需要，去掉审批状态）、"keep"（保持原样，如已批准且折扣没变大）
 */
export async function docApprovalDecision(
  user: CurrentUser,
  next: { subtotal: number; discount: number },
  prev?: { approval: string; subtotal: number; discount: number } | null,
): Promise<{ decision: "pending" | "clear" | "keep"; pct: number; limit: number }> {
  const { discountPct: limit } = await approvalRules(user.tenantId);
  const pct = discountPct(next.subtotal, next.discount);
  if (!limit || pct <= limit || can(user, "approval.review")) {
    return { decision: prev && prev.approval !== "NONE" && prev.approval !== "APPROVED" ? "clear" : "keep", pct, limit };
  }
  if (prev?.approval === "APPROVED" && pct <= discountPct(prev.subtotal, prev.discount)) return { decision: "keep", pct, limit };
  return { decision: "pending", pct, limit };
}

/** 报价单 / 订单提交审批（同一单据之前没处理的审批单作废） */
export async function submitDocApproval(
  user: CurrentUser,
  kind: "quotation" | "order",
  doc: { id: string; no: string; customerId: string },
  pct: number,
  limit: number,
  payload: Prisma.InputJsonValue = {},
) {
  const db = tenantDb(user.tenantId);
  await db.approvalRequest.deleteMany({ where: { kind, targetId: doc.id, status: "PENDING" } });
  const label = kind === "quotation" ? "报价单" : "订单";
  const title = `${label} ${doc.no} 折扣 ${pct}%（超过 ${limit}%）`;
  await db.approvalRequest.create({
    data: { tenantId: user.tenantId, kind, targetId: doc.id, title, payload, requesterId: user.id },
  });
  await audit(user, { action: "submit", entity: "approval", entityId: doc.id, entityName: doc.no, summary: `提交审批：${title}` });
}

/** 单据不再需要审批：作废没处理的审批单 */
export async function clearDocApproval(tenantId: string, kind: "quotation" | "order", targetId: string) {
  await tenantDb(tenantId).approvalRequest.deleteMany({ where: { kind, targetId, status: "PENDING" } });
}

/** 客户的退公海 / 删除 / 转移要不要审批 */
export async function customerNeedsApproval(user: CurrentUser, kind: "customer_release" | "customer_delete" | "customer_transfer") {
  if (can(user, "approval.review")) return false;
  const r = await approvalRules(user.tenantId);
  return kind === "customer_release" ? r.release : kind === "customer_delete" ? r.del : r.transfer;
}

export async function submitCustomerApproval(
  user: CurrentUser,
  kind: "customer_release" | "customer_delete" | "customer_transfer",
  rows: { id: string; name: string }[],
  extra: { reason?: string; toUserId?: string; toUserName?: string },
) {
  const names = rows.slice(0, 3).map((r) => r.name).join("、") + (rows.length > 3 ? ` 等 ${rows.length} 个客户` : "");
  const title =
    kind === "customer_release"
      ? `把 ${names} 退回公海`
      : kind === "customer_delete"
        ? `删除 ${names}`
        : `把 ${names} 转给 ${extra.toUserName ?? ""}`;
  const db = tenantDb(user.tenantId);
  // 同一批客户已经在等审批的，不重复提交
  const dup = await db.approvalRequest.findFirst({ where: { kind, status: "PENDING", requesterId: user.id, title } });
  if (dup) return dup;
  const req = await db.approvalRequest.create({
    data: {
      tenantId: user.tenantId,
      kind,
      title,
      reason: extra.reason?.slice(0, 500) || null,
      payload: { ids: rows.map((r) => r.id), toUserId: extra.toUserId ?? null },
      requesterId: user.id,
      targetId: rows.length === 1 ? rows[0].id : null,
    },
  });
  await audit(user, { action: "submit", entity: "approval", entityId: req.id, entityName: APPROVAL_KINDS[kind], summary: `提交审批：${title}` });
  return req;
}

export const pendingApprovalCount = (user: CurrentUser) =>
  can(user, "approval.review") ? prisma.approvalRequest.count({ where: { tenantId: user.tenantId, status: "PENDING" } }) : Promise.resolve(0);

/** 审批：通过时执行；结果写一条提醒给申请人 */
export async function reviewApproval(reviewer: CurrentUser, id: string, approve: boolean, note: string): Promise<{ ok: boolean; message: string }> {
  const db = tenantDb(reviewer.tenantId);
  const req = await db.approvalRequest.findFirst({ where: { id } });
  if (!req) return { ok: false, message: "审批单不存在" };
  if (req.status !== "PENDING") return { ok: false, message: "这条审批已经处理过了" };
  // 抢占：防止两个人同时审批
  const { count } = await db.approvalRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: approve ? "APPROVED" : "REJECTED", reviewerId: reviewer.id, reviewNote: note.slice(0, 500) || null, reviewedAt: new Date() },
  });
  if (!count) return { ok: false, message: "这条审批已经处理过了" };

  const payload = (req.payload ?? {}) as { ids?: string[]; toUserId?: string | null; confirm?: boolean };
  const tail = `（${reviewer.name} 审批通过）`;
  let result = approve ? "已通过" : "已驳回";
  let link: string | null = null;

  if (req.kind === "quotation" || req.kind === "order") {
    const status = approve ? "APPROVED" : "REJECTED";
    if (req.kind === "quotation" && req.targetId) {
      const q = await db.quotation.findFirst({ where: { id: req.targetId } });
      if (q) {
        await db.quotation.updateMany({ where: { id: q.id }, data: { approval: status } });
        await logActivity({ tenantId: reviewer.tenantId, customerId: q.customerId, opportunityId: q.opportunityId, event: "quotation", content: `报价单 ${q.no} 折扣审批${approve ? "通过" : "被驳回"}${note ? `：${note}` : ""}`, userId: reviewer.id });
        link = `/quotations/${q.id}`;
      }
    }
    if (req.kind === "order" && req.targetId) {
      const o = await db.order.findFirst({ where: { id: req.targetId } });
      if (o) {
        const confirm = approve && payload.confirm && o.status === "DRAFT";
        await db.order.updateMany({ where: { id: o.id }, data: { approval: status, ...(confirm ? { status: "CONFIRMED" as const } : {}) } });
        await logActivity({ tenantId: reviewer.tenantId, customerId: o.customerId, opportunityId: o.opportunityId, event: "order", content: `订单 ${o.no} 折扣审批${approve ? "通过" : "被驳回"}${confirm ? "，已确认" : ""}${note ? `：${note}` : ""}`, userId: reviewer.id });
        link = `/orders/${o.id}`;
      }
    }
  } else if (approve) {
    const ids = payload.ids ?? [];
    if (req.kind === "customer_delete") {
      const rows = await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      if (rows.length) await deleteCustomers(reviewer, rows, tail);
      result = `已删除 ${rows.length} 个客户`;
    } else if (req.kind === "customer_release") {
      const rows = await privateRows(reviewer.tenantId, ids);
      if (rows.length) await releaseCustomers(reviewer, rows, req.reason || "手动放入公海", tail);
      result = `已放入公海 ${rows.length} 个客户`;
    } else if (req.kind === "customer_transfer") {
      const target = (await allMembers(reviewer.tenantId)).find((m) => m.id === payload.toUserId);
      if (!target) {
        await db.approvalRequest.updateMany({ where: { id }, data: { status: "PENDING", reviewerId: null, reviewedAt: null } });
        return { ok: false, message: "接收人已停用或不存在，没法执行，请驳回" };
      }
      const rows = await privateRows(reviewer.tenantId, ids);
      if (rows.length) await transferCustomers(reviewer, rows, target, tail);
      result = `已转移 ${rows.length} 个客户给 ${target.name}`;
    }
    link = ids.length === 1 ? `/customers/${ids[0]}` : "/customers";
  }

  await audit(reviewer, {
    action: approve ? "approve" : "reject",
    entity: "approval",
    entityId: req.id,
    entityName: APPROVAL_KINDS[req.kind] ?? req.kind,
    summary: `${approve ? "通过" : "驳回"}了审批：${req.title}${note ? `（${note}）` : ""}`,
  });
  if (req.requesterId !== reviewer.id) {
    await prisma.task
      .create({
        data: {
          tenantId: reviewer.tenantId,
          title: `审批${approve ? "通过" : "被驳回"}：${req.title}`.slice(0, 200),
          note: note || null,
          dueAt: new Date(),
          kind: "approval",
          link: link ?? "/approvals",
          ownerId: req.requesterId,
          createdById: reviewer.id,
        },
      })
      .catch(() => null);
  }
  return { ok: true, message: result };
}
