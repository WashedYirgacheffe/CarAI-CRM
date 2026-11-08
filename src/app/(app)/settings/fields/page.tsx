import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { ClassifySettings } from "./classify-settings";

export const metadata: Metadata = { title: "客户分类" };

export default async function FieldsPage() {
  const user = await requirePermission("settings.business");
  const db = tenantDb(user.tenantId);
  const [statuses, groups, byStatus, byGroup] = await Promise.all([
    db.customerStatus.findMany({ orderBy: { sort: "asc" } }),
    db.customerGroup.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] }),
    db.customer.groupBy({ by: ["statusId"], _count: true }),
    db.customer.groupBy({ by: ["groupId"], _count: true }),
  ]);
  const sc = new Map(byStatus.map((c) => [c.statusId, c._count]));
  const gc = new Map(byGroup.map((c) => [c.groupId, c._count]));
  return (
    <>
      <PageHeader title="客户分类" description="客户状态用来标记跟进进度，客户分组用来按业务维度归类（最多 3 级）。" />
      <ClassifySettings
        statuses={statuses.map((s) => ({ id: s.id, name: s.name, color: s.color, count: sc.get(s.id) ?? 0 }))}
        groups={groups.map((g) => ({ id: g.id, name: g.name, parentId: g.parentId, count: gc.get(g.id) ?? 0 }))}
      />
    </>
  );
}
