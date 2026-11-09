"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { allMembers, inScope } from "@/server/scope";
import { findDuplicates, getCustomerForUser } from "@/server/customers";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { CURRENCIES, LEAD_INVALID_REASONS, LEAD_OPEN_STATUSES, LEAD_STATUSES, extractDomain, normalizeCompanyName } from "@/lib/crm";

const opt = z.string().trim().max(500).optional().transform((v) => v || null);

function denied(message = "没有操作权限"): ActionState {
  return { ok: false, message };
}

function revalidate() {
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

/** 能处理的线索：自己数据范围内的，或者还没分配的 */
async function workableLead(user: CurrentUser, id: string) {
  const lead = await tenantDb(user.tenantId).lead.findFirst({ where: { id } });
  if (!lead) return null;
  if (lead.ownerId ? await inScope(user, lead.ownerId) : true) return lead;
  return null;
}

const schema = z
  .object({
    id: z.string().optional(),
    companyName: opt,
    contactName: opt,
    email: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || null)
      .pipe(z.email({ message: "邮箱格式不正确" }).nullable()),
    phone: opt,
    whatsapp: opt,
    country: opt,
    source: opt,
    products: opt,
    inquiry: z.string().trim().max(10000).optional().transform((v) => v || null),
    unassigned: z.string().optional(),
  })
  .refine((d) => d.companyName || d.contactName || d.email || d.whatsapp || d.phone, {
    message: "公司名、联系人、邮箱、电话至少填一项",
    path: ["companyName"],
  });

export async function saveLeadAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, unassigned, ...data } = parsed.data;
  const db = tenantDb(user.tenantId);

  if (id) {
    if (!can(user, "lead.edit")) return denied();
    const lead = await workableLead(user, id);
    if (!lead) return denied();
    await db.lead.updateMany({ where: { id }, data });
    revalidate();
    return { ok: true, message: "线索已保存" };
  }

  if (!can(user, "lead.create")) return denied();
  // 有分配权限的人可以把线索放进「待分配」
  const toPool = !!unassigned && can(user, "lead.assign");
  await db.lead.create({
    data: {
      ...data,
      tenantId: user.tenantId,
      ownerId: toPool ? null : user.id,
      assignedAt: toPool ? null : new Date(),
      createdById: user.id,
    },
  });
  revalidate();
  return { ok: true, message: "线索已创建" };
}

export async function claimLeadAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "lead.edit")) return denied();
  const { count } = await prisma.lead.updateMany({
    where: { tenantId: user.tenantId, id, ownerId: null },
    data: { ownerId: user.id, assignedAt: new Date() },
  });
  if (!count) return denied("线索已被他人领取");
  revalidate();
  return { ok: true, message: "已领取线索" };
}

export async function assignLeadsAction(ids: string[], toUserId: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "lead.assign")) return denied();
  const target = (await allMembers(user.tenantId)).find((m) => m.id === toUserId);
  if (!target) return denied("成员不存在或已停用");
  const { count } = await prisma.lead.updateMany({
    where: { tenantId: user.tenantId, id: { in: ids }, status: { not: "CONVERTED" } },
    data: { ownerId: toUserId, assignedAt: new Date() },
  });
  revalidate();
  return { ok: true, message: `已分配 ${count} 条线索给 ${target.name}` };
}

const LEAD_STATUS_LABEL: Record<string, string> = Object.fromEntries(LEAD_STATUSES.map((s) => [s.value, s.label]));

export async function setLeadStatusAction(
  id: string,
  status: "NEW" | "QUALIFYING" | "CONTACTED" | "INVALID",
  invalid?: { reason?: string; note?: string },
): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "lead.edit")) return denied();
  if (![...LEAD_OPEN_STATUSES, "INVALID"].includes(status)) return denied("状态不正确");
  const lead = await workableLead(user, id);
  if (!lead || lead.status === "CONVERTED") return denied();
  const isInvalid = status === "INVALID";
  const reason = invalid?.reason?.trim();
  if (isInvalid && !(LEAD_INVALID_REASONS as readonly string[]).includes(reason ?? "")) return denied("请选择无效原因");
  await tenantDb(user.tenantId).lead.updateMany({
    where: { id },
    data: {
      status,
      invalidReason: isInvalid ? reason : null,
      invalidNote: isInvalid ? invalid?.note?.trim().slice(0, 500) || null : null,
      invalidAt: isInvalid ? new Date() : null,
    },
  });
  revalidate();
  return { ok: true, message: isInvalid ? "已标记为无效" : `已改为「${LEAD_STATUS_LABEL[status]}」` };
}

export async function deleteLeadAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "lead.delete")) return denied();
  const lead = await workableLead(user, id);
  if (!lead) return denied();
  await tenantDb(user.tenantId).lead.deleteMany({ where: { id } });
  revalidate();
  return { ok: true, message: "线索已删除" };
}

// ── 转为客户 ──

