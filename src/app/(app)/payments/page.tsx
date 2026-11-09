import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DesktopOnly, MobileCard, MobileList, MobileMeta } from "@/components/crm/mobile-list";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/crm/bits";
import { Pager } from "@/components/crm/customer-filters";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { docScopeWhere } from "@/server/documents";
import type { Prisma } from "@/generated/prisma/client";
import { formatDate, parseLocalInput } from "@/lib/crm";
import { ORDER_NOT_COUNTED, dateInput, formatAmount, orderStatus, round2 } from "@/lib/docs";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "回款" };

const PAGE_SIZE = 20;
const TABS = [
  { key: "records", label: "收款记录" },
  { key: "due", label: "待收款订单" },
] as const;

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const user = await requirePermission("order.view");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const tab = str("tab") === "due" ? "due" : "records";
  const q = str("q");
  const page = Math.max(1, Number(str("page")) || 1);
  const tz = user.timezone;
  const db = tenantDb(user.tenantId);
  const scope = await docScopeWhere(user);

  const today = dateInput(tz);
  const monthStart = parseLocalInput(`${today.slice(0, 8)}01T00:00`, tz)!;
  const yearStart = parseLocalInput(`${today.slice(0, 4)}-01-01T00:00`, tz)!;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str("from")) ? str("from") : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(str("to")) ? str("to") : "";
  const contains = { contains: q, mode: "insensitive" as const };
  const orderMatch: Prisma.OrderWhereInput = q ? { OR: [{ no: contains }, { buyerName: contains }, { customer: { name: contains } }] } : {};

  // 收款记录
  const payWhere: Prisma.OrderPaymentWhereInput = {
    order: { ...scope, ...orderMatch },
    ...(from || to
      ? {
          receivedAt: {
            ...(from ? { gte: parseLocalInput(`${from}T00:00`, tz)! } : {}),
            ...(to ? { lt: new Date(parseLocalInput(`${to}T00:00`, tz)!.getTime() + 86_400_000) } : {}),
          },
        }
      : {}),
  };
  // 待收款：计业绩的订单里还有未收金额的
  const dueWhere: Prisma.OrderWhereInput = { ...scope, ...orderMatch, status: { notIn: [...ORDER_NOT_COUNTED] } };

  const [payTotal, payRows, yearPays, live] = await Promise.all([
    tab === "records" ? db.orderPayment.count({ where: payWhere }) : 0,
    tab === "records"
      ? db.orderPayment.findMany({
          where: payWhere,
          orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          include: { order: { select: { id: true, no: true, currency: true, buyerName: true, customer: { select: { id: true, name: true } }, owner: { select: { name: true } } } } },
        })
      : [],
    db.orderPayment.findMany({
      where: { order: scope, receivedAt: { gte: yearStart } },
      select: { amount: true, receivedAt: true, order: { select: { exchangeRate: true } } },
      take: 20000,
    }),
    db.order.findMany({
      where: dueWhere,
      orderBy: [{ orderDate: "asc" }],
      select: {
        id: true,
        no: true,
        status: true,
        currency: true,
        total: true,
        paidAmount: true,
        exchangeRate: true,
        orderDate: true,
        deliveryDate: true,
        customer: { select: { id: true, name: true } },
        owner: { select: { name: true } },
      },
      take: 5000,
    }),
  ]);

  const cnyOf = (amount: unknown, rate: unknown) => Number(String(amount)) * Number(String(rate));
  const monthIn = round2(yearPays.filter((p) => p.receivedAt >= monthStart).reduce((s, p) => s + cnyOf(p.amount, p.order.exchangeRate), 0));
  const yearIn = round2(yearPays.reduce((s, p) => s + cnyOf(p.amount, p.order.exchangeRate), 0));
  const dueOrders = live
    .map((o) => ({ ...o, due: round2(Number(o.total) - Number(o.paidAmount)) }))
    .filter((o) => o.due > 0);
  const dueCny = round2(dueOrders.reduce((s, o) => s + o.due * Number(o.exchangeRate), 0));
  const dueSlice = dueOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const total = tab === "records" ? payTotal : dueOrders.length;

  const tabHref = (k: string) => {
    const p = new URLSearchParams();
    if (k !== "records") p.set("tab", k);
    if (q) p.set("q", q);
    return `/payments${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader title="回款" description="所有订单的收款记录汇总。登记收款请到订单详情页。" />
      <section className="mb-3 grid grid-cols-2 gap-3 md:mb-4 sm:grid-cols-3">
        {[
          ["本月回款", formatAmount(monthIn, "CNY"), "按收款日期，按开单汇率折算"],
          ["今年回款", formatAmount(yearIn, "CNY"), `${today.slice(0, 4)} 年至今`],
          ["待收款", formatAmount(dueCny, "CNY"), `${dueOrders.length} 个订单未收齐`],
        ].map(([label, value, hint], i) => (
          <div key={label} className={cn("surface p-3.5 md:p-4", i === 2 && "col-span-2 sm:col-span-1")}>
            <p className="text-[13px] text-muted-foreground md:text-sm">{label}</p>
            <p className="mt-1 truncate text-lg font-bold tabular-nums sm:text-xl md:text-2xl">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
        ))}
      </section>

      <div className="surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/70 px-3 py-3 md:px-4">
          <nav aria-label="回款视图" className="inline-flex shrink-0 items-center rounded-full bg-muted p-0.5 ring-1 ring-border/60">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={tabHref(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 items-center rounded-full px-3.5 text-sm font-medium transition-colors",
                  tab === t.key ? "bg-card text-primary shadow-sm" : "text-foreground/60 hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          <Form action="/payments" className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-1">
            {tab === "due" && <input type="hidden" name="tab" value="due" />}
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="订单号 / 客户" className="h-8 pl-8" />
            </div>
            {tab === "records" && (
              <>
                <Input type="date" name="from" defaultValue={from} className="h-8 w-auto" aria-label="开始日期" />
                <span className="text-sm text-muted-foreground">至</span>
                <Input type="date" name="to" defaultValue={to} className="h-8 w-auto" aria-label="结束日期" />
              </>
            )}
            <Button type="submit" size="sm" variant="secondary">
              查询
            </Button>
            {(q || from || to) && (
              <Button size="sm" variant="ghost" asChild>
                <Link href={tab === "due" ? "/payments?tab=due" : "/payments"}>清空筛选</Link>
              </Button>
            )}
          </Form>
        </div>

        <MobileList empty={tab === "records" ? (q || from || to ? "没有符合条件的收款记录" : "还没有收款记录，在订单详情页登记收款后会出现在这里") : "没有待收款的订单"}>
          {tab === "records"
            ? payRows.map((p) => (
                <MobileCard
                  key={p.id}
                  href={`/orders/${p.order.id}`}
                  title={p.order.customer.name}
                  sub={
                    <>
                      <span className="tabular-nums">{p.order.no}</span>
                      {p.method && ` · ${p.method}`}
                      {p.remark && ` · ${p.remark}`}
                    </>
                  }
                  aside={
                    <span className="text-sm font-semibold whitespace-nowrap text-emerald-700 tabular-nums">
                      +{formatAmount(p.amount.toString(), p.order.currency)}
                      <span className="block text-xs font-normal text-muted-foreground">{formatDate(p.receivedAt, tz)}</span>
                    </span>
                  }
                />
              ))
            : dueSlice.map((o) => {
                const st = orderStatus(o.status);
                return (
                  <MobileCard
                    key={o.id}
                    href={`/orders/${o.id}`}
                    title={o.customer.name}
                    sub={<span className="tabular-nums">{o.no}</span>}
                    aside={<StatusBadge name={st.label} color={st.color} />}
                  >
                    <MobileMeta
                      items={[
                        ["待收", formatAmount(o.due), "font-semibold text-amber-700"],
                        ["订单金额", formatAmount(o.total.toString(), o.currency)],
                        ["已收", formatAmount(o.paidAmount.toString())],
                        ["交货", o.deliveryDate ? formatDate(o.deliveryDate, tz) : "未定"],
                      ]}
                    />
                  </MobileCard>
                );
              })}
        </MobileList>
        <DesktopOnly>
        {tab === "records" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">收款日期</TableHead>
                <TableHead>订单</TableHead>
                <TableHead>客户</TableHead>
                <TableHead className="text-right">金额</TableHead>
                <TableHead>方式</TableHead>
                <TableHead>备注</TableHead>
                <TableHead>负责人</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    {q || from || to ? "没有符合条件的收款记录" : "还没有收款记录，在订单详情页登记收款后会出现在这里"}
                  </TableCell>
                </TableRow>
              )}
              {payRows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-4 whitespace-nowrap tabular-nums">{formatDate(p.receivedAt, tz)}</TableCell>
                  <TableCell>
                    <Link href={`/orders/${p.order.id}`} className="font-medium tabular-nums hover:text-primary hover:underline">
                      {p.order.no}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-56 truncate">
                    <Link href={`/customers/${p.order.customer.id}`} className="hover:text-primary hover:underline">
                      {p.order.customer.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">{formatAmount(p.amount.toString(), p.order.currency)}</TableCell>
                  <TableCell className="whitespace-nowrap">{p.method ?? "—"}</TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground">{p.remark ?? ""}</TableCell>
                  <TableCell className="whitespace-nowrap">{p.order.owner?.name ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">订单</TableHead>
                <TableHead>客户</TableHead>
                <TableHead className="text-right">订单金额</TableHead>
                <TableHead className="text-right">已收</TableHead>
                <TableHead className="text-right">待收</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>下单 / 交货</TableHead>
                <TableHead>负责人</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dueSlice.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    没有待收款的订单
                  </TableCell>
                </TableRow>
              )}
              {dueSlice.map((o) => {
                const st = orderStatus(o.status);
                return (
                  <TableRow key={o.id}>
                    <TableCell className="pl-4">
                      <Link href={`/orders/${o.id}`} className="font-medium tabular-nums hover:text-primary hover:underline">
                        {o.no}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-56 truncate">
                      <Link href={`/customers/${o.customer.id}`} className="hover:text-primary hover:underline">
                        {o.customer.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{formatAmount(o.total.toString(), o.currency)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">{formatAmount(o.paidAmount.toString())}</TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap text-amber-700 tabular-nums">{formatAmount(o.due)}</TableCell>
                    <TableCell>
                      <StatusBadge name={st.label} color={st.color} />
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap tabular-nums">
                      {formatDate(o.orderDate, tz)}
                      <span className="block text-xs text-muted-foreground">{o.deliveryDate ? `交货 ${formatDate(o.deliveryDate, tz)}` : "未定交货期"}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{o.owner?.name ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        </DesktopOnly>
        <div className="border-t border-border/70 px-3 py-3 md:px-4 [&>div]:mt-0">
          <Pager
            path="/payments"
            filters={{ tab: tab === "records" ? "" : tab, q, from, to }}
            page={page}
            pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            total={total}
          />
        </div>
      </div>
    </>
  );
}
