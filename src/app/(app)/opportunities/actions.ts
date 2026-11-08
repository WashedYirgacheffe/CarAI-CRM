"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { inScope } from "@/server/scope";
import { getCustomerForUser } from "@/server/customers";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { CURRENCIES, parseLocalInput } from "@/lib/crm";

const opt = z.string().trim().max(2000).optional().transform((v) => v || null);

function denied(message = "没有操作权限"): ActionState {
  return { ok: false, message };
}

function revalidate(customerId?: string | null) {
  revalidatePath("/opportunities");
  revalidatePath("/dashboard");
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

/** 当前用户能编辑的商机（负责人在数据范围内 + 有 opportunity.edit） */
async function editableOpportunity(user: CurrentUser, id: string) {
  if (!can(user, "opportunity.edit")) return null;
  const opp = await tenantDb(user.tenantId).opportunity.findFirst({ where: { id }, include: { stage: true } });
  if (!opp || !(await inScope(user, opp.ownerId))) return null;
  return opp;
}

const schema = z.object({
  id: z.string().optional(),
  customerId: z.string().min(1, "请选择客户"),
  name: z.string().trim().min(1, "请填写商机名称").max(200),
  amount: z.coerce.number({ message: "金额格式不正确" }).min(0, "金额不能为负").max(1e12).default(0),
  currency: z.enum(CURRENCIES),
  stageId: z.string().min(1, "请选择阶段"),
  expectedCloseAt: opt,
  remark: opt,
});

export async function saveOpportunityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, customerId, expectedCloseAt, ...data } = parsed.data;
  const db = tenantDb(user.tenantId);

  const stage = await db.stage.findFirst({ where: { id: data.stageId } });
  if (!stage) return denied("阶段不存在");
  const closeAt = parseLocalInput(expectedCloseAt, user.timezone);
  const now = new Date();
  const closed = stage.kind !== "OPEN";

  if (id) {
    const opp = await editableOpportunity(user, id);
    if (!opp) return denied();
    const stageChanged = opp.stageId !== stage.id;
    await prisma.$transaction([
      prisma.opportunity.updateMany({
        where: { tenantId: user.tenantId, id },
        data: {
          ...data,
          expectedCloseAt: closeAt,
          ...(stageChanged ? { stageChangedAt: now, closedAt: closed ? now : null } : {}),
        },
      }),
      ...(stageChanged
        ? [
            prisma.activity.create({
              data: {
                tenantId: user.tenantId,
                customerId: opp.customerId,
                opportunityId: id,
                type: "SYSTEM",
                event: "stage",
                content: `商机「${data.name}」阶段：${opp.stage.name} → ${stage.name}`,
                userId: user.id,
              },
            }),
          ]
        : []),
    ]);
    revalidate(opp.customerId);
    return { ok: true, message: "商机已保存" };
  }

  if (!can(user, "opportunity.create")) return denied();
  const found = await getCustomerForUser(user, customerId);
  if (!found?.access.edit) return denied("只能给自己（或下属）负责的客户建商机");
  const created = await prisma.opportunity.create({
    data: {
      ...data,
      tenantId: user.tenantId,
      customerId,
      expectedCloseAt: closeAt,
      ownerId: found.customer.ownerId ?? user.id,
      stageChangedAt: now,
      closedAt: closed ? now : null,
      createdById: user.id,
    },
  });
  await prisma.activity.create({
    data: {
      tenantId: user.tenantId,
      customerId,
      opportunityId: created.id,
      type: "SYSTEM",
      event: "opportunity",
      content: `新建商机「${data.name}」（${stage.name}）`,
      userId: user.id,
    },
  });
  revalidate(customerId);
  return { ok: true, message: "商机已创建" };
}

export async function moveOpportunityAction(id: string, stageId: string): Promise<ActionState> {
  const user = await requireUser();
  const opp = await editableOpportunity(user, id);
  if (!opp) return denied();
  if (opp.stageId === stageId) return { ok: true };
  const stage = await tenantDb(user.tenantId).stage.findFirst({ where: { id: stageId } });
  if (!stage) return denied("阶段不存在");
  const now = new Date();
  await prisma.$transaction([
    prisma.opportunity.updateMany({
      where: { tenantId: user.tenantId, id },
      data: { stageId, stageChangedAt: now, closedAt: stage.kind === "OPEN" ? null : now },
    }),
    prisma.activity.create({
      data: {
        tenantId: user.tenantId,
        customerId: opp.customerId,
        opportunityId: id,
        type: "SYSTEM",
        event: "stage",
        content: `商机「${opp.name}」阶段：${opp.stage.name} → ${stage.name}`,
        userId: user.id,
      },
    }),
  ]);
  revalidate(opp.customerId);
  return { ok: true, message: `已移到「${stage.name}」` };
}

export async function deleteOpportunityAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "opportunity.delete")) return denied();
  const opp = await tenantDb(user.tenantId).opportunity.findFirst({ where: { id } });
  if (!opp || !(await inScope(user, opp.ownerId))) return denied();
  await tenantDb(user.tenantId).opportunity.deleteMany({ where: { id } });
  revalidate(opp.customerId);
  return { ok: true, message: "商机已删除" };
}
