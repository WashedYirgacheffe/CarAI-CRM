"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/crm";

/** 分类色，固定顺序取用（与 globals.css 的 --chart-1..5 一致），超过 5 类归入「其他」 */
const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const OTHER = "oklch(0.82 0.015 262)";

export type Slice = { label: string; value: number };

/** 前 5 类 + 其他 */
function foldSlices(data: Slice[]): (Slice & { color: string })[] {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, 5).map((d, i) => ({ ...d, color: SERIES[i] }));
  const rest = sorted.slice(5).reduce((n, d) => n + d.value, 0);
  return rest > 0 ? [...head, { label: "其他", value: rest, color: OTHER }] : head;
}

/** 环形图 + 右侧图例（带数值和占比），悬停高亮 */
export function Donut({ data, unit = "", empty = "暂无数据" }: { data: Slice[]; unit?: string; empty?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const slices = foldSlices(data);
  const total = slices.reduce((n, s) => n + s.value, 0);
  if (!total) return <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>;

  const R = 52;
  const W = 14;
  const C = 2 * Math.PI * R;
  const GAP = slices.length > 1 ? 2 : 0;
  const offsets = slices.map((_, i) => slices.slice(0, i).reduce((n, x) => n + (x.value / total) * C, 0));
  const focus = hover !== null ? slices[hover] : null;

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 140 140" className="size-36 shrink-0 -rotate-90" role="img" aria-label="分布环形图">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-muted)" strokeWidth={W} />
        {slices.map((s, i) => {
          const len = (s.value / total) * C;
          return (
            <circle
              key={s.label}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === i ? W + 4 : W}
              strokeDasharray={`${Math.max(len - GAP, 0.5)} ${C}`}
              strokeDashoffset={-offsets[i]}
              className="cursor-pointer transition-[stroke-width,opacity] duration-150"
              opacity={hover === null || hover === i ? 1 : 0.35}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${s.label}：${s.value}${unit}`}</title>
            </circle>
          );
        })}
        <g className="rotate-90" style={{ transformOrigin: "70px 70px" }}>
          <text x="70" y="68" textAnchor="middle" className="fill-foreground text-[22px] font-bold tabular-nums">
            {focus ? focus.value : total}
          </text>
          <text x="70" y="86" textAnchor="middle" className="fill-muted-foreground text-[11px]">
            {focus ? focus.label : "合计"}
          </text>
        </g>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s, i) => (
          <li
            key={s.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={cn("flex items-center gap-2 rounded-md px-1.5 py-0.5 text-sm transition-colors", hover === i && "bg-muted")}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="font-medium tabular-nums">{s.value}</span>
            <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 竖向柱状图（单系列），悬停显示数值，最高柱和最后一柱直接标数 */
export function BarTrend({
  data,
  currency,
  empty = "暂无数据",
}: {
  data: { label: string; value: number }[];
  /** 数值按这个币种显示 */
  currency: string;
  empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  if (!max) return <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>;
  const peak = data.findIndex((d) => d.value === max);
  const last = data.length - 1;

  return (
    <div className="flex h-48 items-end gap-3 pt-6">
      {data.map((d, i) => {
        const h = Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0);
        const labelled = hover === i || (hover === null && (i === peak || i === last));
        return (
          <div
            key={d.label}
            className="group flex h-full flex-1 flex-col items-center justify-end gap-2"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="relative flex w-full flex-1 items-end justify-center">
              <div
                className={cn(
                  "w-full max-w-10 rounded-t-[4px] transition-colors",
                  i === last ? "bg-[var(--chart-1)]" : "bg-[color-mix(in_oklch,var(--chart-1)_45%,white)]",
                  hover === i && "bg-[var(--chart-1)]",
                )}
                style={{ height: `${h}%` }}
              />
              {labelled && (
                <span
                  className="absolute -translate-y-full pb-1 text-xs font-medium whitespace-nowrap text-foreground tabular-nums"
                  style={{ bottom: `${h}%` }}
                >
                  {formatMoney(d.value, currency)}
                </span>
              )}
            </div>
            <span className={cn("text-xs text-muted-foreground", i === last && "font-medium text-foreground")}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 横向条：阶段 / 排名，条长按最大值，数值直接标在右侧 */
export function HBars({
  data,
  empty = "暂无数据",
}: {
  data: { label: string; value: number; hint?: string; href?: string }[];
  empty?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  if (!max) return <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm" title={d.hint}>
          <span className="truncate text-muted-foreground">{d.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="min-w-6 text-right font-medium tabular-nums">{d.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** 客户分布：按维度切换的环形图 */
export function Distribution({ dims }: { dims: { key: string; label: string; data: Slice[] }[] }) {
  const [active, setActive] = useState(dims[0]?.key);
  const cur = dims.find((d) => d.key === active) ?? dims[0];
  if (!cur) return null;
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-muted p-1 ring-1 ring-border/60">
        {dims.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setActive(d.key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              d.key === cur.key ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {d.label}
          </button>
        ))}
      </div>
      <Donut data={cur.data} unit=" 家" empty="还没有客户" />
    </div>
  );
}
