import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "@/server/db";
import {
  ALL_PERMISSIONS,
  type DataScopeValue,
  type Permission,
} from "@/lib/permissions";

export const SESSION_COOKIE = "crm_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

// ---------- 密码 ----------

export function hashPassword(password: string) {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export function verifyPassword(passwordHash: string, password: string) {
  return verify(passwordHash, password);
}

// ---------- 会话 ----------

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** 创建会话并写入 cookie。只能在 Server Action / Route Handler 中调用。 */
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const h = await headers();
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
    },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** 注销当前会话。只能在 Server Action / Route Handler 中调用。 */
export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  }
  jar.delete(SESSION_COOKIE);
}

/** 让某个账号的全部会话失效（禁用账号、重置密码时用） */
export async function revokeUserSessions(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}

// ---------- 当前用户 ----------

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  isOwner: boolean;
  tenantId: string;
  tenantName: string;
  departmentId: string | null;
  departmentName: string | null;
  roleId: string;
  roleName: string;
  dataScope: DataScopeValue;
  permissions: Permission[];
};

/** 读取当前登录用户；未登录、会话过期或账号被禁用时返回 null。每个请求只查一次库。 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: {
      user: { include: { role: true, tenant: true, department: true } },
    },
  });
  if (!session || session.expiresAt < new Date()) return null;

  const u = session.user;
  if (u.status !== "ACTIVE") return null;

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    isOwner: u.isOwner,
    tenantId: u.tenantId,
    tenantName: u.tenant.name,
    departmentId: u.departmentId,
    departmentName: u.department?.name ?? null,
    roleId: u.roleId,
    roleName: u.role.name,
    // 主账号永远拥有全部权限和全公司数据范围
    dataScope: u.isOwner ? "ALL" : u.role.dataScope,
    permissions: u.isOwner
      ? ALL_PERMISSIONS
      : (u.role.permissions as Permission[]),
  };
});

export function can(user: CurrentUser, permission: Permission) {
  return user.permissions.includes(permission);
}

/** 页面 / Action 入口：要求已登录 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** 页面入口：要求某个权限，没有就跳到无权限页 */
export async function requirePermission(permission: Permission) {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/forbidden");
  return user;
}
