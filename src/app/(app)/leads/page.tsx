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
import { LeadTable } from "./lead-table";

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
      q
        ? { OR: [{ companyName: contains }, { contactName: contains }, { email: contains }, { inquiry: contains }, { products: contains }] }
        : {},
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
    Promise.all(TABS.map((t) => (t.key === "all" ? Promise.resolve(null) : db.lead.count({ where: byTab[t.key] })))),
    allMembers(user.tenantId),
  ]);

  return (
    <>
      <PageHeader title="线索 / 询盘" description="平台询盘、展会名片、网站留言都先进线索，确认有效后转为客户" />
      <nav className="mb-4 flex flex-wrap gap-1 border-b">
        {TABS.map((t, i) => (
          <Link
            key={t.key}
            href={t.key === "todo" ? "/leads" : `/leads?tab=${t.key}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === t.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {counts[i] !== null && <span className="ml-1 text-xs text-muted-foreground tabular-nums">{counts[i]}</span>}
          </Link>
        ))}
      </nav>
      <LeadTable
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
      />
      <Pager path="/leads" filters={{ tab: tab === "todo" ? "" : tab, q }} page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} />
    </>
  );
}
