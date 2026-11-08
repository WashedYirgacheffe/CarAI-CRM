// 全量执行公海自动回收，建议每小时跑一次（cron）：pnpm job:pool-recycle
import "dotenv/config";
import { prisma } from "@/server/db";
import { recyclePool } from "@/server/pool";

const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
for (const t of tenants) {
  const n = await recyclePool(t.id);
  if (n) console.log(`${t.name}: 回收 ${n} 个客户`);
}
await prisma.$disconnect();
