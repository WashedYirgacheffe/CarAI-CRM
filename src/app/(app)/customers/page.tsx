import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { CustomerFilters, Pager } from "@/components/crm/customer-filters";
import { CustomerTable, NewCustomerButton } from "@/components/crm/customer-table";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { scopeMembers, scopeOwnerIds } from "@/server/scope";
import { customerOptions, listCustomers, parseFilters } from "@/server/customer-list";
import { listSegments } from "@/server/segments";
import { SegmentBar } from "@/components/crm/segment-bar";
import { CUSTOMER_FILTER_KEYS, FOLLOW_OPTIONS } from "@/lib/segments";

export const metadata: Metadata = { title: "我的客户" };

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const user = await requirePermission("customer.view");
  const filters = parseFilters(await searchParams);
  const active = CUSTOMER_FILTER_KEYS.filter((k) => filters[k]);
  const [list, options, members, segments, allCount] = await Promise.all([
    listCustomers(user, filters, "mine"),
    customerOptions(user.tenantId),
    scopeMembers(user),
    listSegments(user),
    // 「全部客户」的总数：没有筛选时就是列表总数，不用再查
    active.length || filters.seg
      ? scopeOwnerIds(user).then((scope) =>
          tenantDb(user.tenantId).customer.count({ where: { ownerId: scope ? { in: scope } : { not: null } } }),
        )
      : null,
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
