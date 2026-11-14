"use server";

import { tenantDb } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { visitView } from "@/server/share-track";
import type { VisitView } from "@/lib/share-visit";

/** 客户动态里「客户打开了…」的冒泡：这个链接的每次访问（地点、设备、停留、时间轴） */
export async function shareVisitsAction(customerId: string, refKey: string): Promise<VisitView[] | null> {
  const user = await requireUser();
  const found = await getCustomerForUser(user, customerId);
  if (!found?.access.view) return null;
  const db = tenantDb(user.tenantId);
  const own = await db.activity.findFirst({ where: { customerId, refKey, event: "share_view" }, select: { id: true } });
  if (!own) return null;
  const rows = await db.shareVisit.findMany({ where: { refKey }, orderBy: { startedAt: "desc" }, take: 50 });
  return rows.map(visitView);
}
