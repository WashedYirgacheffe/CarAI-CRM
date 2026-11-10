import { tenantDb } from "@/server/db";
import { dayRange } from "@/lib/crm";
import { ORDER_NOT_COUNTED } from "@/lib/docs";
import { yuan } from "@/lib/viz";
import { Meter, StackedDaily } from "@/components/dashboard/viz";

const WEEKS = 16;
const WEEK = 7 * 86_400_000;

type Doc = { status: string; total: { toString(): string }; exchangeRate: { toString(): string }; paidAmount?: { toString(): string } };

/** 客户详情：往来时间线（按周）+ 成交回款 + 报价转化 */
export async function CustomerInsights({
  tenantId,
  customerId,
  tz,
  quotations,
  orders,
}: {
  tenantId: string;
  customerId: string;
  tz: string;
  quotations: Doc[] | null;
  orders: Doc[] | null;
}) {
  const db = tenantDb(tenantId);
  const { end } = dayRange(tz);
  const since = new Date(end.getTime() - WEEKS * WEEK);
  const chats = await db.waChat.findMany({ where: { customerId }, select: { id: true } });
  const [follows, mails, was] = await Promise.all([
    db.activity.findMany({ where: { customerId, type: "FOLLOW_UP", createdAt: { gte: since } }, select: { createdAt: true } }),
    db.mailMessage.findMany({ where: { customerId, date: { gte: since } }, select: { date: true, folder: true } }),
    chats.length
      ? db.waMessage.findMany({
          where: { chatId: { in: chats.map((c) => c.id) }, timestamp: { gte: since } },
          select: { timestamp: true, fromMe: true },
        })
      : [],
  ]);

  const bucket = (t: Date) => WEEKS - 1 - Math.floor((end.getTime() - 1 - t.getTime()) / WEEK);
  const count = <T,>(rows: T[], at: (r: T) => Date) => {
    const out = Array<number>(WEEKS).fill(0);
    for (const r of rows) {
      const i = bucket(at(r));
      if (i >= 0 && i < WEEKS) out[i]++;
    }
    return out;
  };
  const md = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric", day: "numeric" });
  const labels = Array.from({ length: WEEKS }, (_, i) => md.format(new Date(end.getTime() - (WEEKS - i) * WEEK)) + " 周");
  const series = [
    { label: "跟进", color: "var(--chart-1)", values: count(follows, (r) => r.createdAt) },
    {
      label: "发邮件",
      color: "var(--chart-2)",
      values: count(
        mails.filter((m) => m.folder === "SENT"),
        (r) => r.date,
      ),
    },
    {
      label: "收邮件",
      color: "var(--chart-3)",
      values: count(
        mails.filter((m) => m.folder !== "SENT"),
        (r) => r.date,
      ),
    },
    {
      label: "WA 发出",
      color: "var(--chart-4)",
      values: count(
        was.filter((m) => m.fromMe),
        (r) => r.timestamp,
      ),
    },
    {
      label: "WA 收到",
      color: "var(--chart-5)",
      values: count(
        was.filter((m) => !m.fromMe),
        (r) => r.timestamp,
      ),
    },
  ];
  const touches = series.reduce((n, s) => n + s.values.reduce((a, b) => a + b, 0), 0);
  const inbound = series[2].values.concat(series[4].values).reduce((a, b) => a + b, 0);

  const cny = (d: Doc, v: { toString(): string }) => Number(v.toString()) * Number(d.exchangeRate.toString());
  const live = orders?.filter((o) => !(ORDER_NOT_COUNTED as readonly string[]).includes(o.status)) ?? [];
  const deal = live.reduce((n, o) => n + cny(o, o.total), 0);
  const paid = live.reduce((n, o) => n + cny(o, o.paidAmount ?? 0), 0);
  const sentQuotes = quotations?.filter((q) => q.status !== "DRAFT") ?? [];
  const won = sentQuotes.filter((q) => q.status === "CONVERTED" || q.status === "ACCEPTED").length;

  const stats = [
    { label: `近 ${WEEKS} 周往来`, value: `${touches}`, hint: touches ? `其中客户主动 ${inbound} 次` : "这段时间没有往来" },
    orders && { label: "累计成交", value: yuan(deal), hint: `${live.length} 笔订单（折人民币）` },
    orders && {
      label: "回款进度",
      value: deal ? `${Math.round((paid / deal) * 100)}%` : "—",
      hint: deal ? `已收 ${yuan(paid)}，待收 ${yuan(Math.max(0, deal - paid))}` : "暂无订单",
      meter: { value: paid, max: deal, tone: "var(--chart-2)" },
    },
    quotations && {
      label: "报价转化",
      value: sentQuotes.length ? `${Math.round((won / sentQuotes.length) * 100)}%` : "—",
      hint: sentQuotes.length ? `${sentQuotes.length} 份报价，${won} 份接受/转订单` : "暂无已发报价",
      meter: { value: won, max: sentQuotes.length, tone: "var(--chart-1)" },
    },
  ].filter(Boolean) as { label: string; value: string; hint: string; meter?: { value: number; max: number; tone: string } }[];

  return (
    <section className="surface p-4 md:p-5">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">往来概况</h2>
        <span className="text-xs text-muted-foreground">近 {WEEKS} 周，按周统计</span>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0 rounded-xl bg-muted/50 p-3">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-0.5 text-xl leading-tight font-normal tabular-nums">{s.value}</dd>
            {s.meter && (
              <div className="mt-1.5">
                <Meter value={s.meter.value} max={s.meter.max} tone={s.meter.tone} label={s.label} />
              </div>
            )}
            <p className="mt-1 truncate text-[11px] text-muted-foreground">{s.hint}</p>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        <StackedDaily labels={labels} series={series} empty={`近 ${WEEKS} 周没有往来记录`} />
      </div>
    </section>
  );
}
