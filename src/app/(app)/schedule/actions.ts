"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantDb } from "@/server/db";
import { requireUser, type CurrentUser } from "@/server/auth";
import { inScope } from "@/server/scope";
import { getCustomerForUser } from "@/server/customers";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { parseLocalInput } from "@/lib/crm";
import { REMINDER_KINDS, TIME_PRESETS, presetDate, type TimePreset } from "@/lib/reminders";

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
  kind: z
    .string()
    .optional()
    .transform((v) => (v && v in REMINDER_KINDS ? v : null)),
  note: z.string().max(1000).optional().transform((v) => v?.trim() || null),
  /** 只允许站内路径 */
  link: z
    .string()
    .max(300)
    .optional()
    .transform((v) => (v && /^\/[^/\\]/.test(v) ? v : null)),
});

export async function saveTaskAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, title, customerId, kind, note, link } = parsed.data;
  const dueAt = parseLocalInput(parsed.data.dueAt, user.timezone);
  if (!dueAt) return { ok: false, fieldErrors: { dueAt: ["时间格式不正确"] } };
  if (customerId && !(await getCustomerForUser(user, customerId))?.access.edit) return denied("无权给该客户建日程");

  const db = tenantDb(user.tenantId);
  if (id) {
    const task = await ownTask(user, id);
    if (!task) return denied();
    await db.task.updateMany({ where: { id }, data: { title, dueAt, kind, note } });
    revalidate(task.customerId);
    return { ok: true, message: "日程已更新" };
  }
  await db.task.create({
    data: { tenantId: user.tenantId, title, dueAt, customerId, kind, note, link, ownerId: user.id, createdById: user.id },
  });
  revalidate(customerId);
  return { ok: true, message: kind ? "提醒已设置，到时间会在右上角铃铛提醒你" : "日程已添加" };
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

/** 推迟提醒：到点了但还在等（比如工厂还没回），一键往后推 */
export async function snoozeTaskAction(id: string, preset: TimePreset): Promise<ActionState> {
  const user = await requireUser();
  const task = await ownTask(user, id);
  if (!task) return denied();
  if (!TIME_PRESETS.some((p) => p.key === preset)) return { ok: false, message: "时间不正确" };
  await tenantDb(user.tenantId).task.updateMany({
    where: { id },
    data: { dueAt: presetDate(preset, user.timezone), done: false, doneAt: null, snoozeCount: { increment: 1 } },
  });
  revalidate(task.customerId);
  return { ok: true, message: `已推迟到${TIME_PRESETS.find((p) => p.key === preset)!.label}` };
}
