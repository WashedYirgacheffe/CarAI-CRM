import "server-only";
import { tenantDb } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { scopeOwnerIds } from "@/server/scope";
import { customerFilterWhere } from "@/server/customer-where";
import { pickSegmentFilters, segmentQuery } from "@/lib/segments";

/** 当前用户能看到的客群（全公司共享的 + 自己建的），带实时客户数（按自己的数据范围统计） */
export async function listSegments(user: CurrentUser) {
  const db = tenantDb(user.tenantId);
  const segs = await db.customerSegment.findMany({
    where: { OR: [{ shared: true }, { createdById: user.id }] },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
  });
  const scope = await scopeOwnerIds(user);
  const owned = scope ? { ownerId: { in: scope } } : { ownerId: { not: null } };
  const manage = can(user, "settings.business");
  return Promise.all(
    segs.map(async (s) => {
      const filters = pickSegmentFilters((s.filters ?? {}) as Record<string, unknown>);
      const count = await db.customer.count({ where: { AND: [owned, ...customerFilterWhere(filters, user.timezone)] } });
      return {
        id: s.id,
        name: s.name,
        shared: s.shared,
        poolDays: s.poolDays,
        query: segmentQuery(filters),
        count,
        canDelete: s.createdById === user.id || manage,
      };
    }),
  );
}

export type SegmentItem = Awaited<ReturnType<typeof listSegments>>[number];
