"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { CURRENCIES, STATUS_COLOR_NAMES } from "@/lib/crm";

async function guard() {
  const user = await requireUser();
  return can(user, "settings.business") ? user : null;
}
const DENIED: ActionState = { ok: false, message: "没有操作权限" };

function isUniqueError(e: unknown) {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
}

// ── 公海规则 ──

const poolSchema = z.object({
  poolRecycleDays: z.coerce.number().int("请输入整数").min(0).max(3650),
  poolDailyClaimLimit: z.coerce.number().int("请输入整数").min(0).max(10000),
  privateCustomerLimit: z.coerce.number().int("请输入整数").min(0).max(1000000),
});

export async function savePoolRulesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const parsed = poolSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  await prisma.tenant.update({ where: { id: user.tenantId }, data: parsed.data });
  revalidatePath("/settings/pool-rules");
  revalidatePath("/customers/pool");
  return { ok: true, message: "公海规则已保存" };
}

// ── 商机阶段 ──

const stageSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请填写阶段名称").max(30),
  probability: z.coerce.number().int().min(0, "0-100").max(100, "0-100"),
  kind: z.enum(["OPEN", "WON", "LOST"]),
});

export async function saveStageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const parsed = stageSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, ...data } = parsed.data;
  const db = tenantDb(user.tenantId);
  try {
    if (id) {
      await db.stage.updateMany({ where: { id }, data });
    } else {
      const max = await db.stage.aggregate({ _max: { sort: true } });
      await db.stage.create({ data: { ...data, tenantId: user.tenantId, sort: (max._max.sort ?? -1) + 1 } });
    }
  } catch (e) {
    if (isUniqueError(e)) return { ok: false, fieldErrors: { name: ["已有同名阶段"] } };
    throw e;
  }
  revalidatePath("/settings/stages");
  revalidatePath("/opportunities");
  return { ok: true, message: "阶段已保存" };
}

export async function deleteStageAction(id: string): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const db = tenantDb(user.tenantId);
  const used = await db.opportunity.count({ where: { stageId: id } });
  if (used) return { ok: false, message: `还有 ${used} 个商机在这个阶段，先把它们移到其他阶段` };
  const stage = await db.stage.findFirst({ where: { id } });
  if (!stage) return { ok: false, message: "阶段不存在" };
  if (stage.kind === "OPEN" && (await db.stage.count({ where: { kind: "OPEN" } })) <= 1) {
    return { ok: false, message: "至少要保留一个进行中的阶段" };
  }
  await db.stage.deleteMany({ where: { id } });
  revalidatePath("/settings/stages");
  revalidatePath("/opportunities");
  return { ok: true, message: "阶段已删除" };
}

/** 上移 / 下移 */
export async function moveStageAction(id: string, dir: -1 | 1): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const db = tenantDb(user.tenantId);
  const list = await db.stage.findMany({ orderBy: { sort: "asc" }, select: { id: true } });
  const i = list.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };
  [list[i], list[j]] = [list[j], list[i]];
  await prisma.$transaction(
    list.map((s, sort) => prisma.stage.updateMany({ where: { tenantId: user.tenantId, id: s.id }, data: { sort } })),
  );
  revalidatePath("/settings/stages");
  revalidatePath("/opportunities");
  return { ok: true };
}

// ── 客户状态 ──

const statusSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请填写状态名称").max(20),
  color: z.enum(STATUS_COLOR_NAMES as [string, ...string[]]),
});

export async function saveStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const parsed = statusSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, ...data } = parsed.data;
  const db = tenantDb(user.tenantId);
  try {
    if (id) await db.customerStatus.updateMany({ where: { id }, data });
    else {
      const max = await db.customerStatus.aggregate({ _max: { sort: true } });
      await db.customerStatus.create({ data: { ...data, tenantId: user.tenantId, sort: (max._max.sort ?? -1) + 1 } });
    }
  } catch (e) {
    if (isUniqueError(e)) return { ok: false, fieldErrors: { name: ["已有同名状态"] } };
    throw e;
  }
  revalidatePath("/settings/fields");
  revalidatePath("/customers", "layout");
  return { ok: true, message: "状态已保存" };
}

