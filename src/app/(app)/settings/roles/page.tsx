import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { RoleEditor } from "./role-editor";

export const metadata: Metadata = { title: "角色权限" };

export default async function RolesPage() {
  const user = await requirePermission("settings.role");
  const roles = await tenantDb(user.tenantId).role.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { users: true } } },
  });
  return (
    <>
      <PageHeader title="角色权限" description="功能权限决定能用哪些菜单和操作，数据范围决定能看到谁的数据。" />
      <RoleEditor
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          systemKey: r.systemKey,
          dataScope: r.dataScope,
          permissions: r.permissions,
          members: r._count.users,
        }))}
      />
    </>
  );
}
