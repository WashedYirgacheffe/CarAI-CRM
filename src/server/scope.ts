import "server-only";
import { cache } from "react";
import { prisma } from "@/server/db";
import type { CurrentUser } from "@/server/auth";

/**
 * 当前用户按「数据范围」能看到哪些负责人的数据。
 * 返回 null 表示全公司；否则是负责人 userId 列表（包含自己）。
 */
export const scopeOwnerIds = cache(async (user: CurrentUser): Promise<string[] | null> => {
  if (user.dataScope === "ALL") return null;
  if (user.dataScope === "SELF" || !user.departmentId) return [user.id];

  const depts = await prisma.department.findMany({
    where: { tenantId: user.tenantId },
    select: { id: true, parentId: true },
  });
  const ids = new Set([user.departmentId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of depts) {
      if (d.parentId && ids.has(d.parentId) && !ids.has(d.id)) {
        ids.add(d.id);
        grew = true;
      }
    }
  }
  const users = await prisma.user.findMany({
    where: { tenantId: user.tenantId, departmentId: { in: [...ids] } },
    select: { id: true },
  });
  return [...new Set([user.id, ...users.map((u) => u.id)])];
});

/** 私海（有负责人）且在数据范围内的 where 条件 */
export async function ownedWhere(user: CurrentUser) {
  const ids = await scopeOwnerIds(user);
  return ids ? { ownerId: { in: ids } } : { ownerId: { not: null } };
}

/** 某条记录的负责人是否在当前用户的数据范围内 */
export async function inScope(user: CurrentUser, ownerId: string | null | undefined) {
  if (!ownerId) return false;
  const ids = await scopeOwnerIds(user);
  return ids === null || ids.includes(ownerId);
}

/** 数据范围内的在用成员，用于负责人筛选、转移、分配 */
export const scopeMembers = cache(async (user: CurrentUser) => {
  const ids = await scopeOwnerIds(user);
  return prisma.user.findMany({
    where: { tenantId: user.tenantId, status: "ACTIVE", ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
});

/** 全公司在用成员（分配公海客户、线索时可以分给任何人） */
export const allMembers = cache(async (tenantId: string) =>
  prisma.user.findMany({
    where: { tenantId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  }),
);
