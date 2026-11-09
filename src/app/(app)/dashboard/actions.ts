"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { DASHBOARD_CARDS } from "@/lib/dashboard";
import type { ActionState } from "@/lib/action";

/** 保存工作台卡片（顺序即显示顺序）。传 null 恢复默认 */
export async function saveDashboardCardsAction(keys: string[] | null): Promise<ActionState> {
  const user = await requireUser();
  const valid = new Set<string>(DASHBOARD_CARDS.map((c) => c.key));
  const cards = keys ? [...new Set(keys)].filter((k) => valid.has(k)) : [];
  if (keys && !cards.length) return { ok: false, message: "至少保留一张卡片" };
  await prisma.user.update({ where: { id: user.id }, data: { dashboardCards: cards } });
  revalidatePath("/dashboard");
  return { ok: true, message: keys ? "工作台已更新" : "已恢复默认布局" };
}
