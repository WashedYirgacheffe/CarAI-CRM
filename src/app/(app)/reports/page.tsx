import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { scopeMembers, scopeOwnerIds } from "@/server/scope";
import { FOLLOW_METHODS, formatMoney, parseLocalInput, toLocalInput } from "@/lib/crm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ORDER_NOT_COUNTED, QUOTATION_STATUSES } from "@/lib/docs";

export const metadata: Metadata = { title: "统计" };

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
      select: { ownerId: true, total: true, exchangeRate: true },
    }),
    prisma.orderPayment.findMany({
      where: { tenantId: t, receivedAt: when, ...(ids ? { order: { ownerId: { in: ids } } } : {}) },
      select: { amount: true, order: { select: { ownerId: true, exchangeRate: true } } },
    }),
    prisma.activity.findMany({ where: { tenantId: t, type: "FOLLOW_UP", createdAt: when, ...byUser }, select: { userId: true, method: true } }),
    prisma.mailMessage.findMany({
      where: { tenantId: t, date: when, ...(ids ? { account: { userId: { in: ids } } } : {}) },
      select: { folder: true, customerId: true, account: { select: { userId: true } } },
    }),
    prisma.waMessage.findMany({
      where: { tenantId: t, timestamp: when, ...(ids ? { account: { userId: { in: ids } } } : {}) },
      select: { fromMe: true, account: { select: { userId: true } } },
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

  const methodRows = FOLLOW_METHODS.map((m) => ({ label: m.label, value: follows.filter((f) => f.method === m.value).length })).filter(
    (x) => x.value > 0,
  );
  const quoteStatus = QUOTATION_STATUSES.map((s) => ({ label: s.label, value: quotes.filter((q) => q.status === s.value).length }))
    .filter((x) => x.value > 0);

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

  const money = (n: number) => formatMoney(n, "CNY");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">统计</h1>
          <p className="text-sm text-muted-foreground">
            {range.from} 至 {range.to} · {ids ? `数据范围内 ${members.length} 名成员` : "全公司"} · 金额按单据汇率折合人民币
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border p-0.5 text-sm">
            {PRESETS.map((p) => (
              <Link
                key={p.key}
                href={`/reports?range=${p.key}`}
                className={cn("rounded px-2.5 py-1", range.key === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {p.label}
              </Link>
            ))}
          </div>
          <form className="flex items-center gap-1 text-sm" action="/reports">
            <input type="date" name="from" defaultValue={range.from} className="h-8 rounded-md border bg-background px-2" aria-label="开始日期" />
            <span className="text-muted-foreground">–</span>
            <input type="date" name="to" defaultValue={range.to} className="h-8 rounded-md border bg-background px-2" aria-label="结束日期" />
            <button className="h-8 rounded-md border px-2.5 hover:bg-muted">查询</button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="新增询盘" value={leads.length} hint={`已转客户 ${converted}（${pct(converted, leads.length)}）`} />
        <Kpi label="新增客户" value={customers.length} />
        <Kpi label="跟进次数" value={follows.length} />
        <Kpi label="报价单" value={quotes.length} hint={money(quoteAmount)} />
        <Kpi label="成交订单" value={orders.length} hint={money(orderAmount)} strong />
        <Kpi label="回款" value={money(paidAmount)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">询盘来源与转化</CardTitle>
          </CardHeader>
          <CardContent>
            {sourceRows.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-2.5">
                {sourceRows.map(([k, s]) => (
                  <li key={k}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{k}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {s.total} 条 · 转化 {pct(s.converted, s.total)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/30" style={{ width: `${(s.total / sourceRows[0][1].total) * 100}%` }}>
                        <div className="h-full rounded-full bg-primary" style={{ width: `${s.total ? (s.converted / s.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </li>
                ))}
                <li className="flex gap-3 pt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <i className="inline-block size-2 rounded-full bg-primary/30" /> 询盘数
                  </span>
                  <span className="flex items-center gap-1">
                    <i className="inline-block size-2 rounded-full bg-primary" /> 已转客户
                  </span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">跟进方式</CardTitle>
          </CardHeader>
          <CardContent>{methodRows.length === 0 ? <Empty /> : <Bars rows={methodRows} />}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">沟通量</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Bars
              rows={[
                { label: "邮件发出", value: mailOut },
                { label: "邮件收到", value: mailIn },
                { label: "WhatsApp 发出", value: waOut },
                { label: "WhatsApp 收到", value: waIn },
              ]}
            />
            {quoteStatus.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">报价单状态</p>
                <Bars rows={quoteStatus} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">团队业绩</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
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
                <TableHead className="w-56">成交额</TableHead>
                <TableHead className="text-right">回款</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
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
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(r.orderAmount / teamMaxAmount) * 100}%` }} />
                      </div>
                      <span className="w-24 text-right text-sm tabular-nums">{money(r.orderAmount)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.paid)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function pct(a: number, b: number) {
  return b ? `${Math.round((a / b) * 100)}%` : "—";
}

function Kpi({ label, value, hint, strong }: { label: string; value: number | string; hint?: string; strong?: boolean }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums", strong && "text-primary")}>{value}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2 text-sm">
          <span className="truncate text-muted-foreground">{r.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="text-right tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function Num({ v }: { v: number }) {
  return <TableCell className={cn("text-right tabular-nums", v === 0 && "text-muted-foreground/60")}>{v}</TableCell>;
}

function Empty() {
  return <p className="py-6 text-center text-sm text-muted-foreground">这段时间没有数据</p>;
}
