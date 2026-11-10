// 图表共用的颜色与数字格式（前后端都能用）

/** 数量用的中性灰阶（浅 → 深），亮度单调；橙色只留给每张图里那一个重点 */
export const RAMP = ["oklch(0.88 0 0)", "oklch(0.75 0 0)", "oklch(0.56 0 0)", "oklch(0.32 0 0)"];

const compactFmt = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
export const compact = (n: number) => compactFmt.format(n);
export const yuan = (n: number) => `¥${compact(Math.round(n))}`;

/** 分类色，固定顺序（与 globals.css 的 --chart-1..5 一致） */
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
/** 「其他」/ 未设置 的中性灰 */
export const OTHER = "oklch(0.86 0 0)";

/** 单据状态的颜色名 → 图表色（同一状态在所有图里同色） */
export const TONE: Record<string, string> = {
  blue: "var(--chart-2)",
  emerald: "var(--chart-1)",
  teal: "var(--chart-1)",
  amber: "var(--chart-3)",
  violet: "var(--chart-4)",
  rose: "var(--chart-5)",
  slate: OTHER,
};

/** yyyy-mm 键（企业时区） */
export function monthKeys(tz: string, n: number, now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]),
  );
  const y = Number(p.year);
  const m = Number(p.month);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - n + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** 把记录按 yyyy-mm 求和 */
export function sumByMonth<T>(keys: string[], rows: T[], at: (r: T) => Date, v: (r: T) => number, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" });
  const out = keys.map(() => 0);
  for (const r of rows) {
    const i = keys.indexOf(fmt.format(at(r)));
    if (i >= 0) out[i] += v(r);
  }
  return out;
}

export const monthLabel = (k: string) => `${Number(k.slice(5, 7))}月`;

/** 最近 n 天的 yyyy-mm-dd 键（企业时区，最后一个是今天） */
export function dayKeys(tz: string, n: number, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const base = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** 把记录按 yyyy-mm-dd 求和（默认计数） */
export function sumByDay<T>(keys: string[], rows: T[], at: (r: T) => Date, tz: string, v: (r: T) => number = () => 1) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const index = new Map(keys.map((k, i) => [k, i]));
  const out = keys.map(() => 0);
  for (const r of rows) {
    const i = index.get(fmt.format(at(r)));
    if (i !== undefined) out[i] += v(r);
  }
  return out;
}

export const dayLabel = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
