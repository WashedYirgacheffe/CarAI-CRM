import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { tenantDb } from "@/server/db";

export const metadata: Metadata = { title: "工作台" };

const ROADMAP = [
  { phase: "P0", title: "骨架", body: "注册登录、多租户、部门成员、角色权限", done: true },
  { phase: "P1", title: "客户与销售", body: "客户、公海、线索、商机、跟进与日程", done: false },
  { phase: "P2", title: "单据", body: "产品、多币种报价单、PI、订单", done: false },
  { phase: "P3", title: "邮件", body: "邮箱绑定、收发同步、自动建档", done: false },
];

export default async function DashboardPage() {
  const user = await requireUser();
  const db = tenantDb(user.tenantId);
  const [members, departments, roles] = await Promise.all([
    db.user.count({ where: { status: "ACTIVE" } }),
    db.department.count(),
    db.role.count(),
  ]);

  const stats = [
    { label: "在用成员", value: members, href: "/settings/members" },
    { label: "部门", value: departments, href: "/settings/departments" },
    { label: "角色", value: roles, href: "/settings/roles" },
  ];

  return (
    <>
      <PageHeader
        title={`你好，${user.name}`}
        description={`${user.tenantName} · ${user.departmentName ?? "未分配部门"} · ${user.roleName}`}
      />
      <section className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-xl border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{s.value}</p>
          </Link>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">建设进度</h2>
        <ol className="divide-y rounded-xl border bg-card">
          {ROADMAP.map((r) => (
            <li key={r.phase} className="flex items-center gap-4 px-5 py-4">
              <span
                className={
                  r.done
                    ? "rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
                    : "rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                }
              >
                {r.phase}
              </span>
              <div className="min-w-0">
                <p className="font-medium">{r.title}</p>
                <p className="text-sm text-muted-foreground">{r.body}</p>
              </div>
              <span className="ml-auto text-xs text-muted-foreground">{r.done ? "已完成" : "待开发"}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
