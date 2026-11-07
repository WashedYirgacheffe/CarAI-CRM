import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { MemberTable } from "./member-table";

export const metadata: Metadata = { title: "成员管理" };

export default async function MembersPage() {
  const user = await requirePermission("settings.org");
  const db = tenantDb(user.tenantId);
  const [members, departments, roles] = await Promise.all([
    db.user.findMany({
      orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
      include: { department: true, role: true },
    }),
    db.department.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    db.role.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="成员管理"
        description={`共 ${members.length} 个账号，其中 ${members.filter((m) => m.status === "ACTIVE").length} 个在用。`}
      />
      <MemberTable
        currentUserId={user.id}
        departments={departments}
        roles={roles}
        members={members.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          phone: m.phone,
          isOwner: m.isOwner,
          active: m.status === "ACTIVE",
          departmentId: m.departmentId,
          departmentName: m.department?.name ?? null,
          roleId: m.roleId,
          roleName: m.role.name,
          lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
        }))}
      />
    </>
  );
}
