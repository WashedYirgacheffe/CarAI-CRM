import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { ExternalLink, Search } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DesktopOnly, MobileCard, MobileList, MobileMeta } from "@/components/crm/mobile-list";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/crm/bits";
import { Pager } from "@/components/crm/customer-filters";
import { InsightCard, InsightRow } from "@/components/crm/insights";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { docScopeWhere } from "@/server/documents";
import type { Prisma } from "@/generated/prisma/client";
import { formatDate, parseLocalInput } from "@/lib/crm";
import { dateInput } from "@/lib/docs";
import { SHIPMENT_OPEN, shipMode, shipmentStatus, trackingLink } from "@/lib/shipping";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "物流" };

const PAGE_SIZE = 20;
const TABS = [
  { key: "open", label: "在途" },
  { key: "done", label: "已签收" },
  { key: "all", label: "全部" },
] as const;

export default async function ShipmentsPage({ searchParams }: PageProps<"/shipments">) {
  const user = await requirePermission("order.view");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const tab = TABS.find((t) => t.key === str("tab"))?.key ?? "open";
  const q = str("q");
  const page = Math.max(1, Number(str("page")) || 1);
  const tz = user.timezone;
  const db = tenantDb(user.tenantId);
  const scope = await docScopeWhere(user);
  const today = dateInput(tz);
  const todayStart = parseLocalInput(`${today}T00:00`, tz)!;
  const weekEnd = new Date(todayStart.getTime() + 7 * 86_400_000);

  const contains = { contains: q, mode: "insensitive" as const };
  const base: Prisma.ShipmentWhereInput = { order: scope };
  const where: Prisma.ShipmentWhereInput = {
    ...base,
    ...(tab === "open" ? { status: { in: SHIPMENT_OPEN } } : tab === "done" ? { status: "DELIVERED" } : {}),
    ...(q
      ? {
          OR: [
            { no: contains },
            { blNo: contains },
            { bookingNo: contains },
            { containerNo: contains },
            { trackingNo: contains },
            { carrier: contains },
            { order: { no: contains } },
            { customer: { name: contains } },
          ],
        }
      : {}),
  };

  const [total, rows, openCount, departing, arriving, late] = await Promise.all([
    db.shipment.count({ where }),
    db.shipment.findMany({
      where,
      orderBy: tab === "open" ? [{ eta: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }] : [{ createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        order: { select: { id: true, no: true, owner: { select: { name: true } } } },
        customer: { select: { id: true, name: true } },
      },
    }),
    db.shipment.count({ where: { ...base, status: { in: SHIPMENT_OPEN } } }),
    db.shipment.count({ where: { ...base, status: { in: ["BOOKING", "BOOKED", "LOADED"] }, etd: { gte: todayStart, lt: weekEnd } } }),
    db.shipment.count({ where: { ...base, status: "DEPARTED", eta: { gte: todayStart, lt: weekEnd } } }),
    db.shipment.count({ where: { ...base, status: { in: ["BOOKING", "BOOKED", "LOADED", "DEPARTED"] }, eta: { lt: todayStart } } }),
  ]);

  const tabHref = (k: string) => {
    const p = new URLSearchParams();
    if (k !== "open") p.set("tab", k);
    if (q) p.set("q", q);
    return `/shipments${p.size ? `?${p}` : ""}`;
  };
  const day = (d: Date | null) => (d ? formatDate(d, tz) : "—");
  const isLate = (s: (typeof rows)[number]) => !!s.eta && !s.ata && ["BOOKING", "BOOKED", "LOADED", "DEPARTED"].includes(s.status) && s.eta < todayStart;

  return (
    <>
      <PageHeader title="物流" description="所有订单的发货批次：订舱、装柜、开船、到港、签收。新建批次请到订单详情页。" />
      <InsightRow>
        <InsightCard title="在途批次" value={String(openCount)} hint="还没签收的发货批次" />
        <InsightCard title="7 天内开船" value={String(departing)} hint="按 ETD，提前确认截关和单证" />
        <InsightCard title="7 天内到港" value={String(arriving)} hint="按 ETA，提醒客户清关、付尾款" />
        <InsightCard title="已过 ETA 未到港" value={String(late)} hint={late ? "可能延误，或者忘了更新状态" : "没有延误"} />
      </InsightRow>
      <div className="surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/70 px-3 py-3 md:px-4">
          <nav aria-label="物流视图" className="inline-flex shrink-0 items-center rounded-full bg-muted p-0.5 ring-1 ring-border/60">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={tabHref(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 items-center rounded-[10px] px-3.5 text-sm font-medium transition-colors",
                  tab === t.key ? "bg-brand-soft text-brand-ink" : "text-foreground/60 hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <Form action="/shipments" className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-1">
            {tab !== "open" && <input type="hidden" name="tab" value={tab} />}
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="订单号 / 提单号 / 柜号 / 客户" className="h-8 pl-8" />
            </div>
            <Button type="submit" size="sm" variant="secondary">
              查询
            </Button>
            {q && (
              <Button size="sm" variant="ghost" asChild>
                <Link href={tabHref(tab).replace(/[?&]q=[^&]*/, "")}>清空</Link>
              </Button>
            )}
          </Form>
        </div>

        <MobileList empty={q ? "没有符合条件的发货批次" : "还没有发货批次，在订单详情页的「物流」里新建"}>
          {rows.map((s) => {
            const st = shipmentStatus(s.status, s.mode);
            return (
              <MobileCard
                key={s.id}
                href={`/orders/${s.order.id}#shipment-${s.id}`}
                title={s.customer.name}
                sub={
                  <span className="tabular-nums">
                    {s.order.no} · {s.no}
                  </span>
                }
                aside={<StatusBadge name={st.label} color={st.color} />}
              >
                <MobileMeta
                  items={[
                    ["方式", [shipMode(s.mode), s.carrier].filter(Boolean).join(" · ")],
                    ["提单 / 单号", s.blNo || s.trackingNo || "—"],
                    ["ETD", day(s.atd ?? s.etd)],
                    ["ETA", day(s.ata ?? s.eta), isLate(s) ? "text-rose-600" : undefined],
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
                <TableHead className="pl-4">批次 / 订单</TableHead>
                <TableHead>客户</TableHead>
                <TableHead>方式</TableHead>
                <TableHead>提单号 / 柜号</TableHead>
                <TableHead>起运 → 目的</TableHead>
                <TableHead>ETD</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>负责人</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                    {q ? "没有符合条件的发货批次" : tab === "open" ? "没有在途的发货批次" : "还没有发货批次，在订单详情页的「物流」里新建"}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((s) => {
                const st = shipmentStatus(s.status, s.mode);
                const link = trackingLink(s);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="pl-4 whitespace-nowrap">
                      <Link href={`/orders/${s.order.id}#shipment-${s.id}`} className="font-medium tabular-nums hover:text-primary hover:underline">
                        {s.no}
                      </Link>
                      <span className="block text-xs text-muted-foreground tabular-nums">{s.order.no}</span>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">
                      <Link href={`/customers/${s.customer.id}`} className="hover:text-primary hover:underline">
                        {s.customer.name}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {shipMode(s.mode)}
                      {s.carrier && <span className="block text-xs text-muted-foreground">{s.carrier}</span>}
                    </TableCell>
                    <TableCell className="max-w-52 text-sm tabular-nums">
                      <span className="flex items-center gap-1">
                        <span className="truncate">{s.blNo || s.trackingNo || s.bookingNo || "—"}</span>
                        {link && (
                          <a href={link} target="_blank" rel="noreferrer" aria-label="查询轨迹" className="text-muted-foreground hover:text-primary">
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </span>
                      {s.containerNo && <span className="block truncate text-xs text-muted-foreground">{s.containerNo}</span>}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-sm">
                      {s.portLoading || s.portDischarge ? `${s.portLoading || "—"} → ${s.portDischarge || "—"}` : "—"}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap tabular-nums">
                      {day(s.atd ?? s.etd)}
                      {s.atd && <span className="block text-xs text-muted-foreground">已开</span>}
                    </TableCell>
                    <TableCell className={cn("text-sm whitespace-nowrap tabular-nums", isLate(s) && "text-rose-600")}>
                      {day(s.ata ?? s.eta)}
                      {s.ata ? <span className="block text-xs text-muted-foreground">已到</span> : isLate(s) && <span className="block text-xs">已过 ETA</span>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge name={st.label} color={st.color} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{s.order.owner?.name ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DesktopOnly>
        <div className="border-t border-border/70 px-3 py-3 md:px-4 [&>div]:mt-0">
          <Pager
            path="/shipments"
            filters={{ tab: tab === "open" ? "" : tab, q }}
            page={page}
            pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            total={total}
          />
        </div>
      </div>
    </>
  );
}
