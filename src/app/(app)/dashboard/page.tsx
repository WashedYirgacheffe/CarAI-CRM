import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskList } from "@/components/crm/tasks";
import { can, requireUser } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { ownedWhere } from "@/server/scope";
import { docScopeWhere } from "@/server/documents";
import { dayRange, daysAgo, followMethodLabel, formatDateTime, formatMoney, parseLocalInput } from "@/lib/crm";
import { dateInput } from "@/lib/docs";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "工作台" };

export default async function DashboardPage() {
  const user = await requireUser();
  const db = tenantDb(user.tenantId);
  const tz = user.timezone;
  const { start, end } = dayRange(tz);
  const canCustomers = can(user, "customer.view");
  const canLeads = can(user, "lead.view");
  const canOpps = can(user, "opportunity.view");
  const canOrders = can(user, "order.view");
  const monthStart = parseLocalInput(`${dateInput(tz).slice(0, 8)}01T00:00`, tz)!;
  const scoped = await ownedWhere(user);
  const docScope = await docScopeWhere(user);
  const mine = { ownerId: user.id };

  const [myCustomers, dueCustomers, staleCustomers, tasks, overdueTasks, openOpps, newLeads, unassignedLeads, recent, monthOrders] =
    await Promise.all([
      canCustomers ? db.customer.count({ where: mine }) : 0,
      canCustomers ? db.customer.count({ where: { ...mine, nextFollowAt: { lt: end } } }) : 0,
      canCustomers
        ? db.customer.count({ where: { ...mine, OR: [{ lastContactAt: null }, { lastContactAt: { lt: daysAgo(14) } }] } })
        : 0,
      db.task.findMany({
        where: { ...mine, done: false, dueAt: { lt: end } },
        orderBy: { dueAt: "asc" },
        take: 10,
        include: { customer: { select: { name: true } } },
      }),
      db.task.count({ where: { ...mine, done: false, dueAt: { lt: start } } }),
      canOpps
        ? db.opportunity.groupBy({
            by: ["currency"],
            where: { ...scoped, stage: { kind: "OPEN" } },
            _sum: { amount: true },
            _count: true,
          })
        : [],
      canLeads ? db.lead.count({ where: { ...mine, status: "NEW" } }) : 0,
      canLeads && can(user, "lead.assign") ? db.lead.count({ where: { ownerId: null, status: { in: ["NEW", "CONTACTED"] } } }) : null,
      canCustomers
        ? db.activity.findMany({
            where: { type: "FOLLOW_UP", customer: scoped },
            orderBy: { createdAt: "desc" },
            take: 8,
            include: { customer: { select: { id: true, name: true } }, user: { select: { name: true } } },
          })
        : [],
      canOrders
        ? db.order.findMany({
            // 与订单列表一致：按数据范围统计（经理看到团队的订单）
            where: { ...docScope, status: { not: "CANCELLED" }, orderDate: { gte: monthStart } },
            select: { total: true, exchangeRate: true },
          })
        : [],
    ]);

  const oppCount = openOpps.reduce((n, o) => n + o._count, 0);
  const monthOrderCny = monthOrders.reduce((n, o) => n + Number(o.total) * Number(o.exchangeRate), 0);
  const oppSum = openOpps.map((o) => formatMoney(o._sum.amount?.toString() ?? 0, o.currency)).join(" + ") || "—";

  const stats = [
    canCustomers && { label: "我的客户", value: myCustomers, hint: `${staleCustomers} 个超过 14 天未跟进`, href: "/customers" },
    canCustomers && {
      label: "今天待跟进客户",
      value: dueCustomers,
      hint: "含已逾期",
      href: "/customers?follow=due",
      alert: dueCustomers > 0,
    },
    { label: "逾期日程", value: overdueTasks, hint: "未完成且已过时间", href: "/schedule", alert: overdueTasks > 0 },
    canOpps && { label: "进行中商机", value: oppCount, hint: oppSum, href: "/opportunities" },
    canOrders && {
      label: "本月订单",
      value: monthOrders.length,
      hint: monthOrders.length ? `≈ ${formatMoney(monthOrderCny, "CNY")}` : "本月还没有订单",
      href: "/orders",
    },
    canLeads && {
      label: "新线索",
      value: newLeads,
      hint: unassignedLeads !== null ? `另有 ${unassignedLeads} 条待分配` : "分配给我、未处理",
      href: unassignedLeads ? "/leads?tab=unassigned" : "/leads",
    },
  ].filter(Boolean) as { label: string; value: number; hint: string; href: string; alert?: boolean }[];

  return (
    <>
      <PageHeader
        title={`你好，${user.name}`}
        description={`${user.tenantName} · ${user.departmentName ?? "未分配部门"} · ${user.roleName}`}
      />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums", s.alert && "text-destructive")}>{s.value}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground tabular-nums">{s.hint}</p>
          </Link>
        ))}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">今天要做</CardTitle>
            <CardAction>
              <Link href="/schedule" className="text-sm text-muted-foreground hover:text-primary">
                全部日程
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            <TaskList
              tz={tz}
              empty="今天没有待办，去客户列表看看谁该跟进了"
              tasks={tasks.map((t) => ({
                id: t.id,
                title: t.title,
                dueAt: t.dueAt.toISOString(),
                done: t.done,
                customerId: t.customerId,
                customerName: t.customer?.name ?? null,
              }))}
            />
          </CardContent>
        </Card>

        {canCustomers && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">最近跟进</CardTitle>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">还没有跟进记录</p>
              ) : (
                <ul className="divide-y">
                  {recent.map((a) => (
                    <li key={a.id} className="py-2.5">
                      <p className="text-xs text-muted-foreground">
                        <span className="tabular-nums">{formatDateTime(a.createdAt, tz)}</span> · {a.user?.name} ·{" "}
                        {followMethodLabel(a.method)} ·{" "}
                        {a.customer && (
                          <Link href={`/customers/${a.customer.id}`} className="text-foreground hover:text-primary hover:underline">
                            {a.customer.name}
                          </Link>
                        )}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm">{a.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
