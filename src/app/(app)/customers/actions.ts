"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { allMembers, scopeMembers, scopeOwnerIds } from "@/server/scope";
import {
  claimedToday,
  duplicateMessage,
  findDuplicates,
  getCustomerForUser,
  logActivity,
  type DuplicateHit,
} from "@/server/customers";
import { moveToPoolQuery, refreshPoolDue } from "@/server/pool";

export type { DuplicateHit };
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { dayRange, extractDomain, normalizeCompanyName, parseLocalInput } from "@/lib/crm";
import type { Permission } from "@/lib/permissions";

const opt = z.string().trim().max(500).optional().transform((v) => v || null);

function revalidateCustomers(id?: string) {
  revalidatePath("/customers", "layout");
  if (id) revalidatePath(`/customers/${id}`);
  revalidatePath("/dashboard");
}

function denied(message = "没有操作权限"): ActionState {
  return { ok: false, message };
}

// ── 查重 ──

/** 新建客户时实时查重 */
export async function checkDuplicateAction(input: {
  name?: string;
  website?: string;
  email?: string;
  excludeId?: string;
}): Promise<DuplicateHit[]> {
  const user = await requireUser();
  return findDuplicates(user, input, input.excludeId);
}

// ── 新建 / 编辑 ──

const customerSchema = z.object({
  name: z.string().trim().min(2, "客户名称至少 2 个字").max(200),
  country: opt,
  website: opt,
  address: opt,
  source: opt,
  customerType: opt,
  mainProducts: opt,
  annualVolume: opt,
  remark: z.string().trim().max(5000).optional().transform((v) => v || null),
  statusId: opt,
  groupId: opt,
  star: z.coerce.number().int().min(0).max(5).default(0),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      [...new Set((v ?? "").split(/[,，;；]/).map((t) => t.trim()).filter(Boolean))].slice(0, 20),
    ),
});

const contactSchema = z.object({
  contactName: opt,
  contactTitle: opt,
  contactEmail: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .pipe(z.email({ message: "邮箱格式不正确" }).nullable()),
  contactPhone: opt,
  contactWhatsapp: opt,
});

async function validRefs(user: CurrentUser, statusId: string | null, groupId: string | null) {
  const db = tenantDb(user.tenantId);
  const [s, g] = await Promise.all([
    statusId ? db.customerStatus.findFirst({ where: { id: statusId } }) : true,
    groupId ? db.customerGroup.findFirst({ where: { id: groupId } }) : true,
  ]);
  return !!s && !!g;
}

async function privateLimitReached(user: CurrentUser, ownerId: string, adding: number) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  if (!tenant.privateCustomerLimit) return null;
  const owned = await prisma.customer.count({ where: { tenantId: user.tenantId, ownerId } });
  return owned + adding > tenant.privateCustomerLimit ? tenant.privateCustomerLimit : null;
}

export async function createCustomerAction(_p: ActionState, fd: FormData): Promise<ActionState & { id?: string }> {
  const user = await requireUser();
  if (!can(user, "customer.create")) return denied();
  const raw = Object.fromEntries(fd);
  const parsed = customerSchema.safeParse(raw);
  const parsedContact = contactSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  if (!parsedContact.success) return fieldErrorsOf(parsedContact.error);
  const data = parsed.data;
  const c = parsedContact.data;
  if (!(await validRefs(user, data.statusId, data.groupId))) return denied("状态或分组不存在");

  const dup = await findDuplicates(user, { name: data.name, website: data.website, email: c.contactEmail });
  if (dup.length) return { ok: false, message: duplicateMessage(dup[0]) };

  const limit = await privateLimitReached(user, user.id, 1);
  if (limit) return denied(`私海客户已达上限（${limit} 个），请先把不跟进的客户放回公海`);

  const now = new Date();
  const customer = await prisma.customer.create({
    data: {
      ...data,
      tenantId: user.tenantId,
      nameKey: normalizeCompanyName(data.name),
      domain: extractDomain(data.website) ?? extractDomain(c.contactEmail),
      ownerId: user.id,
      assignedAt: now,
      createdById: user.id,
      contacts:
        c.contactName || c.contactEmail
          ? {
              create: {
                tenantId: user.tenantId,
                name: c.contactName ?? c.contactEmail!.split("@")[0],
                title: c.contactTitle,
                email: c.contactEmail,
                phone: c.contactPhone,
                whatsapp: c.contactWhatsapp,
                isPrimary: true,
              },
            }
          : undefined,
    },
  });
  await logActivity({ tenantId: user.tenantId, customerId: customer.id, event: "created", content: "创建了客户", userId: user.id });
  await refreshPoolDue(user.tenantId, [customer.id]);
  revalidateCustomers();
  return { ok: true, message: "客户已创建", id: customer.id };
}

