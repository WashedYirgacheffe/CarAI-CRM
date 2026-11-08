import "server-only";
import { prisma } from "@/server/db";

/**
 * 把负责人超期未跟进的客户放回公海。
 * 判断依据：最近跟进时间（没有跟进过就用分配时间）早于 N 天前。
 * 在公海页面加载时按需执行，也可以用 `pnpm job:pool-recycle` 定时跑全量。
 */
export async function recyclePool(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { poolRecycleDays: true } });
  if (!tenant?.poolRecycleDays) return 0;
  const cutoff = new Date(Date.now() - tenant.poolRecycleDays * 86_400_000);

  const due = await prisma.customer.findMany({
    where: {
      tenantId,
      ownerId: { not: null },
      OR: [{ lastContactAt: { lt: cutoff } }, { lastContactAt: null, assignedAt: { lt: cutoff } }],
    },
    select: { id: true, owner: { select: { name: true } } },
    take: 1000,
  });
  if (!due.length) return 0;

  const now = new Date();
  const reason = `超过 ${tenant.poolRecycleDays} 天未跟进，自动回收`;
  await prisma.$transaction([
    prisma.customer.updateMany({
      where: { id: { in: due.map((c) => c.id) }, tenantId },
      data: { ownerId: null, assignedAt: null, poolEnteredAt: now, poolReason: reason, nextFollowAt: null },
    }),
    prisma.activity.createMany({
      data: due.map((c) => ({
        tenantId,
        customerId: c.id,
        type: "SYSTEM" as const,
        event: "recycled",
        content: `${reason}（原负责人：${c.owner?.name ?? "—"}）`,
      })),
    }),
  ]);
  return due.length;
}
