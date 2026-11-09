import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskList } from "@/components/crm/tasks";
import { WorldClock } from "@/components/dashboard/world-clock";
import { FxCalculator } from "@/components/dashboard/fx-calculator";
import { CustomizeDashboard } from "@/components/dashboard/customize-dashboard";
import { BarTrend, Distribution, HBars } from "@/components/dashboard/charts";
import {
  Building2,
  CalendarClock,
  CalendarX2,
  Inbox,
  KanbanSquare,
  Mail,
  MessageCircle,
  ReceiptText,
  type LucideIcon,
} from "lucide-react";
import { can, requireUser } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { getBadges } from "@/server/badges";
import { getRates } from "@/server/documents";
import { ownedWhere } from "@/server/scope";
import { docScopeWhere } from "@/server/documents";
import { CURRENCIES, LEAD_OPEN_STATUSES, countryName, dayRange, followMethodLabel, formatDateTime, formatMoney, parseLocalInput } from "@/lib/crm";
import { ORDER_NOT_COUNTED, dateInput } from "@/lib/docs";
import { COUNTRY_TZ, DEFAULT_CLOCK_COUNTRIES, isSideCard, resolveDashboard } from "@/lib/dashboard";
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
  const saved = await prisma.user.findUnique({ where: { id: user.id }, select: { dashboardCards: true } });
  const cards = resolveDashboard(saved?.dashboardCards);
  const show = (k: (typeof cards)[number]) => cards.includes(k);

  // 近 6 个月（含本月）的起点
  const [ty, tm] = dateInput(tz).split("-").map(Number);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(ty, tm - 6 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const trendStart = parseLocalInput(`${months[0]}-01T00:00`, tz)!;
  const monthKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" });

  const [badges, rates, topCountries, trendOrders, stages, oppByStage, byStatus, byCountry, byGroup] = await Promise.all([
    show("overview") ? getBadges(user) : null,
    show("fx") || show("trend") ? getRates(user.tenantId) : null,
    // 世界时钟默认显示「我的客户」最多的国家
    show("clock") && canCustomers
      ? db.customer.groupBy({ by: ["country"], where: { ...mine, country: { not: null } }, _count: true, orderBy: { _count: { country: "desc" } }, take: 12 })
      : [],
    show("trend") && canOrders
      ? db.order.findMany({
          where: { ...docScope, status: { notIn: [...ORDER_NOT_COUNTED] }, orderDate: { gte: trendStart } },
          select: { orderDate: true, total: true, exchangeRate: true },
        })
      : [],
    show("pipeline") && canOpps ? db.stage.findMany({ where: { kind: "OPEN" }, orderBy: { sort: "asc" }, select: { id: true, name: true } }) : [],
    show("pipeline") && canOpps
      ? db.opportunity.groupBy({ by: ["stageId"], where: { ...scoped, stage: { kind: "OPEN" } }, _count: true })
      : [],
    show("distribution") && canCustomers ? db.customer.groupBy({ by: ["statusId"], where: mine, _count: true }) : [],
    show("distribution") && canCustomers ? db.customer.groupBy({ by: ["country"], where: mine, _count: true }) : [],
    show("distribution") && canCustomers ? db.customer.groupBy({ by: ["groupId"], where: mine, _count: true }) : [],
  ]);
  const [statusNames, groupNames] = show("distribution") && canCustomers
    ? await Promise.all([
        db.customerStatus.findMany({ select: { id: true, name: true } }),
        db.customerGroup.findMany({ select: { id: true, name: true } }),
      ])
    : [[], []];
  const nameOf = (rows: { id: string; name: string }[], id: string | null, none: string) => rows.find((r) => r.id === id)?.name ?? none;
  const trend = months.map((m) => ({
    label: `${Number(m.slice(5))}月`,
    value: trendOrders
      .filter((o) => monthKey.format(o.orderDate) === m)
      .reduce((n, o) => n + Number(o.total) * Number(o.exchangeRate), 0),
  }));
  const trendTotal = trend.reduce((n, t) => n + t.value, 0);
  const pipeline = stages.map((st) => ({ label: st.name, value: oppByStage.find((o) => o.stageId === st.id)?._count ?? 0 }));
  const clockCountries = topCountries.map((c) => c.country!).filter((c) => COUNTRY_TZ[c] && c !== "CN").slice(0, 6);

  const [myCustomers, dueCustomers, poolSoonCustomers, tasks, overdueTasks, openOpps, newLeads, unassignedLeads, recent, monthOrders] =
    await Promise.all([
      canCustomers ? db.customer.count({ where: mine }) : 0,
      canCustomers ? db.customer.count({ where: { ...mine, nextFollowAt: { lt: end } } }) : 0,
      canCustomers
        ? db.customer.count({ where: { ...mine, poolDueAt: { lt: new Date(end.getTime() + 7 * 86_400_000) } } })
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
      canLeads && can(user, "lead.assign") ? db.lead.count({ where: { ownerId: null, status: { in: [...LEAD_OPEN_STATUSES] } } }) : null,
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
            where: { ...docScope, status: { notIn: [...ORDER_NOT_COUNTED] }, orderDate: { gte: monthStart } },
            select: { total: true, exchangeRate: true },
          })
        : [],
    ]);

  const oppCount = openOpps.reduce((n, o) => n + o._count, 0);
  const monthOrderCny = monthOrders.reduce((n, o) => n + Number(o.total) * Number(o.exchangeRate), 0);
  const oppSum = openOpps.map((o) => formatMoney(o._sum.amount?.toString() ?? 0, o.currency)).join(" + ") || "—";

  const stats = [
    canCustomers && { icon: Building2, label: "我的客户", value: myCustomers, hint: `${poolSoonCustomers} 个 7 天内将进公海`, href: "/customers?follow=soon" },
    canCustomers && {
      icon: CalendarClock,
      label: "今天待跟进客户",
      value: dueCustomers,
      hint: "含已逾期",
      href: "/customers?follow=due",
      alert: dueCustomers > 0,
    },
    { icon: CalendarX2, label: "逾期日程", value: overdueTasks, hint: "未完成且已过时间", href: "/schedule", alert: overdueTasks > 0 },
    canOpps && { icon: KanbanSquare, label: "进行中商机", value: oppCount, hint: oppSum, href: "/opportunities" },
    canOrders && {
      icon: ReceiptText,
      label: "本月订单",
      value: monthOrders.length,
      hint: monthOrders.length ? `≈ ${formatMoney(monthOrderCny, "CNY")}` : "本月还没有订单",
      href: "/orders",
    },
    canLeads && {
      icon: Inbox,
      label: "新线索",
      value: newLeads,
      hint: unassignedLeads !== null ? `另有 ${unassignedLeads} 条待分配` : "分配给我、未处理",
      href: unassignedLeads ? "/leads?tab=unassigned" : "/leads",
    },
    can(user, "mail.use") &&
      badges && { icon: Mail, label: "未读邮件", value: badges.mail, hint: "我的收件箱", href: "/mail?tag=unread", alert: badges.mail > 0 },
    can(user, "whatsapp.use") &&
      badges && { icon: MessageCircle, label: "WhatsApp 未读", value: badges.whatsapp, hint: "我的会话", href: "/whatsapp", alert: badges.whatsapp > 0 },
  ].filter(Boolean) as { icon: LucideIcon; label: string; value: number; hint: string; href: string; alert?: boolean }[];

  const blocks: Record<(typeof cards)[number], React.ReactNode> = {
    overview: (
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="surface group flex items-start gap-3.5 p-5 transition-[box-shadow,translate] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-12px_oklch(0.4_0.12_265/0.25)]"
          >
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                s.alert ? "bg-destructive/10 text-destructive" : "bg-accent text-primary",
              )}
            >
              <s.icon className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-muted-foreground">{s.label}</span>
              <span className={cn("mt-0.5 block text-[28px] leading-tight font-bold tabular-nums", s.alert && "text-destructive")}>{s.value}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">{s.hint}</span>
            </span>
          </Link>
        ))}
      </section>
    ),
    today: (
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
    ),
    trend: canOrders ? (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">成交趋势</CardTitle>
          <CardAction>
            <span className="text-sm text-muted-foreground">
              近 6 个月合计 <span className="font-semibold text-foreground tabular-nums">{formatMoney(trendTotal, "CNY")}</span>
            </span>
          </CardAction>
        </CardHeader>
        <CardContent>
          <BarTrend data={trend} currency="CNY" empty="近 6 个月还没有订单" />
        </CardContent>
      </Card>
    ) : null,
    pipeline: canOpps ? (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">商机阶段</CardTitle>
          <CardAction>
            <Link href="/opportunities" className="text-sm text-muted-foreground hover:text-primary">
              查看看板
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          <HBars data={pipeline} empty="还没有进行中的商机" />
        </CardContent>
      </Card>
    ) : null,
    distribution: canCustomers ? (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">客户分布</CardTitle>
        </CardHeader>
        <CardContent>
          <Distribution
            dims={[
              { key: "status", label: "状态", data: byStatus.map((r) => ({ label: nameOf(statusNames, r.statusId, "未设置"), value: r._count })) },
              { key: "country", label: "国家", data: byCountry.map((r) => ({ label: r.country ? countryName(r.country) : "未填写", value: r._count })) },
              { key: "group", label: "分组", data: byGroup.map((r) => ({ label: nameOf(groupNames, r.groupId, "未分组"), value: r._count })) },
            ]}
          />
        </CardContent>
      </Card>
    ) : null,
    recent: canCustomers ? (
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
                    <span className="tabular-nums">{formatDateTime(a.createdAt, tz)}</span> · {a.user?.name} · {followMethodLabel(a.method)} ·{" "}
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
    ) : null,
    clock: (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">世界时钟</CardTitle>
        </CardHeader>
        <CardContent>
          <WorldClock suggested={clockCountries.length ? clockCountries : DEFAULT_CLOCK_COUNTRIES} localTz={tz} />
        </CardContent>
      </Card>
    ),
    fx: (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">汇率换算</CardTitle>
        </CardHeader>
        <CardContent>
          <FxCalculator rates={rates ?? { CNY: 1 }} currencies={CURRENCIES} />
        </CardContent>
      </Card>
    ),
  };

  const main = cards.filter((k) => k !== "overview" && !isSideCard(k));
  const side = cards.filter((k) => isSideCard(k));

  return (
    <>
      <PageHeader
        title={`你好，${user.name}`}
        description={`${user.tenantName} · ${user.departmentName ?? "未分配部门"} · ${user.roleName}`}
        actions={<CustomizeDashboard current={cards} />}
      />
      {cards.includes("overview") && <div className="mb-4">{blocks.overview}</div>}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-4">
          {main.map((k) => blocks[k] && <div key={k}>{blocks[k]}</div>)}
        </div>
        {side.length > 0 && (
          <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-1">
            {side.map((k) => blocks[k] && <div key={k}>{blocks[k]}</div>)}
          </div>
        )}
      </div>
    </>
  );
}