export async function updateCustomerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(fd.get("id") ?? "");
  const found = await getCustomerForUser(user, id);
  if (!found?.access.edit) return denied();
  const parsed = customerSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const data = parsed.data;
  if (!(await validRefs(user, data.statusId, data.groupId))) return denied("状态或分组不存在");

  const dup = await findDuplicates(user, { name: data.name, website: data.website }, id);
  if (dup.length) return { ok: false, message: duplicateMessage(dup[0]) };

  await tenantDb(user.tenantId).customer.updateMany({
    where: { id },
    data: {
      ...data,
      nameKey: normalizeCompanyName(data.name),
      domain: extractDomain(data.website) ?? found.customer.domain,
    },
  });
  revalidateCustomers(id);
  return { ok: true, message: "已保存" };
}

export async function setStarAction(id: string, star: number): Promise<ActionState> {
  const user = await requireUser();
  const found = await getCustomerForUser(user, id);
  if (!found?.access.edit) return denied();
  await tenantDb(user.tenantId).customer.updateMany({ where: { id }, data: { star: Math.max(0, Math.min(5, star)) } });
  revalidateCustomers(id);
  return { ok: true };
}

export async function deleteCustomerAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "customer.delete")) return denied();
  const found = await getCustomerForUser(user, id);
  if (!found || (!found.access.edit && !found.access.inPool)) return denied();
  await tenantDb(user.tenantId).customer.deleteMany({ where: { id } });
  revalidateCustomers();
  return { ok: true, message: "客户已删除" };
}

// ── 批量：转移 / 放入公海 / 领取 / 分配 ──

/** 过滤出当前用户能操作的私海客户 id */
async function ownedIds(user: CurrentUser, ids: string[]) {
  const scope = await scopeOwnerIds(user);
  const rows = await tenantDb(user.tenantId).customer.findMany({
    where: { id: { in: ids }, ...(scope ? { ownerId: { in: scope } } : { ownerId: { not: null } }) },
    select: { id: true, name: true, owner: { select: { name: true } } },
  });
  return rows;
}

