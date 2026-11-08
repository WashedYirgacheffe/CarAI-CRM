import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { PoolRulesForm } from "./pool-rules-form";

export const metadata: Metadata = { title: "公海规则" };

export default async function PoolRulesPage() {
  const user = await requirePermission("settings.business");
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  return (
    <>
      <PageHeader title="公海规则" description="控制私海客户何时回收到公海，以及每人能领取多少客户。填 0 表示不限制。" />
      <PoolRulesForm
        defaults={{
          poolRecycleDays: t.poolRecycleDays,
          poolDailyClaimLimit: t.poolDailyClaimLimit,
          privateCustomerLimit: t.privateCustomerLimit,
        }}
      />
    </>
  );
}
