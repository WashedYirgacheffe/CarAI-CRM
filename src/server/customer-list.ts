import "server-only";
import { tenantDb } from "@/server/db";
import type { CurrentUser } from "@/server/auth";
import { scopeOwnerIds } from "@/server/scope";
import { customerFilterWhere } from "@/server/customer-where";
import type { Prisma } from "@/generated/prisma/client";

export const PAGE_SIZE = 20;

export type SearchParams = Record<string, string | string[] | undefined>;

export type CustomerFilters = {
  q: string;
  status: string;
  group: string;
  star: string;
  country: string;
  tag: string;
  owner: string;
  follow: string;
  idle: string;
  /** 当前选中的客群 */
  seg: string;
  page: number;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export function parseFilters(sp: SearchParams): CustomerFilters {
  return {
    q: one(sp.q),
    status: one(sp.status),
    group: one(sp.group),
    star: one(sp.star),
    country: one(sp.country),
    tag: one(sp.tag),
    owner: one(sp.owner),
    follow: one(sp.follow),
    idle: one(sp.idle),
    seg: one(sp.seg),
    page: Math.max(1, Number(one(sp.page)) || 1),
  };
}

/** 列表与统计共用的查询条件：数据范围 + 筛选 */
export async function customerListWhere(user: CurrentUser, f: CustomerFilters, mode: "mine" | "pool"): Promise<Prisma.CustomerWhereInput> {
  const and: Prisma.CustomerWhereInput[] = [];
  if (mode === "pool") {
    and.push({ ownerId: null });
  } else {
    const scope = await scopeOwnerIds(user);
    and.push(scope ? { ownerId: { in: scope } } : { ownerId: { not: null } });
  }
  and.push(...customerFilterWhere(mode === "pool" ? { ...f, owner: "" } : f, user.timezone));
  return { AND: and };
}

export async function listCustomers(user: CurrentUser, f: CustomerFilters, mode: "mine" | "pool") {
  const db = tenantDb(user.tenantId);
  const where = await customerListWhere(user, f, mode);
  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    mode === "pool"
      ? [{ poolEnteredAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
      : f.follow === "due"
        ? [{ nextFollowAt: "asc" }]
        : [{ updatedAt: "desc" }];

  const [total, rows] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      orderBy,
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        country: true,
        star: true,
        tags: true,
        lastContactAt: true,
        nextFollowAt: true,
        poolDueAt: true,
        poolCount: true,
        poolEnteredAt: true,
        prevOwner: { select: { name: true } },
        poolReason: true,
        createdAt: true,
        status: { select: { name: true, color: true } },
        group: { select: { name: true } },
        owner: { select: { id: true, name: true } },
        contacts: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          take: 1,
          select: { name: true, email: true },
        },
        _count: { select: { contacts: true } },
      },
    }),
  ]);

  return {
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      star: r.star,
      tags: r.tags,
      statusName: r.status?.name ?? null,
      statusColor: r.status?.color ?? null,
      groupName: r.group?.name ?? null,
      ownerName: r.owner?.name ?? null,
      contactName: r.contacts[0]?.name ?? null,
      contactEmail: r.contacts[0]?.email ?? null,
      contactCount: r._count.contacts,
      lastContactAt: r.lastContactAt?.toISOString() ?? null,
      nextFollowAt: r.nextFollowAt?.toISOString() ?? null,
      poolDueAt: r.poolDueAt?.toISOString() ?? null,
      poolCount: r.poolCount,
      prevOwnerName: r.prevOwner?.name ?? null,
      poolEnteredAt: r.poolEnteredAt?.toISOString() ?? null,
      poolReason: r.poolReason,
    })),
  };
}

export type CustomerRow = Awaited<ReturnType<typeof listCustomers>>["rows"][number];

/** 筛选下拉需要的选项 */
export async function customerOptions(tenantId: string) {
  const db = tenantDb(tenantId);
  const [statuses, groups] = await Promise.all([
    db.customerStatus.findMany({ orderBy: { sort: "asc" }, select: { id: true, name: true, color: true } }),
    db.customerGroup.findMany({
      orderBy: [{ sort: "asc" }, { name: "asc" }],
      select: { id: true, name: true, parentId: true },
    }),
  ]);
  return { statuses, groups: flattenGroups(groups) };
}

/** 分组树拍平成带缩进的选项列表 */
function flattenGroups(groups: { id: string; name: string; parentId: string | null }[]) {
  const out: { id: string; name: string; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const g of groups.filter((x) => x.parentId === parentId)) {
      out.push({ id: g.id, name: g.name, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export type CustomerOptions = Awaited<ReturnType<typeof customerOptions>>;

const DAY = 86_400_000;

/** 列表顶部的分布统计：状态、国家、星级、多久没联系（都基于当前筛选） */
export async function customerInsights(user: CurrentUser, f: CustomerFilters, mode: "mine" | "pool") {
  const db = tenantDb(user.tenantId);
  const where = await customerListWhere(user, f, mode);
  const now = Date.now();
  const ago = (d: number) => new Date(now - d * DAY);
  const within = (from: number, to?: number): Prisma.CustomerWhereInput => ({
    AND: [where, { lastContactAt: to === undefined ? { gte: ago(from) } : { gte: ago(to), lt: ago(from) } }],
  });
  const [byStatus, byCountry, byStar, d7, d30, d90, old, never] = await Promise.all([
    db.customer.groupBy({ by: ["statusId"], where, _count: { _all: true } }),
    db.customer.groupBy({ by: ["country"], where, _count: { _all: true } }),
    db.customer.groupBy({ by: ["star"], where, _count: { _all: true } }),
    db.customer.count({ where: within(7) }),
    db.customer.count({ where: within(7, 30) }),
    db.customer.count({ where: within(30, 90) }),
    db.customer.count({ where: { AND: [where, { lastContactAt: { lt: ago(90) } }] } }),
    db.customer.count({ where: { AND: [where, { lastContactAt: null }] } }),
  ]);
  return {
    status: byStatus.map((x) => ({ id: x.statusId, count: x._count._all })),
    country: byCountry.map((x) => ({ code: x.country, count: x._count._all })),
    star: byStar.map((x) => ({ star: x.star, count: x._count._all })),
    idle: { d7, d30, d90, old, never },
  };
}
