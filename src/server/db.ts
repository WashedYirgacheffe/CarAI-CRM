import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

/**
 * 原始客户端，不做租户隔离。
 * 只用于登录、注册、会话这类跨租户或租户尚未确定的场景。
 * 业务代码请用 tenantDb(tenantId)。
 */
export const prisma = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** 带 tenantId 字段、需要强制隔离的模型。新增业务表时登记到这里。 */
const TENANT_MODELS = new Set<string>([
  "User",
  "Department",
  "Role",
  "Customer",
  "CustomerStatus",
  "CustomerGroup",
  "Contact",
  "Lead",
  "Stage",
  "Opportunity",
  "Activity",
  "Task",
]);

const WHERE_OPERATIONS = new Set<string>([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * 按租户隔离的客户端：
 * - 查询、更新、删除自动追加 where.tenantId
 * - 新建自动写入（并覆盖）tenantId
 * 嵌套写入（nested create/connect）不经过这里，业务代码里请用扁平写法。
 */
export function tenantDb(tenantId: string) {
  return prisma.$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a = (args ?? {}) as any;
          if (WHERE_OPERATIONS.has(operation)) {
            a.where = { ...a.where, tenantId };
          } else if (operation === "create") {
            a.data = { ...a.data, tenantId };
          } else if (
            operation === "createMany" ||
            operation === "createManyAndReturn"
          ) {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((row: object) => ({ ...row, tenantId }));
          } else if (operation === "upsert") {
            a.where = { ...a.where, tenantId };
            a.create = { ...a.create, tenantId };
          }
          return query(a);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
