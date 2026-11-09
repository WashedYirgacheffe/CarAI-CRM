import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { CustomerFilters, Pager } from "@/components/crm/customer-filters";
import { CustomerTable, NewCustomerButton } from "@/components/crm/customer-table";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { scopeMembers, scopeOwnerIds } from "@/server/scope";
import { customerInsights, customerOptions, listCustomers, parseFilters, type CustomerFilters as Filters } from "@/server/customer-list";
import { InsightCard, InsightRow } from "@/components/crm/insights";
import { Breakdown, SegmentBar as RecencyBar } from "@/components/dashboard/viz";
import { OTHER, RAMP, TONE } from "@/lib/viz";
import { countryName } from "@/lib/crm";
import { listSegments } from "@/server/segments";
import { SegmentBar } from "@/components/crm/segment-bar";
import { CUSTOMER_FILTER_KEYS, FOLLOW_OPTIONS } from "@/lib/segments";

export const metadata: Metadata = { title: "我的客户" };

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const user = await requirePermission("customer.view");
  const filters = parseFilters(await searchParams);
  const active = CUSTOMER_FILTER_KEYS.filter((k) => filters[k]);
  const [list, options, members, segments, allCount, stats] = await Promise.all([
    listCustomers(user, filters, "mine"),
    customerOptions(user.tenantId),
    scopeMembers(user),
    listSegments(user),
    // 「全部客户」的总数：没有筛选时就是列表总数，不用再查
    active.length || filters.seg
      ? scopeOwnerIds(user).then((scope) => tenantDb(user.tenantId).customer.count({ where: { ownerId: scope ? { in: scope } : { not: null } } }))
      : null,
    customerInsights(user, filters, "mine"),
  ]);

  const segment = filters.seg ? segments.find((s) => s.id === filters.seg) : undefined;
  const quick = active.length === 1 && filters.follow ? FOLLOW_OPTIONS.find((o) => o.value === filters.follow) : undefined;
  const title = segment?.name ?? quick?.label ?? (active.length ? "筛选结果" : "全部客户");

  return (
    <>
      <PageHeader
        title="我的客户"
        description={user.dataScope === "SELF" ? "你负责的私海客户" : "你和数据范围内同事负责的私海客户"}
        actions={can(user, "customer.create") ? <NewCustomerButton options={options} /> : undefined}
      />
      <CustomerInsightRow filters={filters} stats={stats} statuses={options.statuses} total={list.total} />
      <div className="flex flex-col overflow-hidden surface lg:flex-row">
        <SegmentBar
          path="/customers"
          segments={segments}
          filters={filters}
          canShare={can(user, "settings.business")}
          allCount={allCount ?? list.total}
          quick={FOLLOW_OPTIONS}
        />
        <div className="min-w-0 flex-1">
          <CustomerTable
            rows={list.rows}
            mode="mine"
            tz={user.timezone}
            members={members}
            title={title}
            total={list.total}
            perms={{
              transfer: can(user, "customer.transfer"),
              release: can(user, "customer.edit"),
            }}
            toolbar={<CustomerFilters action="/customers" filters={filters} options={options} members={members} showFollow={false} />}
            footer={
              <Pager
                path="/customers"
                filters={filters}
                page={filters.page}
                pages={list.pages}
                total={list.total}
                className="mt-0 border-t border-border/70 px-5 py-3"
              />
            }
          />
        </div>
      </div>
    </>
  );
}

function CustomerInsightRow({
  filters,
  stats,
  statuses,
  total,
}: {
  filters: Filters;
  stats: Awaited<ReturnType<typeof customerInsights>>;
  statuses: { id: string; name: string; color: string }[];
  total: number;
}) {
  if (!total) return null;
  // 点分布项 = 在当前筛选上再叠加这一条
  const href = (key: string, value: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (k !== "page" && v) q.set(k, String(v));
    q.set(key, value);
    return `/customers?${q}`;
  };
  const statusParts = stats.status.map((x) => {
    const st = statuses.find((s) => s.id === x.id);
    return {
      label: st?.name ?? "未设置",
      value: x.count,
      color: st ? (TONE[st.color] ?? OTHER) : OTHER,
      href: st ? href("status", st.id) : undefined,
    };
  });
  const countryParts = stats.country.map((x) => ({
    label: x.code ? countryName(x.code) : "未填写",
    value: x.count,
    href: x.code ? href("country", x.code) : undefined,
  }));
  const starParts = [5, 4, 3, 2, 1, 0].map((n) => ({
    label: n ? "★".repeat(n) : "未评级",
    value: stats.star.find((x) => x.star === n)?.count ?? 0,
    color: n ? RAMP[Math.max(0, Math.min(3, n - 2))] : OTHER,
    href: n ? href("star", String(n)) : undefined,
  }));
  const i = stats.idle;
  const contacted30 = i.d7 + i.d30;
  return (
    <InsightRow>
      <InsightCard title="客户状态" value={`${total} 家`} hint="点一项可叠加筛选">
        <Breakdown parts={statusParts} unit=" 家" max={6} />
      </InsightCard>
      <InsightCard title="国家 / 地区" value={`${countryParts.filter((p) => p.label !== "未填写").length} 个`} hint="客户数前五">
        <Breakdown parts={countryParts} unit=" 家" />
      </InsightCard>
      <InsightCard title="客户星级" value={`${starParts.slice(0, 2).reduce((n, p) => n + p.value, 0)} 家`} hint="四星及以上的重点客户">
        <Breakdown parts={starParts} unit=" 家" max={6} sort={false} />
      </InsightCard>
      <InsightCard title="多久没联系" value={`${Math.round((contacted30 / total) * 100)}%`} hint={`30 天内联系过 ${contacted30} 家`}>
        <RecencyBar
          unit=" 家"
          parts={[
            { label: "7 天内", value: i.d7, color: RAMP[3], dark: true },
            { label: "30 天内", value: i.d30, color: RAMP[2], dark: true },
            { label: "90 天内", value: i.d90, color: RAMP[1] },
            { label: "超过 90 天", value: i.old, color: RAMP[0] },
            { label: "从未联系", value: i.never, color: "oklch(0.9 0.01 262)" },
          ]}
        />
      </InsightCard>
    </InsightRow>
  );
}
