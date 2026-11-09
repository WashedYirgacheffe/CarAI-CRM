import { tenantDb } from "@/server/db";
import { LEAD_STATUSES, parseLocalInput } from "@/lib/crm";
import { OTHER, dayKeys, dayLabel, sumByDay } from "@/lib/viz";
import type { Prisma } from "@/generated/prisma/client";
import { InsightCard, InsightRow } from "@/components/crm/insights";
import { Breakdown, Meter, MiniColumns } from "@/components/dashboard/viz";

const STATUS_TONE: Record<string, string> = {
  NEW: "var(--chart-1)",
  QUALIFYING: "var(--chart-4)",
  CONTACTED: "var(--chart-3)",
  CONVERTED: "var(--chart-2)",
  INVALID: OTHER,
};

const hours = (h: number) =>
  h < 1 ? `${Math.max(1, Math.round(h * 60))} 分钟` : h < 48 ? `${h < 10 ? h.toFixed(1) : Math.round(h)} 小时` : `${Math.round(h / 24)} 天`;

/** 询盘页顶部：每日新增、来源、状态、首次回复时长 */
export async function LeadInsights({ tenantId, tz, where }: { tenantId: string; tz: string; where: Prisma.LeadWhereInput }) {
  const db = tenantDb(tenantId);
  const keys = dayKeys(tz, 60);
  const since60 = parseLocalInput(`${keys[0]}T00:00`, tz)!;
  const since90 = parseLocalInput(`${dayKeys(tz, 90)[0]}T00:00`, tz)!;
  const [recent, bySource, byStatus] = await Promise.all([
    db.lead.findMany({ where: { AND: [where, { createdAt: { gte: since90 } }] }, select: { id: true, createdAt: true } }),
    db.lead.groupBy({ by: ["source"], where: { AND: [where, { createdAt: { gte: since90 } }] }, _count: { _all: true } }),
    db.lead.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const firstReply = recent.length
    ? await db.mailMessage.groupBy({ by: ["leadId"], where: { leadId: { in: recent.map((l) => l.id) }, folder: "SENT" }, _min: { date: true } })
    : [];

  const daily = sumByDay(
    keys,
    recent.filter((l) => l.createdAt >= since60),
    (l) => l.createdAt,
    tz,
  );
  const last30 = daily.slice(30).reduce((a, b) => a + b, 0);
  const prev30 = daily.slice(0, 30).reduce((a, b) => a + b, 0);
  const created = new Map(recent.map((l) => [l.id, l.createdAt.getTime()]));
  const waits = firstReply
    .map((r) => (r.leadId && r._min.date ? (r._min.date.getTime() - created.get(r.leadId)!) / 3_600_000 : -1))
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  const median = waits.length ? waits[Math.floor(waits.length / 2)] : null;
  const fast = waits.filter((h) => h <= 24).length;
  const total = byStatus.reduce((n, x) => n + x._count._all, 0);
  const converted = byStatus.find((x) => x.status === "CONVERTED")?._count._all ?? 0;
  const delta = last30 - prev30;

  return (
    <InsightRow>
      <InsightCard
        title="近 30 天新增询盘"
        value={last30}
        hint={prev30 || last30 ? `比前 30 天${delta === 0 ? "持平" : delta > 0 ? `多 ${delta} 条` : `少 ${-delta} 条`}` : "这段时间没有新询盘"}
      >
        <MiniColumns data={daily.slice(30).map((v, i) => ({ label: dayLabel(keys[30 + i]), value: v }))} unit=" 条" empty="近 30 天没有新询盘" />
      </InsightCard>
      <InsightCard title="询盘来源" hint="近 90 天">
        <Breakdown parts={bySource.map((x) => ({ label: x.source || "未填写", value: x._count._all }))} unit=" 条" empty="近 90 天没有询盘" />
      </InsightCard>
      <InsightCard title="转客户率" value={total ? `${Math.round((converted / total) * 100)}%` : "—"} hint={`全部 ${total} 条线索的状态`}>
        <Breakdown
          sort={false}
          unit=" 条"
          parts={LEAD_STATUSES.map((s) => ({
            label: s.label,
            value: byStatus.find((x) => x.status === s.value)?._count._all ?? 0,
            color: STATUS_TONE[s.value],
          }))}
        />
      </InsightCard>
      <InsightCard
        title="首次回复用时"
        value={median === null ? "—" : hours(median)}
        hint={recent.length ? `近 90 天中位数 · ${waits.length}/${recent.length} 条已发邮件回复` : "近 90 天没有询盘"}
      >
        {waits.length > 0 && (
          <>
            <Meter value={fast} max={waits.length} tone="var(--chart-2)" label="24 小时内回复占比" />
            <p className="mt-2 text-xs text-muted-foreground">
              24 小时内回复 <span className="font-medium text-foreground tabular-nums">{Math.round((fast / waits.length) * 100)}%</span>
              ，最快 {hours(waits[0])}
            </p>
          </>
        )}
      </InsightCard>
    </InsightRow>
  );
}
