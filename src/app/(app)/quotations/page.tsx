import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/crm/bits";
import { Pager } from "@/components/crm/customer-filters";
import { DocFilters } from "@/components/crm/doc-filters";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { scopeMembers } from "@/server/scope";
import { docScopeWhere } from "@/server/documents";
import type { Prisma } from "@/generated/prisma/client";
import { formatDate } from "@/lib/crm";
import { QUOTATION_STATUSES, formatAmount, isPast, quotationStatus } from "@/lib/docs";

export const metadata: Metadata = { title: "报价单" };

const PAGE_SIZE = 20;

export default async function QuotationsPage({ searchParams }: PageProps<"/quotations">) {
  const user = await requirePermission("quotation.view");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const filters = { q: str("q"), status: str("status"), owner: str("owner"), page: Math.max(1, Number(str("page")) || 1) };
  const db = tenantDb(user.tenantId);
  const members = await scopeMembers(user);
  const scope = await docScopeWhere(user);
  const where: Prisma.QuotationWhereInput = {
    ...scope,
    ...(filters.owner && members.some((m) => m.id === filters.owner) ? { ownerId: filters.owner } : {}),
    ...(QUOTATION_STATUSES.some((s) => s.value === filters.status)
      ? { status: filters.status as Prisma.QuotationWhereInput["status"] }
      : {}),
    ...(filters.q
      ? {
          OR: [
            { no: { contains: filters.q, mode: "insensitive" } },
            { buyerName: { contains: filters.q, mode: "insensitive" } },
            { buyerContact: { contains: filters.q, mode: "insensitive" } },
            { title: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    db.quotation.count({ where }),
    db.quotation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { owner: { select: { name: true } }, _count: { select: { items: true } } },
    }),
  ]);
  const tz = user.timezone;

  return (
    <>
      <PageHeader
        title="报价单"
        description="多币种报价，打印或另存为 PDF 发给客户；客户确认后一键转订单。"
        actions={
          can(user, "quotation.create") && (
            <Button size="sm" asChild>
              <Link href="/quotations/new">
                <Plus /> 新建报价单
              </Link>
            </Button>
          )
        }
      />
      <DocFilters action="/quotations" filters={filters} statuses={QUOTATION_STATUSES} members={members} />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">单号</TableHead>
              <TableHead>客户</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>报价日期</TableHead>
              <TableHead>有效期至</TableHead>
              <TableHead>负责人</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  {filters.q || filters.status || filters.owner ? "没有符合条件的报价单" : "还没有报价单，可以在客户详情页或右上角新建"}
                </TableCell>
              </TableRow>
            )}
            {rows.map((q) => {
              const st = quotationStatus(q.status);
              const expired = (q.status === "DRAFT" || q.status === "SENT") && isPast(q.validUntil);
              return (
                <TableRow key={q.id}>
                  <TableCell className="pl-4">
                    <Link href={`/quotations/${q.id}`} className="font-medium tabular-nums hover:text-primary hover:underline">
                      {q.no}
                    </Link>
                    {q.title && <p className="max-w-56 truncate text-xs text-muted-foreground">{q.title}</p>}
                  </TableCell>
                  <TableCell>
                    <Link href={`/customers/${q.customerId}`} className="hover:text-primary hover:underline">
                      {q.buyerName}
                    </Link>
                    <p className="text-xs text-muted-foreground">{q._count.items} 项产品</p>
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">{formatAmount(q.total.toString(), q.currency)}</TableCell>
                  <TableCell>
                    <StatusBadge name={st.label} color={st.color} />
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDate(q.quoteDate, tz)}</TableCell>
                  <TableCell className={expired ? "text-destructive tabular-nums" : "tabular-nums"}>
                    {q.validUntil ? formatDate(q.validUntil, tz) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{q.owner?.name ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Pager path="/quotations" filters={filters} page={filters.page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} />
    </>
  );
}
