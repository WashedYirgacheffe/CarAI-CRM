import "server-only";
import { tenantDb } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { scopeOwnerIds } from "@/server/scope";
import { digitsOf } from "@/server/whatsapp/match";
import type { Prisma } from "@/generated/prisma/client";

/** 当前用户能看到的客户（数据范围内的私海 + 有公海权限时的公海） */
export async function visibleCustomerWhere(user: CurrentUser): Promise<Prisma.CustomerWhereInput> {
  const scope = await scopeOwnerIds(user);
  const owned: Prisma.CustomerWhereInput = scope ? { ownerId: { in: scope } } : { ownerId: { not: null } };
  return can(user, "pool.view") ? { OR: [owned, { ownerId: null }] } : owned;
}

export type DuplicateGroup = {
  key: string;
  reasons: string[];
  customers: {
    id: string;
    name: string;
    country: string | null;
    ownerName: string | null;
    contactCount: number;
    createdAt: string;
    lastContactAt: string | null;
  }[];
};

/**
 * 找疑似重复的客户：同一官网域名、同一联系人邮箱、同一电话 / WhatsApp 号码。
 * 用并查集把有任一相同项的客户归到一组。
 */
export async function findDuplicateGroups(user: CurrentUser): Promise<DuplicateGroup[]> {
  const db = tenantDb(user.tenantId);
  const rows = await db.customer.findMany({
    where: await visibleCustomerWhere(user),
    select: {
      id: true,
      name: true,
      country: true,
      domain: true,
      createdAt: true,
      lastContactAt: true,
      owner: { select: { name: true } },
      contacts: { select: { email: true, phone: true, whatsapp: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 20_000,
  });

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const r of rows) parent.set(r.id, r.id);

  const keyOwners = new Map<string, Set<string>>();
  const add = (key: string, id: string) => {
    const s = keyOwners.get(key) ?? new Set<string>();
    s.add(id);
    keyOwners.set(key, s);
  };
  for (const r of rows) {
    if (r.domain) add(`域名 ${r.domain}`, r.id);
    for (const c of r.contacts) {
      if (c.email) add(`邮箱 ${c.email.toLowerCase()}`, r.id);
      for (const p of [c.phone, c.whatsapp]) {
        const d = digitsOf(p);
        if (d.length >= 7) add(`电话 +${d}`, r.id);
      }
    }
  }
  const reasonsByRoot = new Map<string, Set<string>>();
  for (const [, ids] of keyOwners) {
    if (ids.size < 2) continue;
    const list = [...ids];
    for (let i = 1; i < list.length; i++) union(list[0], list[i]);
  }
  for (const [key, ids] of keyOwners) {
    if (ids.size < 2) continue;
    const root = find([...ids][0]);
    const s = reasonsByRoot.get(root) ?? new Set<string>();
    s.add(key);
    reasonsByRoot.set(root, s);
  }

  const groups = new Map<string, DuplicateGroup>();
  for (const r of rows) {
    const root = find(r.id);
    if (!reasonsByRoot.has(root)) continue;
    const g = groups.get(root) ?? { key: root, reasons: [...reasonsByRoot.get(root)!].slice(0, 5), customers: [] };
    g.customers.push({
      id: r.id,
      name: r.name,
      country: r.country,
      ownerName: r.owner?.name ?? null,
      contactCount: r.contacts.length,
      createdAt: r.createdAt.toISOString(),
      lastContactAt: r.lastContactAt?.toISOString() ?? null,
    });
    groups.set(root, g);
  }
  return [...groups.values()].sort((a, b) => b.customers.length - a.customers.length).slice(0, 200);
}
