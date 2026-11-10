import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/crm/customer-filters";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { allMembers, scopeOwnerIds } from "@/server/scope";
import { PAGE_SIZE } from "@/server/customer-list";
import { cn } from "@/lib/utils";
import { LEAD_OPEN_STATUSES } from "@/lib/crm";
import type { Prisma } from "@/generated/prisma/client";
import { LeadTable, NewLeadButton } from "./lead-table";
import { LeadInsights } from "./lead-insights";

export const metadata: Metadata = { title: "线索 / 询盘" };

const TABS = [
  { key: "todo", label: "待跟进" },
  { key: "unassigned", label: "待分配" },
  { key: "converted", label: "已转客户" },
  { key: "invalid", label: "无效" },
  { key: "all", label: "全部" },
] as const;

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const user = await requirePermission("lead.view");
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "todo") as (typeof TABS)[number]["key"];
  const q = (typeof sp.q === "string" ? sp.q : "").trim();
  const page = Math.max(1, Number(sp.page) || 1);

  const scope = await scopeOwnerIds(user);
  const mine: Prisma.LeadWhereInput = scope ? { ownerId: { in: scope } } : { ownerId: { not: null } };
  const byTab: Record<typeof tab, Prisma.LeadWhereInput> = {
    todo: { ...mine, status: { in: [...LEAD_OPEN_STATUSES] } },
    unassigned: { ownerId: null, status: { in: [...LEAD_OPEN_STATUSES] } },
    converted: { ...mine, status: "CONVERTED" },
    invalid: { ...mine, status: "INVALID" },
    all: { OR: [mine, { ownerId: null }] },
  };
  const contains = { contains: q, mode: "insensitive" as const };
  const where: Prisma.LeadWhereInput = {
    AND: [
      byTab[tab],
      q ? { OR: [{ companyName: contains }, { contactName: contains }, { email: contains }, { inquiry: contains }, { products: contains }] } : {},
    ],
  };

  const db = tenantDb(user.tenantId);
  const [total, rows, counts, members] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { owner: { select: { name: true } }, customer: { select: { id: true, name: true } } },
    }),
    Promise.all(TABS.map((t) => db.lead.count({ where: byTab[t.key] }))),
    allMembers(user.tenantId),
  ]);

  const count = (key: (typeof TABS)[number]["key"]) => counts[TABS.findIndex((t) => t.key === key)];
  const tabHref = (key: string) => (key === "todo" ? "/leads" : `/leads?tab=${key}`);
  const item = (key: (typeof TABS)[number]["key"], label: string) => (
    <Link
      key={key}
      href={tabHref(key)}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors lg:shrink",
        tab === key ? "bg-accent font-medium text-accent-foreground" : "text-foreground/80 hover:bg-muted",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="ml-auto pl-2 text-xs font-normal text-muted-foreground tabular-nums">{count(key)}</span>
    </Link>
  );
  const tabLabel = TABS.find((t) => t.key === tab)!.label;

  return (
    <>
      <PageHeader
        title="线索 / 询盘"
        description="平台询盘、展会名片、网站留言都先进线索，确认有效后转为客户"
        actions={can(user, "lead.create") ? <NewLeadButton canAssign={can(user, "lead.assign")} /> : undefined}
      />
      <LeadInsights tenantId={user.tenantId} tz={user.timezone} where={byTab.all} />
      <div className="flex flex-col overflow-hidden surface lg:flex-row">
        <aside className="border-b border-border/70 p-2.5 lg:w-48 lg:shrink-0 lg:border-r lg:border-b-0">
          <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible" aria-label="线索筛选">
            {item("all", "全部线索")}
            <p className="hidden px-2.5 pt-3 pb-1 text-xs text-muted-foreground lg:block">线索状态</p>
            {TABS.filter((t) => t.key !== "all").map((t) => item(t.key, t.label))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <LeadTable
            title={tab === "all" ? "全部线索" : tabLabel}
            total={total}
            tab={tab}
            q={q}
            tz={user.timezone}
            members={members}
            currentUserId={user.id}
            perms={{
              create: can(user, "lead.create"),
              edit: can(user, "lead.edit"),
              delete: can(user, "lead.delete"),
              assign: can(user, "lead.assign"),
              createOpportunity: can(user, "opportunity.create"),
            }}
            rows={rows.map((l) => ({
              id: l.id,
              companyName: l.companyName,
              contactName: l.contactName,
              email: l.email,
              phone: l.phone,
              whatsapp: l.whatsapp,
              country: l.country,
              source: l.source,
              products: l.products,
              inquiry: l.inquiry,
              status: l.status,
              invalidReason: l.invalidReason,
              invalidNote: l.invalidNote,
              ownerId: l.ownerId,
              ownerName: l.owner?.name ?? null,
              customerId: l.customer?.id ?? null,
              customerName: l.customer?.name ?? null,
              createdAt: l.createdAt.toISOString(),
            }))}
            footer={
              <Pager
                path="/leads"
                filters={{ tab: tab === "todo" ? "" : tab, q }}
                page={page}
                pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
                total={total}
                className="mt-0 border-t border-border/70 px-5 py-3"
              />
            }
          />
        </div>
      </div>
    </>
  );
}
