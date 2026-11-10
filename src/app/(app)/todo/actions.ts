"use server";

import { revalidatePath } from "next/cache";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import type { ActionState } from "@/lib/action";
import { TIME_PRESETS, presetDate, type TimePreset } from "@/lib/reminders";
import { clip } from "@/server/ai";

/**
 * 待办里的「延后」：邮件 / WhatsApp 本身没有到期时间，就替它建一条带跳转链接的提醒，
 * 同时把它移出待办（邮件标已处理，会话标已读）；到点提醒会带着链接回来
 */
export async function snoozeTodoAction(kind: "mail" | "wa", id: string, preset: TimePreset): Promise<ActionState> {
  const user = await requireUser();
  const label = TIME_PRESETS.find((p) => p.key === preset)?.label;
  if (!label) return { ok: false, message: "时间不正确" };
  const db = tenantDb(user.tenantId);
  const dueAt = presetDate(preset, user.timezone);

  if (kind === "mail") {
    if (!can(user, "mail.use")) return { ok: false, message: "没有操作权限" };
    const m = await db.mailMessage.findFirst({ where: { id, account: { userId: user.id } } });
    if (!m) return { ok: false, message: "邮件不存在" };
    await prisma.$transaction([
      prisma.task.create({
        data: {
          tenantId: user.tenantId,
          ownerId: user.id,
          createdById: user.id,
          title: `回复邮件：${clip(m.subject || "(无主题)", 60)}`,
          note: `来自 ${m.fromName || m.fromAddr}`,
          link: `/mail?id=${m.id}`,
          customerId: m.customerId,
          dueAt,
        },
      }),
      prisma.mailMessage.update({ where: { id: m.id }, data: { doneAt: new Date(), seen: true } }),
    ]);
    revalidatePath("/mail", "layout");
  } else {
    if (!can(user, "whatsapp.use")) return { ok: false, message: "没有操作权限" };
    const c = await db.waChat.findFirst({ where: { id, account: { userId: user.id } } });
    if (!c) return { ok: false, message: "会话不存在" };
    await prisma.$transaction([
      prisma.task.create({
        data: {
          tenantId: user.tenantId,
          ownerId: user.id,
          createdById: user.id,
          title: `回复 WhatsApp：${c.name || c.phone || "会话"}`,
          note: c.lastText ? clip(c.lastText, 80) : null,
          link: `/whatsapp?chat=${c.id}`,
          customerId: c.customerId,
          dueAt,
        },
      }),
      prisma.waChat.update({ where: { id: c.id }, data: { unread: 0 } }),
    ]);
  }
  revalidatePath("/todo");
  revalidatePath("/schedule");
  return { ok: true, message: `好的，${label}再提醒你` };
}
