import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { StageTable } from "./stage-table";

export const metadata: Metadata = { title: "商机阶段" };

export default async function StagesPage() {
  const user = await requirePermission("settings.business");
  const db = tenantDb(user.tenantId);
  const [stages, counts] = await Promise.all([
    db.stage.findMany({ orderBy: { sort: "asc" } }),
    db.opportunity.groupBy({ by: ["stageId"], _count: true }),
  ]);
  const used = new Map(counts.map((c) => [c.stageId, c._count]));
  return (
    <>
      <PageHeader title="商机阶段" description="销售漏斗的各个阶段，顺序即看板列的顺序。赢单 / 输单阶段会把商机标记为已关闭。" />
      <StageTable
        stages={stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, kind: s.kind, count: used.get(s.id) ?? 0 }))}
      />
    </>
  );
}
