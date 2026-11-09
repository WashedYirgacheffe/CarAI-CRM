import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DesktopOnly, MobileCard, MobileList, MobileMeta } from "@/components/crm/mobile-list";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/crm/bits";
import { Pager } from "@/components/crm/customer-filters";
import { DocFilters } from "@/components/crm/doc-filters";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { scopeMembers } from "@/server/scope";
import { docScopeWhere } from "@/server/documents";
import type { Prisma } from "@/generated/prisma/client";
import { formatDate, parseLocalInput } from "@/lib/crm";
import { ORDER_NOT_COUNTED, ORDER_STATUSES, dateInput, formatAmount, orderStatus, round2 } from "@/lib/docs";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "订单" };

const PAGE_SIZE = 20;

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const user = await requirePermission("order.view");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const filters = { q: str("q"), status: str("status"), owner: str("owner"), page: Math.max(1, Number(str("page")) || 1) };
  const db = tenantDb(user.tenantId);
  const tz = user.timezone;
  const members = await scopeMembers(user);
  const scope = await docScopeWhere(user);
  const where: Prisma.OrderWhereInput = {
    ...scope,
    ...(filters.owner && members.some((m) => m.id === filters.owner) ? { ownerId: filters.owner } : {}),
    ...(ORDER_STATUSES.some((s) => s.value === filters.status) ? { status: filters.status as Prisma.OrderWhereInput["status"] } : {}),
    ...(filters.q
      ? {
          OR: [
            { no: { contains: filters.q, mode: "insensitive" } },
            { buyerName: { contains: filters.q, mode: "insensitive" } },
            { buyerContact: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const monthStart = parseLocalInput(`${dateInput(tz).slice(0, 8)}01T00:00`, tz)!;

  const [total, rows, live] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { owner: { select: { name: true } } },
    }),
    // 统计：数据范围内计业绩的订单（不含草稿、已取消），按开单汇率折成人民币
    db.order.findMany({
      where: { ...scope, status: { notIn: [...ORDER_NOT_COUNTED] } },
      select: { total: true, paidAmount: true, exchangeRate: true, orderDate: true },
      take: 10000,
    }),
  ]);
  const cny = (v: { toString(): string }, rate: { toString(): string }) => Number(v.toString()) * Number(rate.toString());
  const monthTotal = round2(live.filter((o) => o.orderDate >= monthStart).reduce((s, o) => s + cny(o.total, o.exchangeRate), 0));
  const receivable = round2(
    live.reduce((s, o) => s + Math.max(0, cny(o.total, o.exchangeRate) - cny(o.paidAmount, o.exchangeRate)), 0),
  );
  const monthCount = live.filter((o) => o.orderDate >= monthStart).length;

  return (
    <>
      <PageHeader
        title="订单"
        description="订单可打印为 PI；登记收款后自动计算待收金额。"
        actions={
          can(user, "order.create") && (
            <Button size="sm" asChild>
              <Link href="/orders/new">
                <Plus /> 新建订单
              </Link>
            </Button>
          )
        }
      />
      <section className="mb-3 grid grid-cols-2 gap-3 md:mb-4 sm:grid-cols-3">
        {[
          ["本月订单", `${monthCount} 单`, "按下单日期，不含草稿和已取消"],
          ["本月订单额", formatAmount(monthTotal, "CNY"), "按开单汇率折算"],
          ["待收款", formatAmount(receivable, "CNY"), "已确认订单的未收金额"],
        ].map(([label, value, hint], i) => (
          <div key={label} className={cn("surface p-3.5 md:p-4", i === 2 && "col-span-2 sm:col-span-1")}>
            <p className="text-[13px] text-muted-foreground md:text-sm">{label}</p>
            <p className="mt-1 truncate text-lg font-bold tabular-nums sm:text-xl md:text-2xl">{value}</p>
            <p className="mt-1 hidden text-xs text-muted-foreground sm:block">{hint}</p>
          </div>
        ))}
      </section>
      <div className="surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-3 md:px-4">
          <DocFilters action="/orders" filters={filters} statuses={ORDER_STATUSES} members={members} />
        </div>
        <MobileList empty={filters.q || filters.status || filters.owner ? "没有符合条件的订单" : "还没有订单，可以从报价单一键转入"}>
          {rows.map((o) => {
            const st = orderStatus(o.status);
            const due = round2(Number(o.total) - Number(o.paidAmount));
            return (
              <MobileCard
                key={o.id}
                href={`/orders/${o.id}`}
                title={o.buyerName}
                sub={<span className="tabular-nums">{o.no}</span>}
                aside={<StatusBadge name={st.label} color={st.color} />}
              >
                <MobileMeta
                  items={[
                    ["金额", formatAmount(o.total.toString(), o.currency), "font-semibold"],
                    [
                      "待收",
                      due > 0 ? formatAmount(due) : "已收齐",
                      due > 0 && o.status !== "CANCELLED" && o.status !== "DRAFT" ? "text-amber-700" : "text-muted-foreground",
                    ],
                    ["下单日期", formatDate(o.orderDate, tz)],
                    ["交货日期", o.deliveryDate ? formatDate(o.deliveryDate, tz) : "—"],
                  ]}
                />
              </MobileCard>
            );
          })}
        </MobileList>
        <DesktopOnly>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">单号</TableHead>
              <TableHead>客户</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead className="text-right">已收 / 待收</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>下单日期</TableHead>
              <TableHead>交货日期</TableHead>
              <TableHead>负责人</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  {filters.q || filters.status || filters.owner ? "没有符合条件的订单" : "还没有订单，可以从报价单一键转入"}
                </TableCell>
              </TableRow>
            )}
            {rows.map((o) => {
              const st = orderStatus(o.status);
              const due = round2(Number(o.total) - Number(o.paidAmount));
              return (
                <TableRow key={o.id}>
                  <TableCell className="pl-4">
                    <Link href={`/orders/${o.id}`} className="font-medium tabular-nums hover:text-primary hover:underline">
                      {o.no}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/customers/${o.customerId}`} className="hover:text-primary hover:underline">
                      {o.buyerName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">{formatAmount(o.total.toString(), o.currency)}</TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap tabular-nums">
                    {formatAmount(o.paidAmount.toString())}
                    <span className={cn("block text-xs", due > 0 && o.status !== "CANCELLED" && o.status !== "DRAFT" ? "text-amber-700" : "text-muted-foreground")}>
                      {due > 0 ? `待收 ${formatAmount(due)}` : "已收齐"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge name={st.label} color={st.color} />
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDate(o.orderDate, tz)}</TableCell>
                  <TableCell className="tabular-nums">{o.deliveryDate ? formatDate(o.deliveryDate, tz) : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{o.owner?.name ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </DesktopOnly>
        <div className="border-t border-border/70 px-3 py-3 md:px-4 [&>div]:mt-0">
          <Pager path="/orders" filters={filters} page={filters.page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} />
        </div>
      </div>
    </>
  );
}
