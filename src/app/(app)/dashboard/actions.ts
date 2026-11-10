"use server";

import { revalidatePath } from "next/cache";
import { prisma, tenantDb } from "@/server/db";
import { requireUser } from "@/server/auth";
import { MAX_WORKSPACES, OVERVIEW_ID, sanitizeLayout } from "@/lib/canvas";
import type { ActionState } from "@/lib/action";

type WsResult = ActionState & { id?: string };

const cleanName = (name: string) => name.trim().slice(0, 30);

/** 保存情景：带 id 覆盖已有的，不带 id 新建。home=true 时同时设为默认 */
export async function saveWorkspaceAction(input: { id?: string; name?: string; layout: unknown; home?: boolean }): Promise<WsResult> {
  const user = await requireUser();
  const db = tenantDb(user.tenantId);
  const layout = sanitizeLayout(input.layout);
  if (!layout.length) return { ok: false, message: "画布上至少要有一个组件" };

  let id = input.id;
  if (id) {
    const r = await db.workspace.updateMany({
      where: { id, userId: user.id },
      data: { layout, ...(input.name !== undefined && cleanName(input.name) ? { name: cleanName(input.name) } : {}) },
    });
    if (!r.count) return { ok: false, message: "情景不存在或已删除" };
  } else {
    const name = cleanName(input.name ?? "");
    if (!name) return { ok: false, message: "请填写情景名称" };
    if ((await db.workspace.count({ where: { userId: user.id } })) >= MAX_WORKSPACES) {
      return { ok: false, message: `最多保存 ${MAX_WORKSPACES} 个情景，先删掉不用的` };
    }
    id = (await db.workspace.create({ data: { tenantId: user.tenantId, userId: user.id, name, layout } })).id;
  }
  if (input.home) await prisma.user.update({ where: { id: user.id }, data: { dashboardHome: id } });
  return { ok: true, id, message: input.home ? "已保存并设为默认情景" : "情景已保存" };
}

export async function renameWorkspaceAction(id: string, name: string): Promise<ActionState> {
  const user = await requireUser();
  const n = cleanName(name);
  if (!n) return { ok: false, message: "请填写情景名称" };
  const r = await tenantDb(user.tenantId).workspace.updateMany({ where: { id, userId: user.id }, data: { name: n } });
  return r.count ? { ok: true, message: "已重命名" } : { ok: false, message: "情景不存在或已删除" };
}

export async function deleteWorkspaceAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const r = await tenantDb(user.tenantId).workspace.deleteMany({ where: { id, userId: user.id } });
  if (!r.count) return { ok: false, message: "情景不存在或已删除" };
  // 删掉的是默认情景：默认改回概览
  await prisma.user.updateMany({ where: { id: user.id, dashboardHome: id }, data: { dashboardHome: OVERVIEW_ID } });
  return { ok: true, message: "情景已删除" };
}

/** 设为默认情景（id = "overview" 表示系统概览） */
export async function setHomeWorkspaceAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (id !== OVERVIEW_ID) {
    const exists = await tenantDb(user.tenantId).workspace.count({ where: { id, userId: user.id } });
    if (!exists) return { ok: false, message: "情景不存在或已删除" };
  }
  await prisma.user.update({ where: { id: user.id }, data: { dashboardHome: id } });
  return { ok: true, message: "已设为默认情景" };
}

/** 「保存为默认情景」提示：不再提示 */
export async function dismissSavePromptAction(): Promise<ActionState> {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { dashboardPromptOff: true } });
  return { ok: true, message: "之后不再提示" };
}

/** 收起「上手清单」 */
export async function dismissOnboardingAction(): Promise<ActionState> {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { onboardingOff: true } });
  revalidatePath("/dashboard");
  return { ok: true, message: "上手清单已收起" };
}
