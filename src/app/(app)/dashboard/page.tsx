import { EmptyState } from "@/components/crm/empty-state";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskList } from "@/components/crm/tasks";
import { WorldClock } from "@/components/dashboard/world-clock";
import { FxCalculator } from "@/components/dashboard/fx-calculator";
import { WorkspaceCanvas } from "@/components/dashboard/canvas/workspace-canvas";
import { AiStage } from "@/components/ai/ai-stage";
import { aiConfigured } from "@/server/ai";
import { BarTrend, Distribution, HBars } from "@/components/dashboard/charts";
import { Funnel, Heatmap, PaceChart, SegmentBar, Sparkline, StackedDaily } from "@/components/dashboard/viz";
import { RAMP, yuan } from "@/lib/viz";
import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  CalendarX2,
  Inbox,
  KanbanSquare,
  Mail,
  MessageCircle,
  Minus,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { can, requireUser } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { getBadges } from "@/server/badges";
import { getOnboarding } from "@/server/onboarding";
import { OnboardingChecklist } from "@/components/onboarding/onboarding-checklist";
import { getRates } from "@/server/documents";
import { ownedWhere } from "@/server/scope";
import { docScopeWhere } from "@/server/documents";
import { CURRENCIES, LEAD_OPEN_STATUSES, countryName, dayRange, followMethodLabel, formatDateTime, formatMoney, parseLocalInput } from "@/lib/crm";
import { ORDER_NOT_COUNTED, dateInput } from "@/lib/docs";
import { COUNTRY_TZ, DEFAULT_CLOCK_COUNTRIES, DEFAULT_DASHBOARD } from "@/lib/dashboard";
import { OVERVIEW_ID, overviewLayout, sanitizeLayout } from "@/lib/canvas";
import { METRICS } from "@/lib/metrics";
import { canMetric } from "@/server/metrics";
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
  const [saved, spaces] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { dashboardCards: true, dashboardHome: true, dashboardPromptOff: true } }),
    db.workspace.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, layout: true } }),
  ]);
  // 画布上随时可能加任何卡片，所以每张卡片的数据都准备好
  const cards = DEFAULT_DASHBOARD;
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
    show("fx") || show("trend") || show("pipeline") ? getRates(user.tenantId) : null,
    // 世界时钟默认显示「我的客户」最多的国家
    show("clock") && canCustomers
      ? db.customer.groupBy({
          by: ["country"],
          where: { ...mine, country: { not: null } },
          _count: true,
          orderBy: { _count: { country: "desc" } },
          take: 12,
        })
      : [],
    show("trend") && canOrders
      ? db.order.findMany({
          where: { ...docScope, status: { notIn: [...ORDER_NOT_COUNTED] }, orderDate: { gte: trendStart } },
          select: { orderDate: true, total: true, exchangeRate: true },
        })
      : [],
    show("pipeline") && canOpps ? db.stage.findMany({ where: { kind: "OPEN" }, orderBy: { sort: "asc" }, select: { id: true, name: true } }) : [],
    show("pipeline") && canOpps
      ? db.opportunity.groupBy({ by: ["stageId", "currency"], where: { ...scoped, stage: { kind: "OPEN" } }, _count: true, _sum: { amount: true } })
      : [],
    show("distribution") && canCustomers ? db.customer.groupBy({ by: ["statusId"], where: mine, _count: true }) : [],
    show("distribution") && canCustomers ? db.customer.groupBy({ by: ["country"], where: mine, _count: true }) : [],
    show("distribution") && canCustomers ? db.customer.groupBy({ by: ["groupId"], where: mine, _count: true }) : [],
  ]);
  const [statusNames, groupNames] =
    show("distribution") && canCustomers
      ? await Promise.all([
          db.customerStatus.findMany({ select: { id: true, name: true } }),
          db.customerGroup.findMany({ select: { id: true, name: true } }),
        ])
      : [[], []];
  const nameOf = (rows: { id: string; name: string }[], id: string | null, none: string) => rows.find((r) => r.id === id)?.name ?? none;
  const trend = months.map((m) => ({
    label: `${Number(m.slice(5))}月`,
    value: trendOrders.filter((o) => monthKey.format(o.orderDate) === m).reduce((n, o) => n + Number(o.total) * Number(o.exchangeRate), 0),
  }));
  const trendTotal = trend.reduce((n, t) => n + t.value, 0);
  const pipeline = stages.map((st) => {
    const rows = oppByStage.filter((o) => o.stageId === st.id);
    const amount = rows.reduce((n, o) => n + Number(o._sum.amount ?? 0) * (rates?.[o.currency] ?? 0), 0);
    return { label: st.name, value: rows.reduce((n, o) => n + o._count, 0), note: amount ? yuan(amount) : undefined };
  });
  const clockCountries = topCountries
    .map((c) => c.country!)
    .filter((c) => COUNTRY_TZ[c] && c !== "CN")
    .slice(0, 6);

  // ── 可视化数据：按天分桶（企业时区） ──
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const lastDays = (n: number) => Array.from({ length: n }, (_, i) => dateInput(tz, i - n + 1));
  const byDay = (keys: string[], rows: { at: Date; v?: number }[]) => {
    const idx = new Map(keys.map((k, i) => [k, i]));
    const out = keys.map(() => 0);
    for (const r of rows) {
      const i = idx.get(dayFmt.format(r.at));
      if (i !== undefined) out[i] += r.v ?? 1;
    }
    return out;
  };
  const todayKey = dateInput(tz);
  const td = Number(todayKey.slice(8, 10));
  const lastMonthStart = parseLocalInput(`${months[4]}-01T00:00`, tz)!;
  const daysThis = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const daysPrev = new Date(Date.UTC(ty, tm - 1, 0)).getUTCDate();
  const k60 = lastDays(60);
  const since60 = parseLocalInput(`${k60[0]}T00:00`, tz)!;
  const dow = new Date(`${todayKey}T00:00:00Z`).getUTCDay();
  const heatKeys = lastDays(25 * 7 + ((dow + 6) % 7) + 1);
  const heatSince = parseLocalInput(`${heatKeys[0]}T00:00`, tz)!;
  const k14 = heatKeys.slice(-14);
  const canMail = can(user, "mail.use");
  const canWa = can(user, "whatsapp.use");
  const hero = show("hero") && canOrders;
  const msgSince = show("heatmap") ? heatSince : parseLocalInput(`${k14[0]}T00:00`, tz)!;
  const wantMsgs = show("heatmap") || show("comms");
  const notCounted = { notIn: [...ORDER_NOT_COUNTED] };
  const DAY = 86_400_000;
  const now = end.getTime(); // 以今天结束为基准，按天对齐

  const [heroOrders, heroPays, leads60, follows60, myFollows, myMails, myWas, funnel, health] = await Promise.all([
    hero
      ? db.order.findMany({
          where: { ...docScope, status: notCounted, orderDate: { gte: lastMonthStart } },
          select: { orderDate: true, total: true, exchangeRate: true },
        })
      : [],
    hero
      ? db.orderPayment.findMany({
          where: { receivedAt: { gte: since60 }, order: docScope },
          select: { receivedAt: true, amount: true, order: { select: { exchangeRate: true } } },
        })
      : [],
    hero && canLeads ? db.lead.findMany({ where: { ...scoped, createdAt: { gte: since60 } }, select: { createdAt: true } }) : [],
    hero && canCustomers
      ? db.activity.findMany({ where: { type: "FOLLOW_UP", customer: scoped, createdAt: { gte: since60 } }, select: { createdAt: true } })
      : [],
    show("heatmap")
      ? db.activity.findMany({ where: { type: "FOLLOW_UP", userId: user.id, createdAt: { gte: heatSince } }, select: { createdAt: true } })
      : [],
    wantMsgs && canMail
      ? db.mailMessage.findMany({ where: { account: { userId: user.id }, date: { gte: msgSince } }, select: { date: true, folder: true } })
      : [],
    wantMsgs && canWa
      ? db.waMessage.findMany({ where: { account: { userId: user.id }, timestamp: { gte: msgSince } }, select: { timestamp: true, fromMe: true } })
      : [],
    show("funnel")
      ? Promise.all([
          canLeads ? db.lead.count({ where: { ...scoped, createdAt: { gte: monthStart } } }) : null,
          canCustomers ? db.customer.count({ where: { ...scoped, createdAt: { gte: monthStart } } }) : null,
          canOpps ? db.opportunity.count({ where: { ...scoped, createdAt: { gte: monthStart } } }) : null,
          can(user, "quotation.view") ? db.quotation.count({ where: { ...docScope, quoteDate: { gte: monthStart } } }) : null,
          canOrders ? db.order.count({ where: { ...docScope, status: notCounted, orderDate: { gte: monthStart } } }) : null,
        ])
      : null,
    show("health") && canCustomers
      ? Promise.all([
          db.customer.count({ where: { ...mine, lastContactAt: { gte: new Date(now - 7 * DAY) } } }),
          db.customer.count({ where: { ...mine, lastContactAt: { gte: new Date(now - 30 * DAY), lt: new Date(now - 7 * DAY) } } }),
          db.customer.count({ where: { ...mine, lastContactAt: { gte: new Date(now - 90 * DAY), lt: new Date(now - 30 * DAY) } } }),
          db.customer.count({ where: { ...mine, lastContactAt: { lt: new Date(now - 90 * DAY) } } }),
          db.customer.count({ where: { ...mine, lastContactAt: null } }),
        ])
      : null,
  ]);

  // 本月 / 上月逐日累计成交（人民币）
  const cumulative = (ym: string, days: number) => {
    const daily = Array.from({ length: days }, () => 0);
    for (const o of heroOrders) {
      const k = dayFmt.format(o.orderDate);
      if (k.startsWith(ym)) daily[Number(k.slice(8, 10)) - 1] += Number(o.total) * Number(o.exchangeRate);
    }
    let run = 0;
    return daily.map((v) => (run += v));
  };
  const paceCur = cumulative(months[5], daysThis);
  const pacePrev = cumulative(months[4], daysPrev);
  const monthTotal = paceCur[td - 1] ?? 0;
  const prevSame = pacePrev[Math.min(td, daysPrev) - 1] ?? 0;
  const prevTotal = pacePrev[daysPrev - 1] ?? 0;
  const monthOrderCount = heroOrders.filter((o) => dayFmt.format(o.orderDate).startsWith(months[5])).length;
  const split30 = (vs: number[]) => ({ cur: vs.slice(30), prev: vs.slice(0, 30) });
  const pays = split30(
    byDay(
      k60,
      heroPays.map((p) => ({ at: p.receivedAt, v: Number(p.amount) * Number(p.order.exchangeRate) })),
    ),
  );
  const leadSeries = split30(
    byDay(
      k60,
      leads60.map((l) => ({ at: l.createdAt })),
    ),
  );
  const followSeries = split30(
    byDay(
      k60,
      follows60.map((f) => ({ at: f.createdAt })),
    ),
  );
  const total = (vs: number[]) => vs.reduce((n, v) => n + v, 0);
  const minis = [
    { label: "近 30 天回款", series: pays, fmt: (n: number) => formatMoney(n, "CNY"), href: "/payments" },
    canLeads && { label: "近 30 天新询盘", series: leadSeries, fmt: String, href: "/leads" },
    canCustomers && { label: "近 30 天跟进", series: followSeries, fmt: String, href: "/customers" },
  ].filter(Boolean) as { label: string; series: { cur: number[]; prev: number[] }; fmt: (n: number) => string; href: string }[];

  // 活跃度与沟通量
  const mailRows = myMails.map((m) => ({ at: m.date, out: m.folder === "SENT" }));
  const waRows = myWas.map((m) => ({ at: m.timestamp, out: m.fromMe }));
  const heatFollow = byDay(
    heatKeys,
    myFollows.map((f) => ({ at: f.createdAt })),
  );
  const heatMail = byDay(
    heatKeys,
    mailRows.filter((m) => m.out),
  );
  const heatWa = byDay(
    heatKeys,
    waRows.filter((m) => m.out),
  );
  const heatDays = heatKeys.map((key, i) => ({
    key,
    total: heatFollow[i] + heatMail[i] + heatWa[i],
    parts: [
      ["跟进", heatFollow[i]],
      ["邮件", heatMail[i]],
      ["WhatsApp", heatWa[i]],
    ] as [string, number][],
  }));
  const commsSeries = [
    canMail && {
      label: "邮件发出",
      color: "var(--chart-1)",
      values: byDay(
        k14,
        mailRows.filter((m) => m.out),
      ),
    },
    canMail && {
      label: "邮件收到",
      color: "var(--chart-2)",
      values: byDay(
        k14,
        mailRows.filter((m) => !m.out),
      ),
    },
    canWa && {
      label: "WA 发出",
      color: "var(--chart-3)",
      values: byDay(
        k14,
        waRows.filter((m) => m.out),
      ),
    },
    canWa && {
      label: "WA 收到",
      color: "var(--chart-4)",
      values: byDay(
        k14,
        waRows.filter((m) => !m.out),
      ),
    },
  ].filter(Boolean) as { label: string; color: string; values: number[] }[];

  const [myCustomers, dueCustomers, poolSoonCustomers, tasks, overdueTasks, openOpps, newLeads, unassignedLeads, recent, monthOrders] =
    await Promise.all([
      canCustomers ? db.customer.count({ where: mine }) : 0,
      canCustomers ? db.customer.count({ where: { ...mine, nextFollowAt: { lt: end } } }) : 0,
      canCustomers ? db.customer.count({ where: { ...mine, poolDueAt: { lt: new Date(end.getTime() + 7 * 86_400_000) } } }) : 0,
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
    canCustomers && {
      icon: Building2,
      label: "我的客户",
      value: myCustomers,
      hint: `${poolSoonCustomers} 个 7 天内将进公海`,
      href: "/customers?follow=soon",
    },
    canCustomers && {
      icon: CalendarClock,
      label: "今天待跟进客户",
      value: dueCustomers,
      hint: "含已逾期",
      href: "/customers?follow=due",
      alert: dueCustomers > 0,
    },
    { icon: CalendarX2, label: "逾期日程", value: overdueTasks, hint: "未完成且已过时间", href: "/todo?view=list", alert: overdueTasks > 0 },
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
      badges && {
        icon: MessageCircle,
        label: "WhatsApp 未读",
        value: badges.whatsapp,
        hint: "我的会话",
        href: "/whatsapp",
        alert: badges.whatsapp > 0,
      },
  ].filter(Boolean) as { icon: LucideIcon; label: string; value: number; hint: string; href: string; alert?: boolean }[];

  const hotStat = stats.findIndex((s) => s.alert);

  const blocks: Record<(typeof cards)[number], React.ReactNode> = {
    hero: hero ? (
      <section className="surface relative overflow-hidden p-4 md:p-6">
        <div className="relative grid gap-5 @3xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] @3xl:gap-8">
          <div className="flex flex-col">
            <p className="text-sm text-muted-foreground">本月成交 · 折合人民币</p>
            <p className="mt-1.5 text-[44px] leading-none font-light tracking-[-0.03em] @xl:text-[56px]">{formatMoney(monthTotal, "CNY")}</p>
            <Delta cur={monthTotal} base={prevSame} label="较上月同期" className="mt-3" />
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-sm @3xl:mt-auto">
              <div>
                <dt className="text-xs text-muted-foreground">本月订单</dt>
                <dd className="mt-0.5 font-medium">{monthOrderCount} 单</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">上月全月</dt>
                <dd className="mt-0.5 font-medium">{formatMoney(prevTotal, "CNY")}</dd>
              </div>
            </dl>
          </div>
          <PaceChart cur={paceCur} prev={pacePrev} today={td} />
        </div>
        {minis.length > 0 && (
          <div className="relative mt-5 grid gap-x-6 gap-y-4 border-t pt-4 @xl:grid-cols-3">
            {minis.map((m) => (
              <Link
                key={m.label}
                href={m.href}
                className="group -m-2 grid grid-cols-[minmax(0,1fr)_5.5rem] items-end gap-3 rounded-xl p-2 hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block text-xs text-muted-foreground">{m.label}</span>
                  <span className="mt-0.5 block truncate text-xl leading-tight font-normal">{m.fmt(total(m.series.cur))}</span>
                  <Delta cur={total(m.series.cur)} base={total(m.series.prev)} label="较前 30 天" className="mt-1" small />
                </span>
                <Sparkline values={m.series.cur} label={`${m.label}逐日走势`} className="mb-1" />
              </Link>
            ))}
          </div>
        )}
      </section>
    ) : null,
    funnel: funnel ? (
      <Card>
        <CardHeader>
          <CardTitle>本月转化漏斗</CardTitle>
          <CardDescription>本月新增的数量，箭头处是相邻两步的比例</CardDescription>
        </CardHeader>
        <CardContent>
          <Funnel
            steps={(
              [
                ["询盘", funnel[0], "/leads"],
                ["客户", funnel[1], "/customers"],
                ["商机", funnel[2], "/opportunities"],
                ["报价", funnel[3], "/quotations"],
                ["订单", funnel[4], "/orders"],
              ] as const
            )
              .filter(([, v]) => v !== null)
              .map(([label, value, href]) => ({ label, value: value ?? 0, href }))}
          />
        </CardContent>
      </Card>
    ) : null,
    heatmap: (
      <Card>
        <CardHeader>
          <CardTitle>我的活跃度</CardTitle>
          <CardDescription>每天写跟进、发邮件、发 WhatsApp 的次数</CardDescription>
        </CardHeader>
        <CardContent>
          <Heatmap days={heatDays} today={todayKey} />
        </CardContent>
      </Card>
    ),
    comms:
      commsSeries.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>沟通量</CardTitle>
            <CardDescription>近 14 天，我的邮箱和 WhatsApp</CardDescription>
          </CardHeader>
          <CardContent>
            <StackedDaily labels={k14.map((k) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`)} series={commsSeries} />
          </CardContent>
        </Card>
      ) : null,
    health: health ? (
      <Card>
        <CardHeader>
          <CardTitle>客户健康度</CardTitle>
          <CardDescription>我的 {myCustomers} 家客户，按最近一次联系</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <SegmentBar
            unit=" 家"
            parts={[
              { label: "7 天内", value: health[0], color: "var(--brand)" },
              { label: "30 天内", value: health[1], color: RAMP[2], dark: true },
              { label: "90 天内", value: health[2], color: RAMP[1] },
              { label: "超过 90 天", value: health[3], color: RAMP[0] },
              { label: "从未联系", value: health[4], color: "oklch(0.9 0 0)" },
            ]}
          />
          <div className="space-y-3 border-t pt-4">
            {(
              [
                ["今天该跟进", dueCustomers, "/customers?follow=due", "bg-[var(--chart-3)]"],
                ["7 天内进公海", poolSoonCustomers, "/customers?follow=soon", "bg-destructive"],
              ] as const
            ).map(([label, v, href, bar]) => (
              <Link key={label} href={href} className="-mx-1.5 block rounded-md px-1.5 py-1 hover:bg-muted/60">
                <span className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span>
                    <span className="font-medium">{v}</span>
                    <span className="text-xs text-muted-foreground"> / {myCustomers}</span>
                  </span>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full", bar)} style={{ width: `${myCustomers ? (v / myCustomers) * 100 : 0}%` }} />
                </span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    ) : null,
    overview: (
      <section className="grid grid-cols-2 content-start gap-3 md:gap-4 @4xl:grid-cols-4">
        {stats.map((s, i) => {
          // 第一张需要处理的卡片用强调橙，其余保持白底
          const hot = i === hotStat;
          return (
            <Link
              key={s.label}
              href={s.href}
              className={cn(
                "group relative flex flex-col gap-3 rounded-2xl p-4 shadow-card transition-[box-shadow,translate] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-16px_oklch(0_0_0/0.22)] md:p-5",
                hot ? "bg-brand text-brand-foreground" : "bg-card",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span
                  className={cn("flex min-w-0 items-center gap-2 text-[13px] md:text-sm", hot ? "text-brand-foreground/90" : "text-muted-foreground")}
                >
                  <s.icon className="size-4 shrink-0" />
                  <span className="truncate">{s.label}</span>
                </span>
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
                    hot
                      ? "bg-brand-foreground/20 group-hover:bg-brand-foreground group-hover:text-brand"
                      : "border border-border group-hover:bg-primary group-hover:text-primary-foreground",
                  )}
                >
                  <ArrowUpRight className="size-4" />
                </span>
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-[32px] leading-none font-light tracking-[-0.02em] tabular-nums md:text-[40px]">{s.value}</span>
                {s.alert && !hot && <span className="size-2 rounded-full bg-destructive" aria-label="需要处理" />}
              </span>
              <span className={cn("block truncate text-xs tabular-nums", hot ? "text-brand-foreground/85" : "text-muted-foreground")}>{s.hint}</span>
            </Link>
          );
        })}
      </section>
    ),
    today: (
      <Card>
        <CardHeader>
          <CardTitle>今天要做</CardTitle>
          <CardAction>
            <Link
              href="/todo?view=list"
              aria-label="全部日程"
              title="全部日程"
              className="flex size-9 items-center justify-center rounded-full border border-border text-foreground/75 transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              <ArrowUpRight className="size-4" />
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
              kind: t.kind,
              note: t.note,
              link: t.link,
              snoozeCount: t.snoozeCount,
            }))}
          />
        </CardContent>
      </Card>
    ),
    trend: canOrders ? (
      <Card>
        <CardHeader>
          <CardTitle>成交趋势</CardTitle>
          <CardAction>
            <span className="text-sm text-muted-foreground">
              近 6 个月合计 <span className="font-medium text-foreground tabular-nums">{formatMoney(trendTotal, "CNY")}</span>
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
          <CardTitle>商机阶段</CardTitle>
          <CardAction>
            <Link href="/opportunities" className="text-sm text-muted-foreground hover:text-primary">
              查看看板
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          <HBars data={pipeline} empty="还没有进行中的商机" />
          {pipeline.some((p) => p.note) && <p className="mt-3 text-xs text-muted-foreground">右侧金额为该阶段商机金额合计，按汇率折合人民币</p>}
        </CardContent>
      </Card>
    ) : null,
    distribution: canCustomers ? (
      <Card>
        <CardHeader>
          <CardTitle>客户分布</CardTitle>
        </CardHeader>
        <CardContent>
          <Distribution
            dims={[
              { key: "status", label: "状态", data: byStatus.map((r) => ({ label: nameOf(statusNames, r.statusId, "未设置"), value: r._count })) },
              {
                key: "country",
                label: "国家",
                data: byCountry.map((r) => ({ label: r.country ? countryName(r.country) : "未填写", value: r._count })),
              },
              { key: "group", label: "分组", data: byGroup.map((r) => ({ label: nameOf(groupNames, r.groupId, "未分组"), value: r._count })) },
            ]}
          />
        </CardContent>
      </Card>
    ) : null,
    recent: canCustomers ? (
      <Card>
        <CardHeader>
          <CardTitle>最近跟进</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState compact>还没有跟进记录</EmptyState>
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
          <CardTitle>世界时钟</CardTitle>
        </CardHeader>
        <CardContent>
          <WorldClock suggested={clockCountries.length ? clockCountries : DEFAULT_CLOCK_COUNTRIES} localTz={tz} />
        </CardContent>
      </Card>
    ),
    fx: (
      <Card>
        <CardHeader>
          <CardTitle>汇率换算</CardTitle>
        </CardHeader>
        <CardContent>
          <FxCalculator rates={rates ?? { CNY: 1 }} currencies={CURRENCIES} />
        </CardContent>
      </Card>
    ),
  };

  const available = cards.filter((k) => blocks[k] != null);
  // 业务组件（按对象打开）：有对应权限才能用
  const business = [
    canWa && "whatsapp",
    canCustomers && "customer",
    canCustomers && "followups",
    can(user, "report.view") && "team",
    METRICS.some((m) => canMetric(user, m.key)) && "chart",
  ].filter((x): x is string => !!x);

  const onboarding = await getOnboarding(user);
  const aiOn = can(user, "ai.use") && aiConfigured();

  const sub = [user.tenantName, user.departmentName && user.departmentName !== user.tenantName ? user.departmentName : null, user.roleName]
    .filter(Boolean)
    .join(" · ");
  const page = (
    <>
      <PageHeader title={`你好，${user.name}`} description={sub} className={aiOn ? "hidden" : undefined} />
      {onboarding && <OnboardingChecklist steps={onboarding} />}
      <WorkspaceCanvas
        blocks={Object.fromEntries(available.map((k) => [k, blocks[k]]))}
        available={[...available, ...business]}
        tz={tz}
        metrics={METRICS.filter((m) => canMetric(user, m.key)).map((m) => m.key)}
        overview={overviewLayout(saved?.dashboardCards)}
        workspaces={spaces.map((w) => ({ id: w.id, name: w.name, layout: sanitizeLayout(w.layout) }))}
        home={saved?.dashboardHome === OVERVIEW_ID || spaces.some((w) => w.id === saved?.dashboardHome) ? saved!.dashboardHome : null}
        promptOff={saved?.dashboardPromptOff ?? false}
      />
    </>
  );
  // 能用 AI 时，电脑端工作台以 AI 对话为主角（见 AiStage）
  return aiOn ? (
    <AiStage greeting={`你好，${user.name}`} sub={sub}>
      {page}
    </AiStage>
  ) : (
    page
  );
}

/** 环比：图标 + 文字，不只靠颜色 */
function Delta({ cur, base, label, className, small }: { cur: number; base: number; label: string; className?: string; small?: boolean }) {
  // 基数为 0：有数就是「新增」，算上涨
  const pct = base ? Math.round(((cur - base) / base) * 100) : cur > 0 ? Infinity : 0;
  const Icon = pct === 0 ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  return (
    <p className={cn("flex items-center gap-1.5", small ? "text-xs" : "text-sm", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-px font-medium tabular-nums",
          pct === 0 ? "bg-muted text-muted-foreground" : pct > 0 ? "bg-emerald-500/12 text-emerald-700" : "bg-destructive/10 text-destructive",
        )}
      >
        <Icon className={small ? "size-3" : "size-3.5"} />
        {pct === Infinity ? "新增" : pct === 0 ? "持平" : `${pct > 0 ? "+" : ""}${pct}%`}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </p>
  );
}
