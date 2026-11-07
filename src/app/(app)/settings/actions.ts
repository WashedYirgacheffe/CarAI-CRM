"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import {
  can,
  hashPassword,
  requireUser,
  revokeUserSessions,
  verifyPassword,
  type CurrentUser,
} from "@/server/auth";
import { isPermission, type Permission } from "@/lib/permissions";
import { fieldErrorsOf, type ActionState } from "@/lib/action";

async function guard(permission: Permission): Promise<CurrentUser | ActionState> {
  const user = await requireUser();
  if (!can(user, permission)) return { ok: false, message: "没有操作权限" };
  return user;
}
function denied(x: CurrentUser | ActionState): x is ActionState {
  return !("tenantId" in x);
}

// ---------- 企业信息 ----------

const companySchema = z.object({
  name: z.string().trim().min(2, "企业名称至少 2 个字").max(100),
  defaultCurrency: z.enum(["USD", "EUR", "CNY", "GBP", "JPY", "AUD", "CAD", "HKD"]),
  timezone: z.string().min(1),
});

export async function updateCompanyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard("settings.company");
  if (denied(user)) return user;
  const parsed = companySchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  await prisma.tenant.update({ where: { id: user.tenantId }, data: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true, message: "已保存" };
}

// ---------- 部门 ----------

const deptSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请填写部门名称").max(50),
  parentId: z.string().min(1, "请选择上级部门"),
});

export async function saveDepartmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard("settings.org");
  if (denied(user)) return user;
  const parsed = deptSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, name, parentId } = parsed.data;
  const db = tenantDb(user.tenantId);

  if (id) {
    const root = await db.department.findFirst({ where: { id, parentId: null } });
    if (root) {
      // 根部门只能改名
      await db.department.updateMany({ where: { id }, data: { name } });
      revalidatePath("/settings/departments");
      return { ok: true, message: "已更新" };
    }
  }

  const parent = await db.department.findFirst({ where: { id: parentId } });
  if (!parent) return { ok: false, fieldErrors: { parentId: ["上级部门不存在"] } };

  if (id) {
    const all = await db.department.findMany({ select: { id: true, parentId: true } });
    const current = all.find((d) => d.id === id);
    if (!current) return { ok: false, message: "部门不存在" };
    // 防止把部门挂到自己或自己的下级下面
    let cursor: string | null = parentId;
    while (cursor) {
      if (cursor === id) return { ok: false, fieldErrors: { parentId: ["不能选择自己或下级部门"] } };
      cursor = all.find((d) => d.id === cursor)?.parentId ?? null;
    }
    await db.department.updateMany({ where: { id }, data: { name, parentId } });
  } else {
    await db.department.create({ data: { name, parentId, tenantId: user.tenantId } });
  }
  revalidatePath("/settings/departments");
  return { ok: true, message: id ? "已更新" : "已创建" };
}

export async function deleteDepartmentAction(id: string): Promise<ActionState> {
  const user = await guard("settings.org");
  if (denied(user)) return user;
  const db = tenantDb(user.tenantId);
  const dept = await db.department.findFirst({
    where: { id },
    include: { _count: { select: { children: true, users: true } } },
  });
  if (!dept) return { ok: false, message: "部门不存在" };
  if (!dept.parentId) return { ok: false, message: "根部门不能删除" };
  if (dept._count.children) return { ok: false, message: "请先删除或移走下级部门" };
  if (dept._count.users) return { ok: false, message: "部门下还有成员，请先调整成员部门" };
  await db.department.deleteMany({ where: { id } });
  revalidatePath("/settings/departments");
  return { ok: true, message: "已删除" };
}

// ---------- 成员 ----------

const memberSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请填写姓名").max(50),
  email: z.string().trim().toLowerCase().pipe(z.email({ message: "请输入有效的邮箱地址" })),
  phone: z.string().trim().max(30).optional(),
  departmentId: z.string().min(1, "请选择部门"),
  roleId: z.string().min(1, "请选择角色"),
  password: z.string().optional(),
});

