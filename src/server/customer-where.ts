import { dayRange } from "@/lib/crm";
import type { SegmentFilters } from "@/lib/segments";
import type { Prisma } from "@/generated/prisma/client";

const DAY = 86_400_000;

/**
 * 把筛选条件转成 Prisma where（不含数据范围），客户列表、客群计数和公海规则共用。
 * tz 用于「今天待跟进」的日期边界。
 */
export function customerFilterWhere(f: SegmentFilters, tz: string, now = new Date()): Prisma.CustomerWhereInput[] {
  const and: Prisma.CustomerWhereInput[] = [];
  if (f.owner) and.push({ ownerId: f.owner });
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
  if (f.follow === "due") and.push({ nextFollowAt: { lt: dayRange(tz, now).end } });
  if (f.follow === "stale") and.push(idleWhere(14, now));
  if (f.follow === "never") and.push({ lastFollowAt: null });
  if (f.follow === "soon") and.push({ ownerId: { not: null }, poolDueAt: { lt: new Date(now.getTime() + 7 * DAY) } });
  const idle = Number(f.idle);
  if (Number.isFinite(idle) && idle > 0) and.push(idleWhere(Math.floor(idle), now));
  return and;
}

function idleWhere(days: number, now: Date): Prisma.CustomerWhereInput {
  const cutoff = new Date(now.getTime() - days * DAY);
  return { OR: [{ lastContactAt: null }, { lastContactAt: { lt: cutoff } }] };
}
