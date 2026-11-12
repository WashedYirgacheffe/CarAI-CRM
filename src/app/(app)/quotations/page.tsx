import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "@/components/icons";
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
import { formatDate } from "@/lib/crm";
import { QUOTATION_STATUSES, formatAmount, isPast, quotationStatus } from "@/lib/docs";
import { parseLocalInput } from "@/lib/crm";
import { InsightCard, InsightRow } from "@/components/crm/insights";
import { Breakdown, Meter, MiniColumns } from "@/components/dashboard/viz";
import { TONE, monthKeys, monthLabel, sumByMonth, yuan } from "@/lib/viz";

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
    ...(QUOTATION_STATUSES.some((s) => s.value === filters.status) ? { status: filters.status as Prisma.QuotationWhereInput["status"] } : {}),
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
  const tz = user.timezone;
  const months = monthKeys(tz, 12);
  const yearStart = parseLocalInput(`${months[0]}-01T00:00`, tz)!;
  const [total, rows, byStatus, sent] = await Promise.all([
    db.quotation.count({ where }),
    db.quotation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { owner: { select: { name: true } }, _count: { select: { items: true } } },
    }),
    db.quotation.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    // 统计：近 12 个月发出的报价（不含草稿），折人民币
    db.quotation.findMany({
      where: { ...scope, status: { not: "DRAFT" }, quoteDate: { gte: yearStart } },
      select: { status: true, total: true, exchangeRate: true, quoteDate: true, validUntil: true },
      take: 10000,
    }),
  ]);
  const cny = (q: (typeof sent)[number]) => Number(q.total) * Number(q.exchangeRate);
  const monthly = sumByMonth(months, sent, (q) => q.quoteDate, cny, tz);
  const won = sent.filter((q) => q.status === "ACCEPTED" || q.status === "CONVERTED");
  const decided = sent.filter((q) => ["ACCEPTED", "CONVERTED", "REJECTED", "EXPIRED"].includes(q.status));
  const waiting = sent.filter((q) => q.status === "SENT" || q.status === "APPROVED");
  const expiring = waiting.filter((q) => q.validUntil && isPast(new Date(q.validUntil.getTime() - 7 * 86_400_000).toISOString())).length;

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
      <InsightRow>
        <InsightCard title="本月报价额" value={yuan(monthly[11])} hint={`近 12 个月 ${sent.length} 份 · ${yuan(monthly.reduce((a, b) => a + b, 0))}`}>
          <MiniColumns data={monthly.map((v, i) => ({ label: monthLabel(months[i]), value: v }))} money empty="近 12 个月没有发出报价" />
        </InsightCard>
        <InsightCard title="报价状态" value={`${byStatus.reduce((n, x) => n + x._count._all, 0)} 份`} hint="点一项筛选">
          <Breakdown
            sort={false}
            max={8}
            unit=" 份"
            parts={QUOTATION_STATUSES.map((st) => ({
              label: st.label,
              value: byStatus.find((x) => x.status === st.value)?._count._all ?? 0,
              color: TONE[st.color],
              href: `/quotations?status=${st.value}`,
            }))}
          />
        </InsightCard>
        <InsightCard
          title="成交转化 · 近 12 个月"
          value={decided.length ? `${Math.round((won.length / decided.length) * 100)}%` : "—"}
          hint={`已有结果 ${decided.length} 份，接受 / 转订单 ${won.length} 份`}
        >
          <Meter value={won.length} max={decided.length} tone="var(--chart-2)" label="成交转化率" />
          <p className="mt-2 text-xs text-muted-foreground">成交金额 {yuan(won.reduce((n, q) => n + cny(q), 0))}</p>
        </InsightCard>
        <InsightCard
          title="等待客户回复"
          value={`${waiting.length} 份`}
          hint={expiring ? `${expiring} 份 7 天内到期或已过期，记得跟进` : "近 12 个月已发出、还没有结果的报价"}
          action={{ href: "/quotations?status=SENT", label: "查看" }}
        >
          <p className="text-xs text-muted-foreground">
            金额 <span className="font-medium text-foreground tabular-nums">{yuan(waiting.reduce((n, q) => n + cny(q), 0))}</span>
          </p>
        </InsightCard>
      </InsightRow>
      <div className="surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-3 md:px-4">
          <DocFilters action="/quotations" filters={filters} statuses={QUOTATION_STATUSES} members={members} />
        </div>
        <MobileList empty={filters.q || filters.status || filters.owner ? "没有符合条件的报价单" : "还没有报价单，可以在客户详情页或右上角新建"}>
          {rows.map((q) => {
            const st = quotationStatus(q.status);
            const expired = (q.status === "DRAFT" || q.status === "SENT") && isPast(q.validUntil);
            return (
              <MobileCard
                key={q.id}
                href={`/quotations/${q.id}`}
                title={q.buyerName}
                sub={
                  <>
                    <span className="tabular-nums">{q.no}</span>
                    {q.title && ` · ${q.title}`}
                  </>
                }
                aside={<StatusBadge name={st.label} color={st.color} />}
              >
                <MobileMeta
                  items={[
                    ["金额", formatAmount(q.total.toString(), q.currency), "font-medium"],
                    ["产品", `${q._count.items} 项`],
                    ["报价日期", formatDate(q.quoteDate, tz)],
                    ["有效期至", q.validUntil ? formatDate(q.validUntil, tz) : "—", expired ? "text-destructive" : undefined],
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
                    <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                      {formatAmount(q.total.toString(), q.currency)}
                    </TableCell>
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
        </DesktopOnly>
        <div className="border-t border-border/70 px-3 py-3 md:px-4 [&>div]:mt-0">
          <Pager path="/quotations" filters={filters} page={filters.page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} />
        </div>
      </div>
    </>
  );
}
