import "server-only";
import { tenantDb } from "@/server/db";
import { visitView } from "@/server/share-track";
import type { VisitEvent, VisitView } from "@/lib/share-visit";

export type ProductStats = {
  visits: number;
  visits30: number;
  visitors: number;
  customers: number;
  /** 平均每次看多久（只算有停留数据的） */
  avgMs: number;
  /** 各区块：累计停留、有多少次访问看到了它 */
  sections: { name: string; ms: number; reach: number }[];
  /** 各按钮被点了几次（WhatsApp、询价、邮件…） */
  clicks: { name: string; count: number }[];
  recent: (VisitView & { customer: { id: string; name: string } | null })[];
};

/** 产品卡的查看数据：产品页展示，也给 AI 优化 Listing 当参考 */
export async function productStats(tenantId: string, productId: string, now = new Date()): Promise<ProductStats> {
  const db = tenantDb(tenantId);
  const rows = await db.shareVisit.findMany({
    where: { productId },
    orderBy: { startedAt: "desc" },
    take: 1000,
    include: { customer: { select: { id: true, name: true } } },
  });
  const since30 = now.getTime() - 30 * 86_400_000;
  const sections = new Map<string, { ms: number; reach: number }>();
  const clicks = new Map<string, number>();
  let activeSum = 0;
  let activeN = 0;
  for (const v of rows) {
    if (v.activeMs > 0) {
      activeSum += v.activeMs;
      activeN++;
    }
    for (const [name, ms] of Object.entries((v.sections as Record<string, number>) ?? {})) {
      const s = sections.get(name) ?? { ms: 0, reach: 0 };
      s.ms += ms;
      if (ms >= 1000) s.reach++;
      sections.set(name, s);
    }
    for (const e of (v.events as VisitEvent[]) ?? []) if (e.type === "click" && e.name) clicks.set(e.name, (clicks.get(e.name) ?? 0) + 1);
  }
  return {
    visits: rows.length,
    visits30: rows.filter((v) => v.startedAt.getTime() >= since30).length,
    visitors: new Set(rows.map((v) => v.visitorKey)).size,
    customers: new Set(rows.map((v) => v.customerId).filter(Boolean)).size,
    avgMs: activeN ? Math.round(activeSum / activeN) : 0,
    sections: [...sections].map(([name, s]) => ({ name, ...s })).sort((a, b) => b.ms - a.ms),
    clicks: [...clicks].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    recent: rows.slice(0, 20).map((v) => ({ ...visitView(v), customer: v.customer })),
  };
}