const convertSchema = z.object({
  id: z.string().min(1),
  customerName: z.string().trim().min(2, "客户名称至少 2 个字").max(200),
  withOpportunity: z.string().optional(),
  oppName: opt,
  amount: z.coerce.number().min(0).max(1e12).default(0),
  currency: z.enum(CURRENCIES).default("USD"),
});

export async function convertLeadAction(_p: ActionState, fd: FormData): Promise<ActionState & { customerId?: string }> {
  const user = await requireUser();
  if (!can(user, "lead.edit")) return denied();
  const parsed = convertSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, customerName, withOpportunity, oppName, amount, currency } = parsed.data;
  const lead = await workableLead(user, id);
  if (!lead) return denied();
  if (lead.status === "CONVERTED") return denied("这条线索已经转过客户了");

  const now = new Date();
  // 查重：已有客户时并入老客户（自己的或公海里的），否则新建
  const hits = await findDuplicates(user, { name: customerName, email: lead.email });
  let customerId: string;
  let merged = false;
  const hit = hits[0];
  if (hit) {
    if (hit.inPool) {
      if (!can(user, "pool.claim")) return denied(`客户「${hit.name}」在公海中，你没有领取权限`);
      const { count } = await prisma.customer.updateMany({
        where: { tenantId: user.tenantId, id: hit.id, ownerId: null },
        data: { ownerId: user.id, assignedAt: now, poolEnteredAt: null, poolReason: null },
      });
      if (!count) return denied("客户刚被他人领取，请刷新后重试");
    } else {
      const found = await getCustomerForUser(user, hit.id);
      if (!found?.access.edit) return denied(`客户「${hit.name}」已存在（${hit.reason}），负责人：${hit.ownerName ?? "—"}`);
    }
    customerId = hit.id;
    merged = true;
  } else {
    if (!can(user, "customer.create")) return denied("你没有新建客户的权限");
    // 线索转来的客户默认「询盘客户」状态（被改名或删掉时取第一个状态）
    const sdb = tenantDb(user.tenantId);
    const status =
      (await sdb.customerStatus.findFirst({ where: { name: "询盘客户" } })) ??
      (await sdb.customerStatus.findFirst({ orderBy: { sort: "asc" } }));
    const c = await prisma.customer.create({
      data: {
        tenantId: user.tenantId,
        name: customerName,
        nameKey: normalizeCompanyName(customerName),
        domain: extractDomain(lead.email),
        country: lead.country,
        source: lead.source,
        mainProducts: lead.products,
        statusId: status?.id ?? null,
        ownerId: user.id,
        assignedAt: now,
        createdById: user.id,
      },
    });
    customerId = c.id;
  }

  // 联系人：同邮箱已存在就不重复建
  const contactName = lead.contactName ?? lead.email?.split("@")[0] ?? null;
  const hasContact = lead.email
    ? await tenantDb(user.tenantId).contact.findFirst({ where: { email: { equals: lead.email, mode: "insensitive" } } })
    : null;
  const firstStage = withOpportunity
    ? await tenantDb(user.tenantId).stage.findFirst({ where: { kind: "OPEN" }, orderBy: { sort: "asc" } })
    : null;

  await prisma.$transaction(async (tx) => {
    if (contactName && !hasContact) {
      const primary = await tx.contact.count({ where: { tenantId: user.tenantId, customerId, isPrimary: true } });
      await tx.contact.create({
        data: {
          tenantId: user.tenantId,
          customerId,
          name: contactName,
          email: lead.email,
          phone: lead.phone,
          whatsapp: lead.whatsapp,
          isPrimary: primary === 0,
        },
      });
    }
    await tx.lead.updateMany({
      where: { tenantId: user.tenantId, id },
      data: { status: "CONVERTED", customerId, ownerId: lead.ownerId ?? user.id },
    });
    await tx.activity.create({
      data: {
        tenantId: user.tenantId,
        customerId,
        type: "SYSTEM",
        event: "lead_converted",
        content: `由线索转入${lead.source ? `（来源：${lead.source}）` : ""}${lead.inquiry ? `：${lead.inquiry.slice(0, 500)}` : ""}`,
        userId: user.id,
      },
    });
    await tx.customer.updateMany({ where: { tenantId: user.tenantId, id: customerId }, data: { lastContactAt: now } });
    if (firstStage && can(user, "opportunity.create")) {
      const opp = await tx.opportunity.create({
        data: {
          tenantId: user.tenantId,
          customerId,
          name: oppName || `${customerName} 询盘`,
          amount,
          currency,
          stageId: firstStage.id,
          ownerId: user.id,
          stageChangedAt: now,
          createdById: user.id,
        },
      });
      await tx.activity.create({
        data: {
          tenantId: user.tenantId,
          customerId,
          opportunityId: opp.id,
          type: "SYSTEM",
          event: "opportunity",
          content: `新建商机「${opp.name}」（${firstStage.name}）`,
          userId: user.id,
        },
      });
    }
  });

  revalidate();
  revalidatePath("/customers", "layout");
  revalidatePath("/opportunities");
  return { ok: true, message: merged ? "已并入已有客户" : "已转为客户", customerId };
}
