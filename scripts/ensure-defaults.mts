// 给已有企业补齐默认的客户状态、商机阶段、客户分组：pnpm job:ensure-defaults
import "dotenv/config";
import { prisma } from "@/server/db";
import { ensureTenantDefaults } from "@/server/defaults";

const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
for (const t of tenants) {
  await prisma.$transaction((tx) => ensureTenantDefaults(tx, t.id));
  console.log(`✓ ${t.name}`);
}
await prisma.$disconnect();
