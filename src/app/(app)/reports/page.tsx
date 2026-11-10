import type { Metadata } from "next";
import { MobileCard, MobileList } from "@/components/crm/mobile-list";
import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { scopeMembers, scopeOwnerIds } from "@/server/scope";
import { FOLLOW_METHODS, formatMoney, parseLocalInput, toLocalInput } from "@/lib/crm";
import { FileText, Inbox, MessagesSquare, ShoppingCart, UserPlus, Wallet, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BarTrend, Donut } from "@/components/dashboard/charts";
import { Funnel, MatrixHeat, RankSwitch } from "@/components/dashboard/viz";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ORDER_NOT_COUNTED, QUOTATION_STATUSES } from "@/lib/docs";

export const metadata: Metadata = { title: "团队数据" };

const PRESETS = [
  { key: "month", label: "本月" },
  { key: "last-month", label: "上月" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "quarter", label: "本季度" },
  { key: "year", label: "今年" },
] as const;

/** 按企业时区算出统计区间 [start, end) */
function resolveRange(sp: Record<string, string | string[] | undefined>, tz: string) {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const today = toLocalInput(new Date(), tz, false); // yyyy-mm-dd
  const [y, m] = today.split("-").map(Number);
  const ymd = (yy: number, mm: number, dd = 1) => {
    const d = new Date(Date.UTC(yy, mm - 1, dd));
    return d.toISOString().slice(0, 10);
  };
  const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const from = one("from");
  const to = one("to");
  let key = one("range") ?? "month";
  let a: string;
  let b: string; // 含当天
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    key = "custom";
    [a, b] = from <= to ? [from, to] : [to, from];
  } else if (key === "last-month") {
    a = ymd(y, m - 1);
    b = addDays(ymd(y, m), -1);
  } else if (key === "7d") {
    a = addDays(today, -6);
    b = today;
  } else if (key === "30d") {
    a = addDays(today, -29);
    b = today;
  } else if (key === "quarter") {
    a = ymd(y, Math.floor((m - 1) / 3) * 3 + 1);
    b = today;
  } else if (key === "year") {
    a = ymd(y, 1);
    b = today;
  } else {
    key = "month";
    a = ymd(y, m);
    b = today;
  }
  const start = parseLocalInput(`${a}T00:00`, tz)!;
  const end = parseLocalInput(`${addDays(b, 1)}T00:00`, tz)!;
  return { key, from: a, to: b, start, end };
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const user = await requirePermission("report.view");
  const sp = await searchParams;
  const tz = user.timezone;
  const range = resolveRange(sp, tz);
  const ids = await scopeOwnerIds(user);
  const members = await scopeMembers(user);
  const t = user.tenantId;
  const when = { gte: range.start, lt: range.end };
  const owner = ids ? { ownerId: { in: ids } } : {};
  const byUser = ids ? { userId: { in: ids } } : {};

  const [leads, customers, quotes, orders, payments, follows, mails, was] = await Promise.all([
    prisma.lead.findMany({ where: { tenantId: t, createdAt: when, ...owner }, select: { source: true, status: true, ownerId: true } }),
    prisma.customer.findMany({ where: { tenantId: t, createdAt: when, ...owner }, select: { ownerId: true, source: true } }),
    prisma.quotation.findMany({
      where: { tenantId: t, quoteDate: when, ...owner },
      select: { ownerId: true, status: true, total: true, exchangeRate: true },
    }),
    prisma.order.findMany({
      where: { tenantId: t, orderDate: when, status: { notIn: [...ORDER_NOT_COUNTED] }, ...owner },
      select: { ownerId: true, total: true, exchangeRate: true, orderDate: true },
    }),
    prisma.orderPayment.findMany({
      where: { tenantId: t, receivedAt: when, ...(ids ? { order: { ownerId: { in: ids } } } : {}) },
      select: { amount: true, order: { select: { ownerId: true, exchangeRate: true } } },
    }),
    prisma.activity.findMany({
      where: { tenantId: t, type: "FOLLOW_UP", createdAt: when, ...byUser },
      select: { userId: true, method: true, createdAt: true },
    }),
    prisma.mailMessage.findMany({
      where: { tenantId: t, date: when, ...(ids ? { account: { userId: { in: ids } } } : {}) },
      select: { folder: true, customerId: true, date: true, account: { select: { userId: true } } },
    }),
    prisma.waMessage.findMany({
      where: { tenantId: t, timestamp: when, ...(ids ? { account: { userId: { in: ids } } } : {}) },
      select: { fromMe: true, timestamp: true, account: { select: { userId: true } } },
    }),
  ]);

  const cny = (amount: unknown, rate: unknown) => Number(amount) * Number(rate);
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const quoteAmount = sum(quotes.map((q) => cny(q.total, q.exchangeRate)));
  const orderAmount = sum(orders.map((o) => cny(o.total, o.exchangeRate)));
  const paidAmount = sum(payments.map((p) => cny(p.amount, p.order.exchangeRate)));
  const converted = leads.filter((l) => l.status === "CONVERTED").length;
  const mailIn = mails.filter((m) => m.folder === "INBOX").length;
  const mailOut = mails.length - mailIn;
  const waIn = was.filter((m) => !m.fromMe).length;
  const waOut = was.length - waIn;

  // 线索来源
  const sources = new Map<string, { total: number; converted: number }>();
  for (const l of leads) {
    const k = l.source || "未填写";
    const s = sources.get(k) ?? { total: 0, converted: 0 };
    s.total++;
    if (l.status === "CONVERTED") s.converted++;
    sources.set(k, s);
  }
  const sourceRows = [...sources.entries()].sort((a, b) => b[1].total - a[1].total);

  const methodRows = FOLLOW_METHODS.map((m) => ({ label: m.label, value: follows.filter((f) => f.method === m.value).length }));
  const quoteStatus = QUOTATION_STATUSES.map((s) => ({ label: s.label, value: quotes.filter((q) => q.status === s.value).length }));

  // 成交趋势：≤14 天按天，≤92 天按周，再长按月（都按企业时区落桶）
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
  const unit = days <= 14 ? "day" : days <= 92 ? "week" : "month";
  const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  const dayAt = (i: number) => new Date(Date.parse(`${range.from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
  const buckets: { key: string; label: string; value: number }[] = [];
  if (unit === "month") {
    for (let k = range.from.slice(0, 7); k <= range.to.slice(0, 7);) {
      buckets.push({ key: k, label: `${Number(k.slice(5))}月`, value: 0 });
      const [yy, mm] = k.split("-").map(Number);
      k = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, "0")}`;
    }
  } else {
    const step = unit === "day" ? 1 : 7;
    for (let i = 0; i < days; i += step) buckets.push({ key: String(i / step), label: md(dayAt(i)), value: 0 });
  }
  for (const o of orders) {
    const d = toLocalInput(o.orderDate, tz, false);
    const key =
      unit === "month" ? d.slice(0, 7) : String(Math.floor((Date.parse(d) - Date.parse(range.from)) / 86_400_000 / (unit === "day" ? 1 : 7)));
    const b = buckets.find((x) => x.key === key);
    if (b) b.value += cny(o.total, o.exchangeRate);
  }
  const unitLabel = { day: "按天", week: "按周（标签为每周第一天）", month: "按月" }[unit];

  // 团队业绩
  const team = members
    .map((u) => {
      const mine = <T extends { ownerId: string | null }>(xs: T[]) => xs.filter((x) => x.ownerId === u.id);
      return {
        id: u.id,
        name: u.name,
        leads: mine(leads).length,
        customers: mine(customers).length,
        follows: follows.filter((f) => f.userId === u.id).length,
        mailsOut: mails.filter((m) => m.folder === "SENT" && m.account.userId === u.id).length,
        waOut: was.filter((m) => m.fromMe && m.account.userId === u.id).length,
        quotes: mine(quotes).length,
        orders: mine(orders).length,
        orderAmount: sum(mine(orders).map((o) => cny(o.total, o.exchangeRate))),
        paid: sum(payments.filter((p) => p.order.ownerId === u.id).map((p) => cny(p.amount, p.order.exchangeRate))),
      };
    })
    .sort((a, b) => b.orderAmount - a.orderAmount || b.follows - a.follows);
  const teamMaxAmount = Math.max(1, ...team.map((x) => x.orderAmount));

  // 成员 × 天的活跃度（跟进 + 发邮件 + 发 WA），区间太长时只看最后 42 天
  const heatDays = Math.min(days, 42);
  const heatKeys = Array.from({ length: heatDays }, (_, i) => dayAt(days - heatDays + i));
  const heatIndex = new Map(heatKeys.map((k, i) => [k, i]));
  const heatRows = team.map((u) => ({ id: u.id, label: u.name, values: heatKeys.map(() => 0) }));
  const bump = (userId: string | null | undefined, at: Date) => {
    const row = heatRows.find((r) => r.id === userId);
    const i = heatIndex.get(toLocalInput(at, tz, false));
    if (row && i !== undefined) row.values[i]++;
  };
  for (const f of follows) bump(f.userId, f.createdAt);
  for (const m of mails) if (m.folder === "SENT") bump(m.account.userId, m.date);
  for (const m of was) if (m.fromMe) bump(m.account.userId, m.timestamp);
  const rankMetrics = [
    { key: "amount", label: "成交额", money: true, rows: team.map((u) => ({ label: u.name, value: u.orderAmount })) },
    { key: "paid", label: "回款", money: true, rows: team.map((u) => ({ label: u.name, value: u.paid })) },
    { key: "follows", label: "跟进", unit: " 次", rows: team.map((u) => ({ label: u.name, value: u.follows })) },
    { key: "mails", label: "发邮件", unit: " 封", rows: team.map((u) => ({ label: u.name, value: u.mailsOut })) },
    { key: "wa", label: "WhatsApp", unit: " 条", rows: team.map((u) => ({ label: u.name, value: u.waOut })) },
    { key: "quotes", label: "报价", unit: " 份", rows: team.map((u) => ({ label: u.name, value: u.quotes })) },
    { key: "leads", label: "询盘", unit: " 条", rows: team.map((u) => ({ label: u.name, value: u.leads })) },
  ];

  const money = (n: number) => formatMoney(n, "CNY");
  const kpis: { icon: LucideIcon; label: string; value: number | string; hint?: string; strong?: boolean }[] = [
    { icon: Inbox, label: "新增询盘", value: leads.length, hint: `已转客户 ${converted} · ${pct(converted, leads.length)}` },
    { icon: UserPlus, label: "新增客户", value: customers.length, hint: "期间新建档" },
    { icon: MessagesSquare, label: "跟进次数", value: follows.length, hint: `邮件 ${mailOut} · WA ${waOut} 条发出` },
    { icon: FileText, label: "报价单", value: quotes.length, hint: money(quoteAmount) },
    { icon: ShoppingCart, label: "成交订单", value: orders.length, hint: money(orderAmount), strong: true },
    { icon: Wallet, label: "回款", value: money(paidAmount), hint: `占成交额 ${pct(paidAmount, orderAmount)}` },
  ];

  return (
    <>
      <PageHeader
        title="团队数据"
        description={`${range.from} 至 ${range.to} · ${ids ? `数据范围内 ${members.length} 名成员` : "全公司"} · 金额按单据汇率折合人民币`}
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
            <nav
              className="inline-flex max-w-full overflow-x-auto rounded-full bg-muted p-1 ring-1 ring-border/60 [scrollbar-width:none]"
              aria-label="统计区间"
            >
              {PRESETS.map((p) => (
                <Link
                  key={p.key}
                  href={`/reports?range=${p.key}`}
                  aria-current={range.key === p.key ? "page" : undefined}
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-colors sm:px-3",
                    range.key === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </Link>
              ))}
            </nav>
            <form className="flex w-full items-center gap-1.5 sm:w-auto" action="/reports">
              <Input type="date" name="from" defaultValue={range.from} className="h-8 min-w-0 flex-1 sm:w-36 sm:flex-none" aria-label="开始日期" />
              <span className="text-muted-foreground">–</span>
              <Input type="date" name="to" defaultValue={range.to} className="h-8 min-w-0 flex-1 sm:w-36 sm:flex-none" aria-label="结束日期" />
              <Button size="sm" variant={range.key === "custom" ? "default" : "outline"}>
                查询
              </Button>
            </form>
          </div>
        }
      />

      <div className="space-y-3 md:space-y-4">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
          {kpis.map((k) => (
            <div key={k.label} className="surface flex min-w-0 flex-col gap-2.5 p-3.5 md:gap-3 md:p-5">
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-xl",
                  k.strong ? "bg-primary text-primary-foreground" : "bg-accent text-primary",
                )}
              >
                <k.icon className="size-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-muted-foreground">{k.label}</span>
                <span className="mt-0.5 block truncate text-xl leading-tight md:text-[26px] font-normal tabular-nums">{k.value}</span>
                {k.hint && <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">{k.hint}</span>}
              </span>
            </div>
          ))}
        </section>

        <div className="grid gap-3 md:gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader>
              <CardTitle>成交趋势</CardTitle>
              <CardDescription>订单金额（人民币），{unitLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <BarTrend data={buckets} currency="CNY" empty="这段时间没有成交订单" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>跟进方式</CardTitle>
              <CardDescription>共 {follows.length} 次跟进</CardDescription>
            </CardHeader>
            <CardContent>
              <Donut data={methodRows} unit=" 次" empty="这段时间没有跟进记录" />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-3 md:gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>询盘来源与转化</CardTitle>
              <CardDescription>浅色为询盘数，深色为已转客户</CardDescription>
            </CardHeader>
            <CardContent>
              {sourceRows.length === 0 ? (
                <Empty />
              ) : (
                <ul className="space-y-3.5">
                  {sourceRows.map(([k, s]) => (
                    <li key={k}>
                      <div className="mb-1.5 flex justify-between gap-2 text-sm">
                        <span className="truncate">{k}</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          <span className="font-medium text-foreground">{s.total}</span> 条 · 转化 {pct(s.converted, s.total)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bar-stripes" style={{ width: `${(s.total / sourceRows[0][1].total) * 100}%` }}>
                          <div
                            className="h-full rounded-full bg-[var(--chart-1)]"
                            style={{ width: `${s.total ? (s.converted / s.total) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>沟通量</CardTitle>
              <CardDescription>邮件与 WhatsApp 消息条数</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Pair label="邮件" out={mailOut} inn={mailIn} />
              <Pair label="WhatsApp" out={waOut} inn={waIn} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>报价单状态</CardTitle>
              <CardDescription>
                共 {quotes.length} 张 · {money(quoteAmount)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Donut data={quoteStatus} unit=" 张" empty="这段时间没有报价单" />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader>
              <CardTitle>成员对比</CardTitle>
              <CardDescription>切换指标看谁领先</CardDescription>
            </CardHeader>
            <CardContent>
              <RankSwitch metrics={rankMetrics} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>销售漏斗</CardTitle>
              <CardDescription>区间内各环节数量与环比转化</CardDescription>
            </CardHeader>
            <CardContent>
              <Funnel
                steps={[
                  { label: "新增询盘", value: leads.length, href: "/leads?tab=all" },
                  { label: "新增客户", value: customers.length, href: "/customers" },
                  { label: "发出报价", value: quotes.filter((q) => q.status !== "DRAFT").length, href: "/quotations" },
                  { label: "成交订单", value: orders.length, href: "/orders" },
                ]}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>成员每日活跃</CardTitle>
            <CardDescription>跟进 + 发邮件 + 发 WhatsApp 的次数{days > heatDays ? `，只显示最后 ${heatDays} 天` : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            <MatrixHeat rows={heatRows} labels={heatKeys.map(md)} />
          </CardContent>
        </Card>

        <section className="overflow-hidden surface">
          <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-1 md:px-5 md:pt-5 md:pb-3">
            <h2 className="text-base font-medium">团队业绩</h2>
            <span className="text-xs text-muted-foreground">按成交额排序</span>
          </div>
          <MobileList empty="暂无成员数据">
            {team.map((r, i) => (
              <MobileCard
                key={r.id}
                leading={<Rank i={i} on={r.orderAmount > 0} />}
                title={r.name}
                aside={
                  <span className={cn("text-sm font-medium tabular-nums", !r.orderAmount && "font-normal text-muted-foreground/60")}>
                    {money(r.orderAmount)}
                  </span>
                }
                sub={`${r.orders} 单 · 回款 ${money(r.paid)}`}
              >
                <div className="mb-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${(r.orderAmount / teamMaxAmount) * 100}%` }} />
                </div>
                <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[13px]">
                  {(
                    [
                      ["询盘", r.leads],
                      ["新客户", r.customers],
                      ["跟进", r.follows],
                      ["发邮件", r.mailsOut],
                      ["发 WA", r.waOut],
                      ["报价", r.quotes],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className={cn("tabular-nums", !v && "text-muted-foreground/60")}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </MobileCard>
            ))}
          </MobileList>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>成员</TableHead>
                  <TableHead className="text-right">询盘</TableHead>
                  <TableHead className="text-right">新客户</TableHead>
                  <TableHead className="text-right">跟进</TableHead>
                  <TableHead className="text-right">发邮件</TableHead>
                  <TableHead className="text-right">发 WA</TableHead>
                  <TableHead className="text-right">报价</TableHead>
                  <TableHead className="text-right">订单</TableHead>
                  <TableHead className="w-64">成交额</TableHead>
                  <TableHead className="text-right">回款</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="flex items-center gap-2.5 font-medium">
                        <Rank i={i} on={r.orderAmount > 0} />
                        {r.name}
                      </span>
                    </TableCell>
                    <Num v={r.leads} />
                    <Num v={r.customers} />
                    <Num v={r.follows} />
                    <Num v={r.mailsOut} />
                    <Num v={r.waOut} />
                    <Num v={r.quotes} />
                    <Num v={r.orders} />
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${(r.orderAmount / teamMaxAmount) * 100}%` }} />
                        </div>
                        <span className={cn("w-28 text-right text-sm tabular-nums", r.orderAmount > 0 ? "font-medium" : "text-muted-foreground/60")}>
                          {money(r.orderAmount)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", !r.paid && "text-muted-foreground/60")}>{money(r.paid)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </>
  );
}

function Rank({ i, on }: { i: number; on: boolean }) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums",
        i < 3 && on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {i + 1}
    </span>
  );
}

function pct(a: number, b: number) {
  return b ? `${Math.round((a / b) * 100)}%` : "—";
}

/** 发出 / 收到 两条对比条，共用同一最大值 */
function Pair({ label, out, inn }: { label: string; out: number; inn: number }) {
  const max = Math.max(1, out, inn);
  const row = (name: string, v: number, cls: string) => (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
      <span className="text-muted-foreground">{name}</span>
      <span className="h-2 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", cls)} style={{ width: `${(v / max) * 100}%` }} />
      </span>
      <span className="text-right font-medium tabular-nums">{v}</span>
    </li>
  );
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <ul className="space-y-2">
        {row("发出", out, "bg-[var(--chart-1)]")}
        {row("收到", inn, "bg-[var(--chart-2)]")}
      </ul>
    </div>
  );
}

function Num({ v }: { v: number }) {
  return <TableCell className={cn("text-right tabular-nums", v === 0 && "text-muted-foreground/60")}>{v}</TableCell>;
}

function Empty() {
  return <p className="py-6 text-center text-sm text-muted-foreground">这段时间没有数据</p>;
}
