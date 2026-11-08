import "server-only";
import { tenantDb } from "@/server/db";
import type { CurrentUser } from "@/server/auth";
import { scopeOwnerIds } from "@/server/scope";
import { dayRange } from "@/lib/crm";
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
    page: Math.max(1, Number(one(sp.page)) || 1),
  };
}

export async function listCustomers(user: CurrentUser, f: CustomerFilters, mode: "mine" | "pool") {
  const db = tenantDb(user.tenantId);
  const and: Prisma.CustomerWhereInput[] = [];

  if (mode === "pool") {
    and.push({ ownerId: null });
  } else {
    const scope = await scopeOwnerIds(user);
    and.push(scope ? { ownerId: { in: scope } } : { ownerId: { not: null } });
    if (f.owner) and.push({ ownerId: f.owner });
  }

  if (f.q) {
    const contains = { contains: f.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { name: contains },
        { domain: contains },
        { contacts: { some: { OR: [{ name: contains }, { email: contains }, { phone: contains }, { whatsapp: contains }] } } },
      ],
    });
  }
  if (f.status) and.push({ statusId: f.status });
  if (f.group) and.push({ groupId: f.group });
  if (f.star) and.push({ star: Number(f.star) });
  if (f.country) and.push({ country: f.country });
  if (f.tag) and.push({ tags: { has: f.tag } });
  if (f.follow === "due") and.push({ nextFollowAt: { lt: dayRange(user.timezone).end } });
  if (f.follow === "stale") {
    const cutoff = new Date(Date.now() - 14 * 86_400_000);
    and.push({ OR: [{ lastContactAt: null }, { lastContactAt: { lt: cutoff } }] });
  }

  const where: Prisma.CustomerWhereInput = { AND: and };
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
        poolEnteredAt: true,
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
