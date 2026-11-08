"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/server/db";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/server/auth";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { ensureTenantDefaults } from "@/server/defaults";
import { fieldErrorsOf, type ActionState } from "@/lib/action";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "请输入有效的邮箱地址" }));

const registerSchema = z.object({
  companyName: z.string().trim().min(2, "企业名称至少 2 个字").max(100),
  name: z.string().trim().min(1, "请填写你的姓名").max(50),
  email: emailSchema,
  password: z.string().min(8, "密码至少 8 位").max(128),
});

/** 注册企业：创建租户 + 内置角色 + 根部门 + 主账号，然后直接登录 */
export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { companyName, name, email, password } = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    return { ok: false, fieldErrors: { email: ["该邮箱已注册，请直接登录"] } };
  }

  const passwordHash = await hashPassword(password);

  const owner = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: companyName } });
    const roles = await tx.role.createManyAndReturn({
      data: SYSTEM_ROLES.map((r) => ({ ...r, tenantId: tenant.id })),
    });
    const adminRole = roles.find((r) => r.systemKey === "admin")!;
    await ensureTenantDefaults(tx, tenant.id);
    const root = await tx.department.create({
      data: { tenantId: tenant.id, name: companyName },
    });
    return tx.user.create({
      data: {
        tenantId: tenant.id,
        email,
        name,
        passwordHash,
        isOwner: true,
        roleId: adminRole.id,
        departmentId: root.id,
      },
    });
  });

  await createSession(owner.id);
  redirect("/dashboard");
}

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "请输入密码"),
  next: z.string().optional(),
});

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { email, password, next } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  // 无论账号不存在还是密码错误，都返回同样的提示，避免暴露账号是否存在
  const valid = user ? await verifyPassword(user.passwordHash, password) : false;
  if (!user || !valid) {
    return { ok: false, message: "邮箱或密码不正确" };
  }
  if (user.status !== "ACTIVE") {
    return { ok: false, message: "账号已被停用，请联系企业管理员" };
  }

  await createSession(user.id);
  // 只允许站内相对路径，防止开放重定向
  const target =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  redirect(target);
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