export async function saveMemberAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard("settings.org");
  if (denied(user)) return user;
  const parsed = memberSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, name, email, phone, departmentId, roleId, password } = parsed.data;
  const db = tenantDb(user.tenantId);

  const [dept, role] = await Promise.all([
    db.department.findFirst({ where: { id: departmentId } }),
    db.role.findFirst({ where: { id: roleId } }),
  ]);
  if (!dept) return { ok: false, fieldErrors: { departmentId: ["部门不存在"] } };
  if (!role) return { ok: false, fieldErrors: { roleId: ["角色不存在"] } };

  const emailOwner = await prisma.user.findUnique({ where: { email } });
  if (emailOwner && emailOwner.id !== id) {
    return { ok: false, fieldErrors: { email: ["该邮箱已被使用"] } };
  }

  if (id) {
    const target = await db.user.findFirst({ where: { id } });
    if (!target) return { ok: false, message: "成员不存在" };
    if (target.isOwner && target.roleId !== roleId) {
      return { ok: false, fieldErrors: { roleId: ["主账号的角色不能修改"] } };
    }
    const data: Record<string, unknown> = { name, email, phone: phone || null, departmentId, roleId };
    if (password) {
      if (password.length < 8) return { ok: false, fieldErrors: { password: ["密码至少 8 位"] } };
      data.passwordHash = await hashPassword(password);
    }
    await db.user.updateMany({ where: { id }, data });
    if (password) await revokeUserSessions(id);
  } else {
    if (!password || password.length < 8) {
      return { ok: false, fieldErrors: { password: ["初始密码至少 8 位"] } };
    }
    await db.user.create({
      data: {
        tenantId: user.tenantId,
        name,
        email,
        phone: phone || null,
        departmentId,
        roleId,
        passwordHash: await hashPassword(password),
      },
    });
  }
  revalidatePath("/settings/members");
  return { ok: true, message: id ? "已更新" : "已添加成员" };
}

export async function setMemberStatusAction(id: string, active: boolean): Promise<ActionState> {
  const user = await guard("settings.org");
  if (denied(user)) return user;
  const db = tenantDb(user.tenantId);
  const target = await db.user.findFirst({ where: { id } });
  if (!target) return { ok: false, message: "成员不存在" };
  if (target.isOwner) return { ok: false, message: "主账号不能停用" };
  if (target.id === user.id) return { ok: false, message: "不能停用自己" };
  await db.user.updateMany({ where: { id }, data: { status: active ? "ACTIVE" : "DISABLED" } });
  if (!active) await revokeUserSessions(id);
  revalidatePath("/settings/members");
  return { ok: true, message: active ? "已启用" : "已停用，该成员已被强制下线" };
}

// ---------- 角色 ----------

const roleSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请填写角色名称").max(30),
  description: z.string().trim().max(100).optional(),
  dataScope: z.enum(["SELF", "DEPARTMENT", "ALL"]),
});

export async function saveRoleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard("settings.role");
  if (denied(user)) return user;
  const parsed = roleSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, name, description, dataScope } = parsed.data;
  const permissions = fd.getAll("permissions").map(String).filter(isPermission);
  const db = tenantDb(user.tenantId);

  const dup = await db.role.findFirst({ where: { name, NOT: id ? { id } : undefined } });
  if (dup) return { ok: false, fieldErrors: { name: ["角色名称已存在"] } };

  if (id) {
    const role = await db.role.findFirst({ where: { id } });
    if (!role) return { ok: false, message: "角色不存在" };
    if (role.systemKey === "admin") return { ok: false, message: "管理员角色不能修改" };
    await db.role.updateMany({
      where: { id },
      data: { name, description: description || null, dataScope, permissions },
    });
  } else {
    await db.role.create({
      data: { tenantId: user.tenantId, name, description: description || null, dataScope, permissions },
    });
  }
  revalidatePath("/settings/roles");
  revalidatePath("/", "layout");
  return { ok: true, message: id ? "已保存" : "已创建角色" };
}

export async function deleteRoleAction(id: string): Promise<ActionState> {
  const user = await guard("settings.role");
  if (denied(user)) return user;
  const db = tenantDb(user.tenantId);
  const role = await db.role.findFirst({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role) return { ok: false, message: "角色不存在" };
  if (role.systemKey) return { ok: false, message: "内置角色不能删除" };
  if (role._count.users) return { ok: false, message: `还有 ${role._count.users} 位成员在用这个角色` };
  await db.role.deleteMany({ where: { id } });
  revalidatePath("/settings/roles");
  return { ok: true, message: "已删除" };
}

// ---------- 个人资料 ----------

const profileSchema = z.object({
  name: z.string().trim().min(1, "请填写姓名").max(50),
  phone: z.string().trim().max(30).optional(),
});

export async function updateProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  await prisma.user.update({
    where: { id: user.id },
    data: { name: parsed.data.name, phone: parsed.data.phone || null },
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "已保存" };
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "请输入当前密码"),
    next: z.string().min(8, "新密码至少 8 位").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "两次输入的密码不一致" });

export async function changePasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(row.passwordHash, parsed.data.current))) {
    return { ok: false, fieldErrors: { current: ["当前密码不正确"] } };
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.next) },
  });
  return { ok: true, message: "密码已修改" };
}