export async function deleteStatusAction(id: string): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const db = tenantDb(user.tenantId);
  const used = await db.customer.count({ where: { statusId: id } });
  await db.customerStatus.deleteMany({ where: { id } });
  revalidatePath("/settings/fields");
  revalidatePath("/customers", "layout");
  return { ok: true, message: used ? `已删除，${used} 个客户的状态被清空` : "状态已删除" };
}

// ── 客户分组（最多 3 级） ──

const groupSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请填写分组名称").max(30),
  parentId: z.string().optional().transform((v) => v || null),
});

export async function saveGroupAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const parsed = groupSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, name, parentId } = parsed.data;
  const db = tenantDb(user.tenantId);
  const all = await db.customerGroup.findMany({ select: { id: true, parentId: true } });
  const parentOf = new Map(all.map((g) => [g.id, g.parentId]));
  if (parentId && !parentOf.has(parentId)) return { ok: false, message: "上级分组不存在" };

  // 上级的层级（根为 1）
  let depth = 0;
  for (let p: string | null | undefined = parentId; p; p = parentOf.get(p)) {
    if (p === id) return { ok: false, fieldErrors: { parentId: ["不能把分组挂到自己或下级下面"] } };
    depth++;
  }
  // 自己子树的高度
  const height = (gid: string): number => 1 + Math.max(0, ...all.filter((g) => g.parentId === gid).map((g) => height(g.id)));
  const own = id ? height(id) : 1;
  if (depth + own > 3) return { ok: false, fieldErrors: { parentId: ["分组最多 3 级"] } };

  if (id) await db.customerGroup.updateMany({ where: { id }, data: { name, parentId } });
  else {
    const max = await db.customerGroup.aggregate({ _max: { sort: true } });
    await db.customerGroup.create({ data: { name, parentId, tenantId: user.tenantId, sort: (max._max.sort ?? -1) + 1 } });
  }
  revalidatePath("/settings/fields");
  revalidatePath("/customers", "layout");
  return { ok: true, message: "分组已保存" };
}

export async function deleteGroupAction(id: string): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const db = tenantDb(user.tenantId);
  if (await db.customerGroup.count({ where: { parentId: id } })) return { ok: false, message: "先删除或移走下级分组" };
  const used = await db.customer.count({ where: { groupId: id } });
  await db.customerGroup.deleteMany({ where: { id } });
  revalidatePath("/settings/fields");
  revalidatePath("/customers", "layout");
  return { ok: true, message: used ? `已删除，${used} 个客户变为未分组` : "分组已删除" };
}

// ── 单据设置 ──

const docOpt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

const docSchema = z.object({
  docCompanyName: docOpt(200),
  docAddress: docOpt(500),
  docPhone: docOpt(100),
  docEmail: docOpt(200),
  docWebsite: docOpt(200),
  docBankInfo: docOpt(2000),
  docQuotationTerms: docOpt(5000),
  quotationValidDays: z.coerce.number().int("请输入整数").min(0).max(365),
});

export async function saveDocSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const parsed = docSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  await prisma.tenant.update({ where: { id: user.tenantId }, data: parsed.data });
  revalidatePath("/settings/documents");
  return { ok: true, message: "单据设置已保存" };
}

export async function saveRatesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const fieldErrors: Record<string, string[]> = {};
  const rates: [string, number][] = [];
  for (const c of CURRENCIES) {
    if (c === "CNY") continue;
    const raw = String(fd.get(c) ?? "").trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0 || n > 100000) fieldErrors[c] = ["请输入大于 0 的汇率"];
    else rates.push([c, n]);
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  await prisma.$transaction(
    [["CNY", 1] as [string, number], ...rates].map(([currency, rate]) =>
      prisma.exchangeRate.upsert({
        where: { tenantId_currency: { tenantId: user.tenantId, currency } },
        create: { tenantId: user.tenantId, currency, rate },
        update: { rate },
      }),
    ),
  );
  revalidatePath("/settings/documents");
  return { ok: true, message: "汇率已保存，之后新开或保存的单据按新汇率折算" };
}
