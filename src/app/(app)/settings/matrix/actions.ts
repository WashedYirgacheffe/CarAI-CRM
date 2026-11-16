"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import type { ActionState } from "@/lib/action";
import { cloudConfigured } from "@/server/matrix-cloud";

async function guard() {
  const user = await requireUser();
  return can(user, "matrix.manage") ? user : null;
}
const DENIED: ActionState = { ok: false, message: "没有操作权限" };

export async function setMatrixCloudAction(enabled: boolean): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  if (enabled && !cloudConfigured()) return { ok: false, message: "服务器还没有配置云端运行器，暂时不能打开" };
  await prisma.tenant.update({ where: { id: user.tenantId }, data: { matrixCloudEnabled: enabled } });
  revalidatePath("/settings/matrix");
  revalidatePath("/social/matrix");
  return { ok: true, message: enabled ? "已打开云端运行器" : "已关闭云端运行器，没有归属电脑的账号将暂停执行" };
}

/** 移除设备：令牌立即失效；归属它的账号清空归属（浏览器环境还留在那台电脑上，换地方运行需要重新登录） */
export async function revokeDeviceAction(id: string): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const d = await prisma.matrixDevice.findFirst({ where: { id, tenantId: user.tenantId, revokedAt: null }, select: { id: true, name: true } });
  if (!d) return { ok: false, message: "设备不存在" };
  // 先结束排队中的任务（要靠账号的归属找到它们），再清空归属
  const [, , accounts] = await prisma.$transaction([
    prisma.matrixJob.updateMany({
      where: { tenantId: user.tenantId, status: "queued", account: { deviceId: d.id } },
      data: { status: "failed", error: "所在电脑已被移除", finishedAt: new Date() },
    }),
    prisma.matrixDevice.update({ where: { id: d.id }, data: { revokedAt: new Date() } }),
    prisma.matrixAccount.updateMany({ where: { tenantId: user.tenantId, deviceId: d.id }, data: { deviceId: null } }),
  ]);
  revalidatePath("/settings/matrix");
  revalidatePath("/social/matrix");
  return { ok: true, message: accounts.count ? `已移除「${d.name}」，${accounts.count} 个账号需要在新的位置重新登录` : `已移除「${d.name}」` };
}
