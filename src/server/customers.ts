import "server-only";
import { prisma, tenantDb } from "@/server/db";
export { recyclePool } from "@/server/pool";
import type { CurrentUser } from "@/server/auth";
import { can } from "@/server/auth";
import { inScope } from "@/server/scope";
import { extractDomain, normalizeCompanyName } from "@/lib/crm";
import type { ActivityType, FollowMethod } from "@/generated/prisma/client";

export type ActivityInput = {
  tenantId: string;
  customerId?: string | null;
  opportunityId?: string | null;
  type?: ActivityType;
  event?: string;
  method?: FollowMethod | null;
  content: string;
  userId?: string | null;
};

export function logActivity(a: ActivityInput) {
  return prisma.activity.create({ data: { type: "SYSTEM", ...a } });
}

export type CustomerAccess = {
  /** 能看详情 */
  view: boolean;
  /** 能编辑资料、写跟进、维护联系人 */
  edit: boolean;
  /** 在公海里 */
  inPool: boolean;
};

/** 读取一个客户以及当前用户对它的访问权限；看不到时返回 null */
export async function getCustomerForUser(user: CurrentUser, id: string) {
  const customer = await tenantDb(user.tenantId).customer.findFirst({
    where: { id },
    include: {
      owner: { select: { id: true, name: true } },
      status: true,
      group: true,
    },
  });
  if (!customer) return null;
  const inPool = !customer.ownerId;
  const owned = await inScope(user, customer.ownerId);
  const view = inPool ? can(user, "pool.view") : owned && can(user, "customer.view");
  if (!view) return null;
  const access: CustomerAccess = { view, edit: owned && can(user, "customer.edit"), inPool };
  return { customer, access };
}

/** 当前用户今天已经从公海领取了几个客户 */
export async function claimedToday(userId: string, tenantId: string, since: Date) {
  return prisma.activity.count({
    where: { tenantId, userId, event: "claimed", createdAt: { gte: since } },
  });
}

// ── 查重 ──

export type DuplicateHit = { id: string; name: string; ownerName: string | null; inPool: boolean; visible: boolean; reason: string };

export async function findDuplicates(
  user: CurrentUser,
  input: { name?: string; website?: string | null; email?: string | null },
  excludeId?: string,
): Promise<DuplicateHit[]> {
  const db = tenantDb(user.tenantId);
  const or: object[] = [];
  if (input.name) or.push({ nameKey: normalizeCompanyName(input.name) });
  const domains = [extractDomain(input.website), extractDomain(input.email)].filter(Boolean) as string[];
  if (domains.length) or.push({ domain: { in: domains } });
  if (input.email) or.push({ contacts: { some: { email: { equals: input.email.trim(), mode: "insensitive" } } } });
  if (!or.length) return [];

  const rows = await db.customer.findMany({
    where: { OR: or, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true, name: true, nameKey: true, domain: true, ownerId: true, owner: { select: { name: true } } },
    take: 5,
  });
  const key = input.name ? normalizeCompanyName(input.name) : null;
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      ownerName: r.owner?.name ?? null,
      inPool: !r.ownerId,
      visible: !r.ownerId ? can(user, "pool.view") : await inScope(user, r.ownerId),
      reason: key && r.nameKey === key ? "公司名称相同" : r.domain && domains.includes(r.domain) ? "域名相同" : "联系人邮箱相同",
    })),
  );
}

export function duplicateMessage(hit: DuplicateHit) {
  if (hit.inPool) return `客户「${hit.name}」已在公海中（${hit.reason}），请到公海领取`;
  return `客户「${hit.name}」已存在（${hit.reason}），负责人：${hit.ownerName ?? "—"}`;
}

