"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantDb } from "@/server/db";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { canEditMemory, isMemoryAdmin, remember, visibleWhere } from "@/server/ai-memory";

const PATH = "/settings/memory";
const NONE: ActionState = { ok: false, message: "没有这条记忆，或没有权限" };

/** 读一条能改的记忆 */
async function editable(user: CurrentUser, id: string, status: string[] = ["active"]) {
  const m = await tenantDb(user.tenantId).aiMemory.findFirst({ where: { id, status: { in: status }, AND: [await visibleWhere(user)] } });
  return m && (await canEditMemory(user, m)) ? m : null;
}

/** 对话里的「撤销」：这次记下的去掉；它取代了旧的，旧的回来 */
export async function undoMemoryAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const m = await editable(user, id, ["active", "proposed"]);
  if (!m) return NONE;
  const db = tenantDb(user.tenantId);
  await db.aiMemory.updateMany({ where: { id }, data: { status: "archived", archivedAt: new Date() } });
  await db.aiMemory.updateMany({
    where: { supersededById: id, status: "superseded" },
    data: { status: "active", supersededById: null, archivedAt: null },
  });
  await db.aiMemory.updateMany({ where: { disputed: true, scope: m.scope, userId: m.userId, customerId: m.customerId }, data: { disputed: false } });
  revalidatePath(PATH);
  return { ok: true, message: "已撤销" };
}

export async function forgetMemoryAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const m = await editable(user, id, ["active", "proposed"]);
  if (!m) return NONE;
  await tenantDb(user.tenantId).aiMemory.updateMany({ where: { id }, data: { status: "archived", archivedAt: new Date() } });
  revalidatePath(PATH);
  return { ok: true, message: "已忘掉，可以在「已忘掉」里恢复" };
}

export async function restoreMemoryAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const m = await editable(user, id, ["archived"]);
  if (!m) return NONE;
  // 恢复的同时更新时间，免得第二天又被当成 30 天没用过归档
  await tenantDb(user.tenantId).aiMemory.updateMany({ where: { id }, data: { status: "active", archivedAt: null, updatedAt: new Date() } });
  revalidatePath(PATH);
  return { ok: true, message: "已恢复" };
}

/** 确认：AI 的发现由人担保，变成可信的 */
export async function confirmMemoryAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const m = await editable(user, id);
  if (!m) return NONE;
  const db = tenantDb(user.tenantId);
  await db.aiMemory.updateMany({ where: { id }, data: { trusted: true, confirmedById: user.id, disputed: false, createdByKind: "user" } });
  // 有争议的另一条：确认了这条就把那条放下
  if (m.disputed)
    await db.aiMemory.updateMany({
      where: {
        id: { not: id },
        disputed: true,
        status: "active",
        scope: m.scope,
        userId: m.scope === "personal" ? m.userId : undefined,
        customerId: m.customerId,
      },
      data: { status: "superseded", supersededById: id, archivedAt: new Date(), disputed: false },
    });
  revalidatePath(PATH);
  return { ok: true, message: "已确认" };
}

export async function pinMemoryAction(id: string, pinned: boolean): Promise<ActionState> {
  const user = await requireUser();
  const m = await editable(user, id);
  if (!m) return NONE;
  await tenantDb(user.tenantId).aiMemory.updateMany({ where: { id }, data: { pinned } });
  revalidatePath(PATH);
  return { ok: true, message: pinned ? "已置顶，每次对话都会带上" : "已取消置顶" };
}

/** 团队记忆的提议：管理员通过 / 不通过 */
export async function reviewMemoryAction(id: string, approve: boolean): Promise<ActionState> {
  const user = await requireUser();
  if (!isMemoryAdmin(user)) return { ok: false, message: "只有管理员能确认团队记忆" };
  const db = tenantDb(user.tenantId);
  const r = await db.aiMemory.updateMany({
    where: { id, scope: "team", status: "proposed" },
    data: approve ? { status: "active", confirmedById: user.id } : { status: "archived", archivedAt: new Date() },
  });
  if (!r.count) return NONE;
  revalidatePath(PATH);
  return { ok: true, message: approve ? "已生效，全公司的 AI 都会照着做" : "已驳回" };
}

const editSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["fact", "preference", "rule", "decision", "howto"]),
  scope: z.enum(["personal", "team"]).optional(),
  title: z.string().trim().min(1, "写一句话").max(80, "不超过 80 字"),
  content: z.string().trim().max(800, "不超过 800 字").optional(),
});

/** 新增或编辑：人写的就是可信的；编辑会新建一版，旧的留作历史 */
export async function saveMemoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "ai.use")) return { ok: false, message: "没有使用 AI 的权限" };
  const parsed = editSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, kind, title } = parsed.data;
  const content = parsed.data.content || title;
  const ctx = { user, outside: false, userText: `${title}\n${content}` };
  let r;
  if (id) {
    const old = await editable(user, id);
    if (!old) return NONE;
    r = await remember(ctx, {
      kind,
      title,
      content,
      scope: old.scope,
      customerId: old.customerId ?? undefined,
      basis: "user_said",
      replaces: old.id,
    });
    if ("ok" in r) {
      const db = tenantDb(user.tenantId);
      if (old.pinned) await db.aiMemory.updateMany({ where: { id: r.id }, data: { pinned: true } });
      // 换了种类（比如事实改成规则）时不会自动取代，这里补上
      if (r.id !== old.id)
        await db.aiMemory.updateMany({
          where: { id: old.id, status: "active" },
          data: { status: "superseded", supersededById: r.id, archivedAt: new Date(), disputed: false },
        });
    }
  } else {
    r = await remember(ctx, { kind, title, content, scope: parsed.data.scope === "team" ? "team" : "me", basis: "user_said" });
  }
  if ("error" in r) return { ok: false, message: r.error };
  revalidatePath(PATH);
  return { ok: true, message: id ? "已保存" : r.note };
}
