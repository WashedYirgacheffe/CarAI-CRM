import "server-only";
import { prisma } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { scopeMembers, scopeOwnerIds } from "@/server/scope";
import { countryName, parseLocalInput } from "@/lib/crm";
import { ORDER_NOT_COUNTED, dateInput } from "@/lib/docs";
import type { Permission } from "@/lib/permissions";
import {
  METRIC_DIMS,
  metricDef,
  rangeLabel,
  type DimensionKey,
  type MetricKey,
  type MetricPoint,
  type MetricResult,
  type RangeKey,
  type TeamRow,
} from "@/lib/metrics";

/** 指标需要的权限（数据范围另由 scopeOwnerIds 限定） */
const NEED: Record<MetricKey, Permission> = {
  deal_amount: "order.view",
  order_count: "order.view",
  payment_amount: "order.view",
  quote_amount: "quotation.view",
  quote_count: "quotation.view",
  lead_count: "lead.view",
  customer_count: "customer.view",
  followup_count: "customer.view",
  mail_sent: "report.view",
  wa_sent: "report.view",
};

export const canMetric = (user: CurrentUser, m: MetricKey) => can(user, NEED[m]);

const DAY = 86_400_000;
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const ymd = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** 时间范围（企业时区）→ [start, end) 以及每天 / 每月的分桶 key */
export function resolveRange(range: RangeKey, tz: string) {
  const today = dateInput(tz);
  const [y, m] = today.split("-").map(Number);
  const [a, b]: [string, string] =
    range === "7d"
      ? [addDays(today, -6), today]
      : range === "30d"
        ? [addDays(today, -29), today]
        : range === "last-month"
          ? [ymd(y, m - 1), addDays(ymd(y, m), -1)]
          : range === "quarter"
            ? [ymd(y, Math.floor((m - 1) / 3) * 3 + 1), today]
            : range === "6m"
              ? [ymd(y, m - 5), today]
              : range === "year"
                ? [ymd(y, 1), today]
                : range === "12m"
                  ? [ymd(y, m - 11), today]
                  : [ymd(y, m), today];
  const start = parseLocalInput(`${a}T00:00`, tz)!;
  const end = parseLocalInput(`${addDays(b, 1)}T00:00`, tz)!;
  const days = Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;
  const bucket: "day" | "month" = days <= 45 ? "day" : "month";
  const keys: string[] = [];
  if (bucket === "day") for (let i = 0; i < days; i++) keys.push(addDays(a, i));
  else {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    for (let yy = ay, mm = am; yy < by || (yy === by && mm <= bm); mm === 12 ? ((yy += 1), (mm = 1)) : (mm += 1))
      keys.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return { start, end, bucket, keys, from: a, to: b };
}

type Row = { at: Date; owner: string | null; country?: string | null; source?: string | null; v: number };
const LIMIT = 50_000;

/** 取某个指标在范围内的原始行（已按权限和数据范围过滤） */
async function rows(user: CurrentUser, metric: MetricKey, start: Date, end: Date): Promise<Row[]> {
  const t = user.tenantId;
  const ids = await scopeOwnerIds(user);
  const when = { gte: start, lt: end };
  const owner = ids ? { ownerId: { in: ids } } : {};
  const cny = (a: unknown, r: unknown) => Number(a) * Number(r);
  switch (metric) {
    case "deal_amount":
    case "order_count": {
      const os = await prisma.order.findMany({
        where: { tenantId: t, orderDate: when, status: { notIn: [...ORDER_NOT_COUNTED] }, ...owner },
        select: { orderDate: true, ownerId: true, total: true, exchangeRate: true, customer: { select: { country: true } } },
        take: LIMIT,
      });
      return os.map((o) => ({
        at: o.orderDate,
        owner: o.ownerId,
        country: o.customer?.country,
        v: metric === "order_count" ? 1 : cny(o.total, o.exchangeRate),
      }));
    }
    case "payment_amount": {
      const ps = await prisma.orderPayment.findMany({
        where: { tenantId: t, receivedAt: when, ...(ids ? { order: { ownerId: { in: ids } } } : {}) },
        select: { receivedAt: true, amount: true, order: { select: { ownerId: true, exchangeRate: true } } },
        take: LIMIT,
      });
      return ps.map((p) => ({ at: p.receivedAt, owner: p.order.ownerId, v: cny(p.amount, p.order.exchangeRate) }));
    }
    case "quote_amount":
    case "quote_count": {
      const qs = await prisma.quotation.findMany({
        where: { tenantId: t, quoteDate: when, ...owner },
        select: { quoteDate: true, ownerId: true, total: true, exchangeRate: true, customer: { select: { country: true } } },
        take: LIMIT,
      });
      return qs.map((q) => ({
        at: q.quoteDate,
        owner: q.ownerId,
        country: q.customer?.country,
        v: metric === "quote_count" ? 1 : cny(q.total, q.exchangeRate),
      }));
    }
    case "lead_count": {
      const ls = await prisma.lead.findMany({
        where: { tenantId: t, createdAt: when, ...(ids ? { OR: [{ ownerId: { in: ids } }, { ownerId: null }] } : {}) },
        select: { createdAt: true, ownerId: true, country: true, source: true },
        take: LIMIT,
      });
      return ls.map((l) => ({ at: l.createdAt, owner: l.ownerId, country: l.country, source: l.source, v: 1 }));
    }
    case "customer_count": {
      const cs = await prisma.customer.findMany({
        where: { tenantId: t, createdAt: when, ...owner },
        select: { createdAt: true, ownerId: true, country: true, source: true },
        take: LIMIT,
      });
      return cs.map((c) => ({ at: c.createdAt, owner: c.ownerId, country: c.country, source: c.source, v: 1 }));
    }
    case "followup_count": {
      const as = await prisma.activity.findMany({
        where: { tenantId: t, type: "FOLLOW_UP", createdAt: when, ...(ids ? { userId: { in: ids } } : {}) },
        select: { createdAt: true, userId: true },
        take: LIMIT,
      });
      return as.map((a) => ({ at: a.createdAt, owner: a.userId, v: 1 }));
    }
    case "mail_sent": {
      const ms = await prisma.mailMessage.findMany({
        where: { tenantId: t, folder: "SENT", date: when, ...(ids ? { account: { userId: { in: ids } } } : {}) },
        select: { date: true, account: { select: { userId: true } } },
        take: LIMIT,
      });
      return ms.map((m) => ({ at: m.date, owner: m.account.userId, v: 1 }));
    }
    case "wa_sent": {
      const ws = await prisma.waMessage.findMany({
        where: { tenantId: t, fromMe: true, timestamp: when, ...(ids ? { account: { userId: { in: ids } } } : {}) },
        select: { timestamp: true, account: { select: { userId: true } } },
        take: LIMIT,
      });
      return ws.map((w) => ({ at: w.timestamp, owner: w.account.userId, v: 1 }));
    }
  }
}

export class MetricError extends Error {}

/** 查询一个指标：按时间 / 成员 / 国家 / 来源汇总 */
export async function queryMetric(user: CurrentUser, metric: MetricKey, by: DimensionKey, range: RangeKey): Promise<MetricResult> {
  const def = metricDef(metric)!;
  if (!canMetric(user, metric)) throw new MetricError(`没有查看「${def.label}」的权限`);
  if (!METRIC_DIMS[metric].includes(by))
    throw new MetricError(`「${def.label}」不支持${by === "source" ? "按来源" : by === "country" ? "按国家" : "这个维度"}统计`);
  const tz = user.timezone;
  const r = resolveRange(range, tz);
  const data = await rows(user, metric, r.start, r.end);
  const total = data.reduce((n, x) => n + x.v, 0);
  let points: MetricPoint[];

  if (by === "time") {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const sums = new Map(r.keys.map((k) => [k, 0]));
    for (const x of data) {
      const k = fmt.format(x.at).slice(0, r.bucket === "day" ? 10 : 7);
      if (sums.has(k)) sums.set(k, sums.get(k)! + x.v);
    }
    points = r.keys.map((k) => ({
      label: r.bucket === "day" ? `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : `${k.slice(2, 4)}年${Number(k.slice(5, 7))}月`,
      value: sums.get(k)!,
    }));
  } else {
    const sums = new Map<string, number>();
    const keyOf = (x: Row) => (by === "member" ? (x.owner ?? "") : by === "country" ? (x.country ?? "") : (x.source ?? ""));
    for (const x of data) sums.set(keyOf(x), (sums.get(keyOf(x)) ?? 0) + x.v);
    let names = new Map<string, string>();
    if (by === "member") {
      const members = await scopeMembers(user);
      names = new Map(members.map((m) => [m.id, m.name]));
      // 范围内没数据的成员也列出来（显示 0），排行更直观
      for (const m of members) if (!sums.has(m.id)) sums.set(m.id, 0);
      const missing = [...sums.keys()].filter((k) => k && !names.has(k));
      if (missing.length) {
        for (const u of await prisma.user.findMany({ where: { tenantId: user.tenantId, id: { in: missing } }, select: { id: true, name: true } })) {
          names.set(u.id, u.name);
        }
      }
    }
    const label = (k: string) =>
      by === "member" ? (k ? (names.get(k) ?? "已删除成员") : "未分配") : by === "country" ? (k ? countryName(k) : "未填写") : k || "未填写";
    points = [...sums.entries()].map(([k, value]) => ({ label: label(k), value })).sort((a, b) => b.value - a.value);
  }

  const byLabel = by === "time" ? "走势" : by === "member" ? "按成员" : by === "country" ? "按国家" : "按来源";
  return {
    metric,
    by,
    range,
    unit: def.unit,
    total,
    points,
    title: `${rangeLabel(range)}${def.label}${byLabel}`,
    ...(by === "time" ? { bucket: r.bucket } : {}),
  };
}

/** 团队业绩：数据范围内每个成员的关键数字 */
export async function teamSummary(user: CurrentUser, range: RangeKey): Promise<{ rows: TeamRow[]; from: string; to: string }> {
  if (!can(user, "report.view")) throw new MetricError("没有查看团队数据的权限");
  const r = resolveRange(range, user.timezone);
  const members = await scopeMembers(user);
  const [orders, quotes, follows, customers, leads] = await Promise.all([
    rows(user, "deal_amount", r.start, r.end),
    can(user, "quotation.view") ? rows(user, "quote_count", r.start, r.end) : [],
    rows(user, "followup_count", r.start, r.end),
    rows(user, "customer_count", r.start, r.end),
    can(user, "lead.view") ? rows(user, "lead_count", r.start, r.end) : [],
  ]);
  const of = (xs: Row[], id: string, sum = false) => xs.filter((x) => x.owner === id).reduce((n, x) => n + (sum ? x.v : 1), 0);
  const out = members.map((m) => ({
    id: m.id,
    name: m.name,
    deal: of(orders, m.id, true),
    orders: of(orders, m.id),
    quotes: of(quotes, m.id),
    followups: of(follows, m.id),
    customers: of(customers, m.id),
    leads: of(leads, m.id),
  }));
  out.sort((a, b) => b.deal - a.deal || b.followups - a.followups);
  return { rows: out, from: r.from, to: r.to };
}
