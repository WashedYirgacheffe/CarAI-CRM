"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { failStuckResearch, runResearch, startResearch } from "@/server/ai-research";
import type { ActionState } from "@/lib/action";
import { extractDomain, normalizeCompanyName } from "@/lib/crm";
import { SUGGEST_FIELDS, type ResearchReport, type ResearchStep, type SuggestField } from "@/lib/ai-research";

function touch(customerId: string) {
  revalidatePath(`/customers/${customerId}`);
}

/** 客户页「AI 穿透」：建记录后马上返回，调查在后台跑（1～3 分钟），页面轮询进度 */
export async function startCustomerResearchAction(customerId: string): Promise<ActionState & { id?: string }> {
  const user = await requireUser();
  if (!can(user, "ai.use")) return { ok: false, message: "没有使用 AI 的权限" };
  const found = await getCustomerForUser(user, customerId);
  if (!found?.access.view) return { ok: false, message: "客户不存在" };
  const r = await startResearch({ tenantId: user.tenantId, userId: user.id, customerId });
  if ("error" in r) return { ok: false, message: r.error };
  if (!r.reused) after(() => runResearch(r.id));
  return { ok: true, id: r.id, message: r.reused ? "已经在查了" : "开始穿透，大约 1～3 分钟" };
}

export type ResearchProgress = { status: string; steps: ResearchStep[]; error: string | null };

export async function researchProgressAction(id: string): Promise<ResearchProgress | null> {
  const user = await requireUser();
  await failStuckResearch(user.tenantId, id);
  const row = await tenantDb(user.tenantId).aiResearch.findFirst({
    where: { id },
    select: { status: true, steps: true, error: true, customerId: true },
  });
  if (!row?.customerId || !(await getCustomerForUser(user, row.customerId))) return null;
  return { status: row.status, steps: (row.steps as ResearchStep[]) ?? [], error: row.error };
}

async function editableReport(id: string) {
  const user = await requireUser();
  const row = await tenantDb(user.tenantId).aiResearch.findFirst({ where: { id, status: "done" } });
  if (!row?.customerId || !row.report) return null;
  const found = await getCustomerForUser(user, row.customerId);
  if (!found?.access.edit) return null;
  return { user, row, found, report: row.report as ResearchReport, customerId: row.customerId };
}

async function markApplied(tenantId: string, id: string, report: ResearchReport, key: string) {
  await prisma.aiResearch.updateMany({
    where: { tenantId, id },
    data: { report: { ...report, applied: [...new Set([...(report.applied ?? []), key])] } },
  });
}

/** 把报告里建议的资料写到客户上（用户点了「采用」才写） */
export async function applyResearchFieldAction(id: string, field: SuggestField): Promise<ActionState> {
  const ctx = await editableReport(id);
  if (!ctx) return { ok: false, message: "没有操作权限" };
  const s = field in SUGGEST_FIELDS ? ctx.report.suggestions?.[field] : undefined;
  if (!s?.value) return { ok: false, message: "这条建议不存在" };
  const value = s.value.slice(0, 500);
  const data: Record<string, string | null> = { [field]: value };
  if (field === "website") data.domain = extractDomain(value) ?? ctx.found.customer.domain;
  await tenantDb(ctx.user.tenantId).customer.updateMany({ where: { id: ctx.customerId }, data });
  await markApplied(ctx.user.tenantId, id, ctx.report, field);
  touch(ctx.customerId);
  return { ok: true, message: `已更新${SUGGEST_FIELDS[field]}` };
}

/** 报告里的关键人物加成联系人 */
export async function addResearchContactAction(id: string, name: string): Promise<ActionState> {
  const ctx = await editableReport(id);
  if (!ctx) return { ok: false, message: "没有操作权限" };
  const p = ctx.report.people?.find((x) => x.name === name);
  if (!p) return { ok: false, message: "这个人不在报告里" };
  const db = tenantDb(ctx.user.tenantId);
  const key = normalizeCompanyName(p.name);
  const existing = await db.contact.findMany({ where: { customerId: ctx.customerId }, select: { name: true, email: true } });
  if (existing.some((c) => normalizeCompanyName(c.name) === key || (p.email && c.email?.toLowerCase() === p.email))) {
    await markApplied(ctx.user.tenantId, id, ctx.report, `person:${p.name}`);
    touch(ctx.customerId);
    return { ok: true, message: "已经是联系人了" };
  }
  const clash = p.email
    ? await db.contact.findFirst({
        where: { email: { equals: p.email, mode: "insensitive" }, NOT: { customerId: ctx.customerId } },
        select: { id: true },
      })
    : null;
  await db.contact.create({
    data: {
      tenantId: ctx.user.tenantId,
      customerId: ctx.customerId,
      name: p.name.slice(0, 100),
      title: p.title?.slice(0, 100) || null,
      email: clash ? null : p.email || null,
      remark: `AI 穿透找到（${p.source}）`.slice(0, 500),
    },
  });
  await markApplied(ctx.user.tenantId, id, ctx.report, `person:${p.name}`);
  touch(ctx.customerId);
  return { ok: true, message: `已添加联系人 ${p.name}` };
}
