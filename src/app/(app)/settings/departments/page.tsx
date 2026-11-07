import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { DepartmentTree, type DeptNode } from "./department-tree";

export const metadata: Metadata = { title: "组织架构" };

export default async function DepartmentsPage() {
  const user = await requirePermission("settings.org");
  const rows = await tenantDb(user.tenantId).department.findMany({
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { users: true } } },
  });

  // 拉平成带层级的有序列表，便于渲染缩进
  const flat: DeptNode[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const d of rows.filter((r) => r.parentId === parentId)) {
      flat.push({ id: d.id, name: d.name, parentId: d.parentId, depth, members: d._count.users });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);

  return (
    <>
      <PageHeader title="组织架构" description="部门决定「本部门」数据范围的可见边界，下级部门的数据对上级可见。" />
      <DepartmentTree nodes={flat} />
    </>
  );
}
