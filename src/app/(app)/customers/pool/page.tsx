import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { CustomerFilters, Pager } from "@/components/crm/customer-filters";
import { CustomerTable } from "@/components/crm/customer-table";
import { SegmentBar } from "@/components/crm/segment-bar";
import { can, requirePermission } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { allMembers } from "@/server/scope";
import { claimedToday, recyclePool } from "@/server/customers";
import { customerOptions, listCustomers, parseFilters } from "@/server/customer-list";
import { dayRange } from "@/lib/crm";
import { CUSTOMER_FILTER_KEYS, FOLLOW_OPTIONS } from "@/lib/segments";

export const metadata: Metadata = { title: "公海客户" };

/** 公海里有意义的快捷筛选（「待跟进」「即将进公海」只针对私海客户） */
const POOL_QUICK = FOLLOW_OPTIONS.filter((o) => o.value === "stale" || o.value === "never");

export default async function PoolPage({ searchParams }: PageProps<"/customers/pool">) {
  const user = await requirePermission("pool.view");
  // 打开公海时顺手回收到期客户（另有定时任务 job:pool-recycle 兜底）
  await recyclePool(user.tenantId);
  const filters = parseFilters(await searchParams);
  // 公海列表忽略负责人筛选
  const active = CUSTOMER_FILTER_KEYS.filter((k) => k !== "owner" && filters[k]);
  const [list, options, members, tenant, used, allCount] = await Promise.all([
    listCustomers(user, filters, "pool"),
    customerOptions(user.tenantId),
    allMembers(user.tenantId),
    prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    claimedToday(user.id, user.tenantId, dayRange(user.timezone).start),
    active.length ? tenantDb(user.tenantId).customer.count({ where: { ownerId: null } }) : null,
  ]);
  const rules = [
    tenant.poolRecycleDays ? `私海客户 ${tenant.poolRecycleDays} 天未跟进自动回收到公海` : "未开启自动回收",
    tenant.poolDailyClaimLimit ? `每人每天最多领取 ${tenant.poolDailyClaimLimit} 个（你今天已领 ${used} 个）` : "领取次数不限",
  ];
  const quick = active.length === 1 && filters.follow ? POOL_QUICK.find((o) => o.value === filters.follow) : undefined;
  const title = quick?.label ?? (active.length ? "筛选结果" : "全部公海客户");

  return (
    <>
      <PageHeader
        title="公海客户"
        description={rules.join(" · ")}
      />
      <div className="flex flex-col overflow-hidden surface lg:flex-row">
        <SegmentBar
          path="/customers/pool"
          segments={[]}
          filters={filters}
          canShare={false}
          allLabel="全部公海客户"
          allCount={allCount ?? list.total}
          quick={POOL_QUICK}
          allowSave={false}
        />
        <div className="min-w-0 flex-1">
          <CustomerTable
            rows={list.rows}
            mode="pool"
            tz={user.timezone}
            members={members}
            title={title}
            total={list.total}
            perms={{ claim: can(user, "pool.claim"), assign: can(user, "pool.assign") }}
            toolbar={<CustomerFilters action="/customers/pool" filters={filters} options={options} showFollow={false} />}
            footer={
              <Pager
                path="/customers/pool"
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
