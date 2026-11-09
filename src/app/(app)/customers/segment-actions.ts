"use server";

import { revalidatePath } from "next/cache";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { refreshPoolDue } from "@/server/pool";
import { pickSegmentFilters } from "@/lib/segments";
import type { ActionState } from "@/lib/action";

/** 把当前筛选条件保存为客群 */
export async function saveSegmentAction(input: { name: string; shared: boolean; filters: Record<string, unknown> }): Promise<ActionState> {
  const user = await requirePermission("customer.view");
  const name = input.name.trim().slice(0, 30);
  if (!name) return { ok: false, message: "请填写客群名称" };
  const filters = pickSegmentFilters(input.filters);
  if (!Object.keys(filters).length) return { ok: false, message: "请先设置筛选条件" };
  const shared = input.shared && can(user, "settings.business");
  const db = tenantDb(user.tenantId);
  const last = await db.customerSegment.findFirst({ orderBy: { sort: "desc" }, select: { sort: true } });
  await db.customerSegment.create({
    data: { tenantId: user.tenantId, name, filters, shared, sort: (last?.sort ?? 0) + 1, createdById: user.id },
  });
  revalidatePath("/customers");
  return { ok: true, message: `已保存客群「${name}」` };
}

export async function deleteSegmentAction(id: string): Promise<ActionState> {
  const user = await requirePermission("customer.view");
  const db = tenantDb(user.tenantId);
  const seg = await db.customerSegment.findFirst({ where: { id } });
  if (!seg) return { ok: false, message: "客群不存在" };
  if (seg.createdById !== user.id && !can(user, "settings.business")) return { ok: false, message: "只能删除自己建的客群" };
  await db.customerSegment.deleteMany({ where: { id } });
  if (seg.poolDays !== null) await refreshPoolDue(user.tenantId);
  revalidatePath("/customers");
  revalidatePath("/settings/pool-rules");
  return { ok: true, message: "客群已删除" };
}
