"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantDb } from "@/server/db";
import { requireUser, type CurrentUser } from "@/server/auth";
import { inScope } from "@/server/scope";
import { getCustomerForUser } from "@/server/customers";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { parseLocalInput } from "@/lib/crm";

function denied(message = "没有操作权限"): ActionState {
  return { ok: false, message };
}

function revalidate(customerId?: string | null) {
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

async function ownTask(user: CurrentUser, id: string) {
  const task = await tenantDb(user.tenantId).task.findFirst({ where: { id } });
  if (!task || !(await inScope(user, task.ownerId))) return null;
  return task;
}

const schema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, "请填写内容").max(200),
  dueAt: z.string().min(1, "请选择时间"),
  customerId: z.string().optional().transform((v) => v || null),
});

export async function saveTaskAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, title, customerId } = parsed.data;
  const dueAt = parseLocalInput(parsed.data.dueAt, user.timezone);
  if (!dueAt) return { ok: false, fieldErrors: { dueAt: ["时间格式不正确"] } };
  if (customerId && !(await getCustomerForUser(user, customerId))?.access.edit) return denied("无权给该客户建日程");

  const db = tenantDb(user.tenantId);
  if (id) {
    const task = await ownTask(user, id);
    if (!task) return denied();
    await db.task.updateMany({ where: { id }, data: { title, dueAt } });
    revalidate(task.customerId);
    return { ok: true, message: "日程已更新" };
  }
  await db.task.create({
    data: { tenantId: user.tenantId, title, dueAt, customerId, ownerId: user.id, createdById: user.id },
  });
  revalidate(customerId);
  return { ok: true, message: "日程已添加" };
}

export async function toggleTaskAction(id: string, done: boolean): Promise<ActionState> {
  const user = await requireUser();
  const task = await ownTask(user, id);
  if (!task) return denied();
  await tenantDb(user.tenantId).task.updateMany({ where: { id }, data: { done, doneAt: done ? new Date() : null } });
  revalidate(task.customerId);
  return { ok: true, message: done ? "已完成" : "已标记为未完成" };
}

export async function deleteTaskAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const task = await ownTask(user, id);
  if (!task) return denied();
  await tenantDb(user.tenantId).task.deleteMany({ where: { id } });
  revalidate(task.customerId);
  return { ok: true, message: "日程已删除" };
}
