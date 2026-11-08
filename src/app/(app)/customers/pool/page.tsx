import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { CustomerFilters, Pager } from "@/components/crm/customer-filters";
import { CustomerTable } from "@/components/crm/customer-table";
import { can, requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { allMembers } from "@/server/scope";
import { claimedToday, recyclePool } from "@/server/customers";
import { customerOptions, listCustomers, parseFilters } from "@/server/customer-list";
import { dayRange } from "@/lib/crm";

export const metadata: Metadata = { title: "公海客户" };

export default async function PoolPage({ searchParams }: PageProps<"/customers/pool">) {
  const user = await requirePermission("pool.view");
  // 打开公海时顺手回收到期客户（另有定时任务 job:pool-recycle 兜底）
  await recyclePool(user.tenantId);
  const filters = parseFilters(await searchParams);
  const [list, options, members, tenant, used] = await Promise.all([
    listCustomers(user, filters, "pool"),
    customerOptions(user.tenantId),
    allMembers(user.tenantId),
    prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    claimedToday(user.id, user.tenantId, dayRange(user.timezone).start),
  ]);
  const rules = [
    tenant.poolRecycleDays ? `私海客户 ${tenant.poolRecycleDays} 天未跟进自动回收到公海` : "未开启自动回收",
    tenant.poolDailyClaimLimit ? `每人每天最多领取 ${tenant.poolDailyClaimLimit} 个（你今天已领 ${used} 个）` : "领取次数不限",
  ];
  return (
    <>
      <PageHeader title="公海客户" description={rules.join(" · ")} />
      <CustomerFilters action="/customers/pool" filters={filters} options={options} showFollow={false} />
      <CustomerTable
        rows={list.rows}
        mode="pool"
        tz={user.timezone}
        members={members}
        options={options}
        perms={{ claim: can(user, "pool.claim"), assign: can(user, "pool.assign") }}
      />
      <Pager path="/customers/pool" filters={filters} page={filters.page} pages={list.pages} total={list.total} />
    </>
  );
}
