import "server-only";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

export const DEFAULT_STATUSES = [
  { name: "潜在客户", color: "slate" },
  { name: "询盘客户", color: "blue" },
  { name: "样品客户", color: "amber" },
  { name: "成交客户", color: "emerald" },
  { name: "复购客户", color: "violet" },
  { name: "流失客户", color: "rose" },
];

export const DEFAULT_STAGES = [
  { name: "初步接洽", probability: 10, kind: "OPEN" as const },
  { name: "需求确认", probability: 20, kind: "OPEN" as const },
  { name: "报价", probability: 40, kind: "OPEN" as const },
  { name: "打样", probability: 60, kind: "OPEN" as const },
  { name: "谈判 / PI", probability: 80, kind: "OPEN" as const },
  { name: "赢单", probability: 100, kind: "WON" as const },
  { name: "输单", probability: 0, kind: "LOST" as const },
];

export const DEFAULT_GROUPS = ["重点客户", "普通客户"];

/** 给企业补齐默认的客户状态、商机阶段、客户分组（已有的不动） */
export async function ensureTenantDefaults(tx: Tx, tenantId: string) {
  const [statuses, stages, groups] = await Promise.all([
    tx.customerStatus.count({ where: { tenantId } }),
    tx.stage.count({ where: { tenantId } }),
    tx.customerGroup.count({ where: { tenantId } }),
  ]);
  if (!statuses) {
    await tx.customerStatus.createMany({
      data: DEFAULT_STATUSES.map((s, i) => ({ ...s, tenantId, sort: i })),
    });
  }
  if (!stages) {
    await tx.stage.createMany({ data: DEFAULT_STAGES.map((s, i) => ({ ...s, tenantId, sort: i })) });
  }
  if (!groups) {
    await tx.customerGroup.createMany({ data: DEFAULT_GROUPS.map((name, i) => ({ name, tenantId, sort: i })) });
  }
}
