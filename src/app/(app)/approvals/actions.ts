"use server";

import { revalidatePath } from "next/cache";
import { can, requireUser } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { reviewApproval } from "@/server/approvals";
import type { ActionState } from "@/lib/action";

export async function reviewApprovalAction(id: string, approve: boolean, note: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "approval.review")) return { ok: false, message: "没有审批权限" };
  const r = await reviewApproval(user, id, approve, note.trim());
  revalidatePath("/approvals");
  revalidatePath("/customers", "layout");
  revalidatePath("/quotations", "layout");
  revalidatePath("/orders", "layout");
  return r;
}

/** 申请人撤回自己还没处理的申请（报价单 / 订单撤回后回到「无需审批」，需要重新保存才会再提交） */
export async function withdrawApprovalAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const db = tenantDb(user.tenantId);
  const req = await db.approvalRequest.findFirst({ where: { id, requesterId: user.id, status: "PENDING" } });
  if (!req) return { ok: false, message: "申请不存在或已处理" };
  await db.approvalRequest.deleteMany({ where: { id } });
  if (req.kind === "quotation" && req.targetId) await db.quotation.updateMany({ where: { id: req.targetId, approval: "PENDING" }, data: { approval: "REJECTED" } });
  if (req.kind === "order" && req.targetId) await db.order.updateMany({ where: { id: req.targetId, approval: "PENDING" }, data: { approval: "REJECTED" } });
  revalidatePath("/approvals");
  return { ok: true, message: "已撤回" };
}