export async function transferCustomersAction(ids: string[], toUserId: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "customer.transfer")) return denied();
  const members = await scopeMembers(user);
  const target = members.find((m) => m.id === toUserId);
  if (!target) return denied("只能转移给你数据范围内的在用成员");
  const rows = await ownedIds(user, ids);
  if (!rows.length) return denied("没有可转移的客户");
  const limit = await privateLimitReached(user, toUserId, rows.length);
  if (limit) return denied(`${target.name} 的私海客户会超过上限（${limit} 个）`);

  const now = new Date();
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE "Customer" SET "prevOwnerId" = "ownerId", "ownerId" = ${toUserId}, "assignedAt" = ${now}, "updatedAt" = ${now}
      WHERE "tenantId" = ${user.tenantId} AND "id" = ANY(${rows.map((r) => r.id)}) AND "ownerId" IS DISTINCT FROM ${toUserId}`,
    prisma.activity.createMany({
      data: rows.map((r) => ({
        tenantId: user.tenantId,
        customerId: r.id,
        type: "SYSTEM" as const,
        event: "transferred",
        content: `负责人由 ${r.owner?.name ?? "—"} 转为 ${target.name}`,
        userId: user.id,
      })),
    }),
  ]);
  await refreshPoolDue(user.tenantId, rows.map((r) => r.id));
  revalidateCustomers();
  return { ok: true, message: `已转移 ${rows.length} 个客户给 ${target.name}` };
}

export async function releaseCustomersAction(ids: string[], reason: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "customer.edit")) return denied();
  const rows = await ownedIds(user, ids);
  if (!rows.length) return denied("没有可放入公海的客户");
  const why = reason.trim().slice(0, 200) || "手动放入公海";
  const now = new Date();
  await prisma.$transaction([
    moveToPoolQuery(
      user.tenantId,
      rows.map((r) => r.id),
      why,
      now,
    ),
    prisma.activity.createMany({
      data: rows.map((r) => ({
        tenantId: user.tenantId,
        customerId: r.id,
        type: "SYSTEM" as const,
        event: "released",
        content: `放入公海：${why}`,
        userId: user.id,
      })),
    }),
  ]);
  revalidateCustomers();
  return { ok: true, message: `已放入公海 ${rows.length} 个客户` };
}

async function takeFromPool(
  user: CurrentUser,
  ids: string[],
  ownerId: string,
  event: "claimed" | "assigned",
  content: string,
) {
  const now = new Date();
  // 用 ownerId: null 作条件，防止两人同时领取同一个客户
  return prisma.$transaction(async (tx) => {
    const free = await tx.customer.findMany({
      where: { tenantId: user.tenantId, id: { in: ids }, ownerId: null },
      select: { id: true },
    });
    const freeIds = free.map((f) => f.id);
    const { count } = await tx.customer.updateMany({
      where: { tenantId: user.tenantId, id: { in: freeIds }, ownerId: null },
      data: { ownerId, assignedAt: now, poolEnteredAt: null, poolReason: null },
    });
    if (count !== freeIds.length) throw new Error("部分客户已被他人领取，请刷新后重试");
    await tx.activity.createMany({
      data: freeIds.map((id) => ({ tenantId: user.tenantId, customerId: id, type: "SYSTEM" as const, event, content, userId: user.id })),
    });
    return count;
  });
}

export async function claimCustomersAction(ids: string[]): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "pool.claim")) return denied();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  if (tenant.poolDailyClaimLimit) {
    const used = await claimedToday(user.id, user.tenantId, dayRange(user.timezone).start);
    const left = tenant.poolDailyClaimLimit - used;
    if (left <= 0) return denied(`今天的领取次数已用完（每天最多 ${tenant.poolDailyClaimLimit} 个）`);
    if (ids.length > left) return denied(`今天还能领取 ${left} 个客户`);
  }
  const limit = await privateLimitReached(user, user.id, ids.length);
  if (limit) return denied(`私海客户会超过上限（${limit} 个）`);
  try {
    const n = await takeFromPool(user, ids, user.id, "claimed", "从公海领取了客户");
    await refreshPoolDue(user.tenantId, ids);
    revalidateCustomers();
    return { ok: true, message: `已领取 ${n} 个客户` };
  } catch (e) {
    return denied((e as Error).message);
  }
}

export async function assignPoolCustomersAction(ids: string[], toUserId: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "pool.assign")) return denied();
  const target = (await allMembers(user.tenantId)).find((m) => m.id === toUserId);
  if (!target) return denied("成员不存在或已停用");
  const limit = await privateLimitReached(user, toUserId, ids.length);
  if (limit) return denied(`${target.name} 的私海客户会超过上限（${limit} 个）`);
  try {
    const n = await takeFromPool(user, ids, toUserId, "assigned", `把公海客户分配给 ${target.name}`);
    await refreshPoolDue(user.tenantId, ids);
    revalidateCustomers();
    return { ok: true, message: `已分配 ${n} 个客户给 ${target.name}` };
  } catch (e) {
    return denied((e as Error).message);
  }
}

// ── 跟进记录 ──

const followSchema = z.object({
  customerId: z.string().min(1),
  opportunityId: opt,
  method: z.enum(["EMAIL", "PHONE", "WHATSAPP", "WECHAT", "MEETING", "VISIT", "OTHER"]),
  content: z.string().trim().min(1, "请填写跟进内容").max(5000),
  nextFollowAt: opt,
  createTask: z.string().optional(),
});

export async function addFollowUpAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = followSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { customerId, opportunityId, method, content, nextFollowAt, createTask } = parsed.data;
  const found = await getCustomerForUser(user, customerId);
  if (!found?.access.edit) return denied("只有负责人（或其上级）可以写跟进");

  const next = parseLocalInput(nextFollowAt, user.timezone);
  const now = new Date();
  await prisma.$transaction([
    prisma.activity.create({
      data: { tenantId: user.tenantId, customerId, opportunityId, type: "FOLLOW_UP", method, content, userId: user.id },
    }),
    prisma.customer.updateMany({
      where: { tenantId: user.tenantId, id: customerId },
      data: { lastContactAt: now, lastFollowAt: now, ...(next ? { nextFollowAt: next } : {}) },
    }),
    ...(next && createTask
      ? [
          prisma.task.create({
            data: {
              tenantId: user.tenantId,
              title: `跟进 ${found.customer.name}`,
              dueAt: next,
              customerId,
              opportunityId,
              ownerId: found.customer.ownerId ?? user.id,
              createdById: user.id,
            },
          }),
        ]
      : []),
  ]);
  await refreshPoolDue(user.tenantId, [customerId]);
  revalidateCustomers(customerId);
  revalidatePath("/schedule");
  return { ok: true, message: "已记录跟进" };
}

// ── 联系人 ──

const contactFormSchema = z.object({
  id: z.string().optional(),
  customerId: z.string().min(1),
  name: z.string().trim().min(1, "请填写姓名").max(100),
  title: opt,
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .pipe(z.email({ message: "邮箱格式不正确" }).nullable()),
  phone: opt,
  whatsapp: opt,
  remark: opt,
  isPrimary: z.string().optional().transform((v) => v === "on"),
});

export async function saveContactAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = contactFormSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, customerId, ...data } = parsed.data;
  const found = await getCustomerForUser(user, customerId);
  if (!found?.access.edit) return denied();
  const db = tenantDb(user.tenantId);

  if (data.email) {
    const clash = await db.contact.findFirst({
      where: { email: { equals: data.email, mode: "insensitive" }, NOT: { customerId } },
      include: { customer: { select: { name: true } } },
    });
    if (clash) return { ok: false, fieldErrors: { email: [`该邮箱已是客户「${clash.customer.name}」的联系人`] } };
  }

  await prisma.$transaction(async (tx) => {
    if (data.isPrimary) {
      await tx.contact.updateMany({ where: { tenantId: user.tenantId, customerId }, data: { isPrimary: false } });
    }
    if (id) {
      await tx.contact.updateMany({ where: { tenantId: user.tenantId, id, customerId }, data });
    } else {
      await tx.contact.create({ data: { ...data, tenantId: user.tenantId, customerId } });
    }
    // 客户还没有域名时，用联系人的企业邮箱补上
    if (!found.customer.domain && extractDomain(data.email)) {
      await tx.customer.updateMany({
        where: { tenantId: user.tenantId, id: customerId },
        data: { domain: extractDomain(data.email) },
      });
    }
  });
  revalidateCustomers(customerId);
  return { ok: true, message: id ? "联系人已更新" : "已添加联系人" };
}

export async function deleteContactAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const contact = await tenantDb(user.tenantId).contact.findFirst({ where: { id } });
  if (!contact) return denied("联系人不存在");
  const found = await getCustomerForUser(user, contact.customerId);
  if (!found?.access.edit) return denied();
  await tenantDb(user.tenantId).contact.deleteMany({ where: { id } });
  revalidateCustomers(contact.customerId);
  return { ok: true, message: "联系人已删除" };
}

export async function hasPermission(p: Permission) {
  const user = await requireUser();
  return can(user, p);
}
