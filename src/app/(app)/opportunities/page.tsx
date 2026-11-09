import type { Metadata } from "next";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { ownedWhere, scopeMembers } from "@/server/scope";
import { daysAgo } from "@/lib/crm";
import { OpportunityBoard } from "./board";

export const metadata: Metadata = { title: "商机" };

export default async function OpportunitiesPage({ searchParams }: PageProps<"/opportunities">) {
  const user = await requirePermission("opportunity.view");
  const sp = await searchParams;
  const owner = typeof sp.owner === "string" ? sp.owner : "";
  const closedDays = 90;
  const db = tenantDb(user.tenantId);
  const scoped = await ownedWhere(user);
  const members = await scopeMembers(user);
  const ownerFilter = owner && members.some((m) => m.id === owner) ? { ownerId: owner } : scoped;

  const [stages, opps, customers] = await Promise.all([
    db.stage.findMany({ orderBy: { sort: "asc" } }),
    db.opportunity.findMany({
      where: {
        ...ownerFilter,
        // 已关闭的只看最近 90 天，看板不会越来越长
        OR: [{ closedAt: null }, { closedAt: { gte: daysAgo(closedDays) } }],
      },
      orderBy: [{ stageChangedAt: "desc" }],
      include: { customer: { select: { id: true, name: true } }, owner: { select: { name: true } } },
      take: 500,
    }),
    can(user, "opportunity.create")
      ? db.customer.findMany({ where: scoped, orderBy: { updatedAt: "desc" }, select: { id: true, name: true }, take: 500 })
      : [],
  ]);

  return (
    <OpportunityBoard
      description={`拖动卡片切换阶段 · 赢单 / 输单列只显示最近 ${closedDays} 天`}
      closedDays={closedDays}
      tz={user.timezone}
      owner={owner}
      members={members}
      customers={customers}
      perms={{ create: can(user, "opportunity.create"), edit: can(user, "opportunity.edit"), delete: can(user, "opportunity.delete") }}
      stages={stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, kind: s.kind }))}
      opportunities={opps.map((o) => ({
        id: o.id,
        name: o.name,
        amount: o.amount.toString(),
        currency: o.currency,
        stageId: o.stageId,
        customerId: o.customerId,
        customerName: o.customer.name,
        ownerName: o.owner?.name ?? null,
        expectedCloseAt: o.expectedCloseAt?.toISOString() ?? null,
        remark: o.remark,
      }))}
    />
  );
}
