import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { isMemoryAdmin, visibleWhere } from "@/server/ai-memory";
import { MemoryManager, type MemoryItem, type MemoryStats } from "./memory-manager";

export const metadata: Metadata = { title: "AI 记忆" };

/** 使用情况：核心规则每轮都带，不算「没用上」 */
function statsOf(rows: { status: string; trusted: boolean; useCount: number; lastUsedAt: Date | null; createdAt: Date }[]): MemoryStats {
  const live = rows.filter((m) => m.status === "active");
  const now = Date.now();
  return {
    live: live.length,
    used: live.filter((m) => m.lastUsedAt && now - m.lastUsedAt.getTime() < 30 * 86_400_000).length,
    idle: live.filter((m) => !m.useCount && !m.trusted && now - m.createdAt.getTime() > 7 * 86_400_000).length,
    unconfirmed: live.filter((m) => !m.trusted).length,
  };
}

export default async function MemoryPage() {
  const user = await requirePermission("ai.use");
  const admin = isMemoryAdmin(user);
  const rows = await tenantDb(user.tenantId).aiMemory.findMany({
    where: {
      AND: [await visibleWhere(user)],
      OR: [{ status: "active" }, { status: "archived" }, { status: "proposed", ...(admin ? {} : { userId: user.id }) }],
    },
    omit: { embedding: true },
    include: { customer: { select: { id: true, name: true } } },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 600,
  });
  const items: MemoryItem[] = rows.map((m) => ({
    id: m.id,
    scope: m.scope as MemoryItem["scope"],
    kind: m.kind as MemoryItem["kind"],
    title: m.title,
    content: m.content === m.title ? "" : m.content,
    source: m.source as MemoryItem["source"],
    trusted: m.trusted,
    confirmed: !!m.confirmedById && m.source !== "user_said",
    disputed: m.disputed,
    pinned: m.pinned,
    status: m.status as MemoryItem["status"],
    useCount: m.useCount,
    updatedAt: m.updatedAt.toISOString(),
    promotedFrom: m.origin?.startsWith("promote:") && m.createdByKind === "ai" ? m.origin.slice(8).split(",").length : 0,
    customer: m.customer,
    mine: m.userId === user.id,
    // 能看到的个人 / 客户记忆都能改；团队的只有管理员
    canEdit: m.scope !== "team" || admin,
  }));
  const stats = statsOf(rows);
  return (
    <>
      <PageHeader title="AI 记忆" description="AI 在聊天里记下的规矩、偏好和客户情况。说过的话它会照着做，记错了在这里改。" />
      <MemoryManager items={items} admin={admin} stats={stats} />
    </>
  );
}
