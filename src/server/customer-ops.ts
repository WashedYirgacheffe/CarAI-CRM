import "server-only";
import { prisma, tenantDb } from "@/server/db";
import { audit } from "@/server/audit";
import { moveToPoolQuery, refreshPoolDue } from "@/server/pool";

/*
 * 客户的转移 / 退公海 / 删除：权限和范围由调用方检查。
 * 业务员直接操作、审批通过后由审批人执行，都走这里。
 */

type Actor = { id: string; name: string; tenantId: string };
export type CustomerRow = { id: string; name: string; owner?: { name: string } | null };

/** 还在私海（有负责人）的客户 */
export async function privateRows(tenantId: string, ids: string[]): Promise<CustomerRow[]> {
  return tenantDb(tenantId).customer.findMany({
    where: { id: { in: ids }, ownerId: { not: null } },
    select: { id: true, name: true, owner: { select: { name: true } } },
  });
}

export async function transferCustomers(actor: Actor, rows: CustomerRow[], target: { id: string; name: string }, note = "") {
  const now = new Date();
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE "Customer" SET "prevOwnerId" = "ownerId", "ownerId" = ${target.id}, "assignedAt" = ${now}, "updatedAt" = ${now}
      WHERE "tenantId" = ${actor.tenantId} AND "id" = ANY(${rows.map((r) => r.id)}) AND "ownerId" IS DISTINCT FROM ${target.id}`,
    prisma.activity.createMany({
      data: rows.map((r) => ({
        tenantId: actor.tenantId,
        customerId: r.id,
        type: "SYSTEM" as const,
        event: "transferred",
        content: `负责人由 ${r.owner?.name ?? "—"} 转为 ${target.name}${note}`,
        userId: actor.id,
      })),
    }),
  ]);
  await refreshPoolDue(actor.tenantId, rows.map((r) => r.id));
  await audit(
    actor,
    rows.map((r) => ({
      action: "transfer",
      entity: "customer",
      entityId: r.id,
      entityName: r.name,
      summary: `把客户「${r.name}」从 ${r.owner?.name ?? "—"} 转给了 ${target.name}${note}`,
    })),
  );
}

export async function releaseCustomers(actor: Actor, rows: CustomerRow[], why: string, note = "") {
  const now = new Date();
  await prisma.$transaction([
    moveToPoolQuery(
      actor.tenantId,
      rows.map((r) => r.id),
      why,
      now,
    ),
    prisma.activity.createMany({
      data: rows.map((r) => ({
        tenantId: actor.tenantId,
        customerId: r.id,
        type: "SYSTEM" as const,
        event: "released",
        content: `放入公海：${why}${note}`,
        userId: actor.id,
      })),
    }),
  ]);
  await audit(
    actor,
    rows.map((r) => ({
      action: "release",
      entity: "customer",
      entityId: r.id,
      entityName: r.name,
      summary: `把客户「${r.name}」放入公海：${why}${note}`,
    })),
  );
}

export async function deleteCustomers(actor: Actor, rows: { id: string; name: string }[], note = "") {
  await tenantDb(actor.tenantId).customer.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  await audit(
    actor,
    rows.map((r) => ({ action: "delete", entity: "customer", entityId: r.id, entityName: r.name, summary: `删除了客户「${r.name}」${note}` })),
  );
}
