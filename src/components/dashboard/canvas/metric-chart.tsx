"use client";

import { useState } from "react";
import { Donut } from "@/components/dashboard/charts";
import { compact, yuan } from "@/lib/viz";
import type { ChartKey, MetricResult } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export const fmtMetric = (v: number, unit: "cny" | "count") => (unit === "cny" ? yuan(v) : compact(v));

/** 指标图：柱状（时间走势或分类）、排行条、环形；单系列不放图例，标题即名称 */
export function MetricChart({ result, chart, table }: { result: MetricResult; chart: ChartKey; table?: boolean }) {
  const { points, unit } = result;
  if (!points.some((p) => p.value > 0)) return <p className="py-10 text-center text-sm text-muted-foreground">这个范围内还没有数据</p>;
  if (table) return <MetricTable result={result} />;
  if (chart === "donut")
    return <Donut data={points.map((p) => ({ label: p.label, value: Math.round(p.value) }))} unit={unit === "cny" ? " 元" : ""} />;
  if (chart === "hbar") return <RankBars result={result} />;
  return <Columns result={result} />;
}

function Columns({ result }: { result: MetricResult }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = result.by === "time" ? result.points : result.points.slice(0, 12);
  const max = Math.max(...data.map((d) => d.value));
  const peak = data.findIndex((d) => d.value === max);
  // 标签太密时隔几个显示一个
  const step = Math.ceil(data.length / 8);
  const focus = hover ?? peak;
  return (
    <div className="pt-1">
      <p className="h-5 text-xs text-muted-foreground" aria-live="polite">
        <span className="font-medium text-foreground tabular-nums">{fmtMetric(data[focus].value, result.unit)}</span>
        <span className="ml-1.5">{data[focus].label}</span>
        {hover === null && <span className="ml-1.5">· 最高</span>}
      </p>
      <div className="mt-2 flex h-44 items-end gap-[2px]" role="img" aria-label={`${result.title}柱状图`} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <div key={d.label} className="flex h-full min-w-0 flex-1 items-end justify-center" onMouseEnter={() => setHover(i)}>
            <div
              className={cn(
                "w-full max-w-9 rounded-t-[4px] transition-colors",
                i === focus ? "bg-[var(--chart-1)]" : "bg-[color-mix(in_oklch,var(--chart-1)_40%,white)]",
              )}
              style={{ height: `${max ? Math.max((d.value / max) * 100, d.value > 0 ? 1.5 : 0) : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] border-t pt-1.5">
        {data.map((d, i) => (
          <span key={d.label} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground">
            {i % step === 0 || i === data.length - 1 ? d.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function RankBars({ result }: { result: MetricResult }) {
  const top = result.points.slice(0, 10);
  const rest = result.points.slice(10).reduce((n, p) => n + p.value, 0);
  const rows = rest > 0 ? [...top, { label: "其他", value: rest }] : top;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[6rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm"
          title={`${r.label}：${fmtMetric(r.value, result.unit)}`}
        >
          <span className="truncate text-muted-foreground">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted">
            <span
              className={cn("block h-full rounded-full", r.label === "其他" ? "bg-[oklch(0.82_0.015_262)]" : "bg-[var(--chart-1)]")}
              style={{ width: `${max ? (r.value / max) * 100 : 0}%` }}
            />
          </span>
          <span className="text-right font-medium tabular-nums">{fmtMetric(r.value, result.unit)}</span>
        </li>
      ))}
    </ul>
  );
}

function MetricTable({ result }: { result: MetricResult }) {
  return (
    <div className="max-h-72 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
          <tr>
            <th className="py-1.5 text-left font-normal">
              {result.by === "time" ? "时间" : result.by === "member" ? "成员" : result.by === "country" ? "国家" : "来源"}
            </th>
            <th className="py-1.5 text-right font-normal">数值</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {result.points.map((p) => (
            <tr key={p.label}>
              <td className="py-1.5">{p.label}</td>
              <td className="py-1.5 text-right tabular-nums">{result.unit === "cny" ? `¥${Math.round(p.value).toLocaleString()}` : p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
