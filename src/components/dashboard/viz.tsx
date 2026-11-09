"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { RAMP, compact, yuan } from "@/lib/viz";

/**
 * 工作台可视化组件。
 * 颜色：分类色 --chart-1..5（固定顺序）；数量用单色顺序色 RAMP（已校验：单色相、亮度单调、浅端对白底 ≥ 2:1）。
 * 文字一律用正文色，颜色只给图形。
 */
const NONE = "oklch(0.94 0.008 262)";

/** 0..max 的整齐刻度（3 档） */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

/* ───────────── 迷你趋势线 ───────────── */

export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  const id = useId();
  const max = Math.max(...values, 0);
  const n = values.length;
  if (n < 2) return null;
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => 30 - (max ? (v / max) * 26 : 0);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const last = values[n - 1];
  return (
    <div className={cn("relative h-8", className)} role="img" aria-label={label}>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.18" />
            <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L100,32 L0,32 Z`} fill={`url(#${id})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span
        className="absolute size-2 -translate-1/2 rounded-full bg-[var(--chart-1)] ring-2 ring-card"
        style={{ left: "100%", top: `${(y(last) / 32) * 100}%` }}
      />
    </div>
  );
}

/* ───────────── 本月累计 vs 上月累计 ───────────── */

export function PaceChart({ cur, prev, today }: { cur: number[]; prev: number[]; today: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = Math.max(cur.length, prev.length);
  const top = niceMax(Math.max(...cur, ...prev, 0));
  const W = 600;
  const H = 160;
  const x = (i: number) => (days > 1 ? (i / (days - 1)) * W : 0);
  const y = (v: number) => H - (v / top) * H;
  const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const curShown = cur.slice(0, today);
  const ticks = [0, top / 2, top];
  const xTicks = [1, 10, 20, days].filter((d, i, a) => d <= days && a.indexOf(d) === i);
  const h = hover ?? today - 1;
  const pct = (i: number) => `${(x(i) / W) * 100}%`;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-[var(--chart-1)]" />
          本月累计
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-muted-foreground/40" />
          上月累计
        </span>
      </div>
      <div className="relative ml-10 h-40">
        {ticks.map((t) => (
          <div key={t} className="absolute inset-x-0 border-t border-border/70" style={{ top: `${(1 - t / top) * 100}%` }}>
            <span className="absolute -left-10 w-8 -translate-y-1/2 text-right text-[11px] text-muted-foreground tabular-nums">{yuan(t)}</span>
          </div>
        ))}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <path d={`${path(curShown)} L${x(curShown.length - 1)},${H} L0,${H} Z`} fill="var(--chart-1)" fillOpacity="0.1" />
          <path
            d={path(prev)}
            fill="none"
            stroke="var(--color-muted-foreground)"
            strokeOpacity="0.4"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
          <path
            d={path(curShown)}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        {/* 十字线 + 读数 */}
        <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground/20" style={{ left: pct(h) }} />
        {h < curShown.length && (
          <span
            className="pointer-events-none absolute size-2.5 -translate-1/2 rounded-full bg-[var(--chart-1)] ring-2 ring-card"
            style={{ left: pct(h), top: `${(y(cur[h]) / H) * 100}%` }}
          />
        )}
        {h < prev.length && (
          <span
            className="pointer-events-none absolute size-2 -translate-1/2 rounded-full bg-muted-foreground/50 ring-2 ring-card"
            style={{ left: pct(h), top: `${(y(prev[h]) / H) * 100}%` }}
          />
        )}
        <div
          className={cn(
            "pointer-events-none absolute top-0 z-10 min-w-32 rounded-lg bg-popover px-2.5 py-2 text-xs shadow-lg ring-1 ring-border",
            x(h) / W > 0.55 ? "-translate-x-[calc(100%+10px)]" : "translate-x-2.5",
          )}
          style={{ left: pct(h) }}
        >
          <p className="mb-1 text-muted-foreground">第 {h + 1} 天</p>
          {h < curShown.length && (
            <p className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-[var(--chart-1)]" />
              <span className="font-semibold tabular-nums">{yuan(cur[h])}</span>
              <span className="text-muted-foreground">本月</span>
            </p>
          )}
          {h < prev.length && (
            <p className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-muted-foreground/40" />
              <span className="font-semibold tabular-nums">{yuan(prev[h])}</span>
              <span className="text-muted-foreground">上月</span>
            </p>
          )}
        </div>
        <div
          className="absolute inset-0 cursor-crosshair"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(days - 1, Math.round(((e.clientX - r.left) / r.width) * (days - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
        />
      </div>
      <div className="relative mt-1.5 ml-10 h-4 text-[11px] text-muted-foreground tabular-nums">
        {xTicks.map((d) => (
          <span
            key={d}
            className={cn("absolute whitespace-nowrap", d === days ? "-translate-x-full" : "-translate-x-1/2")}
            style={{ left: pct(d - 1) }}
          >
            {d}日
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────────── 漏斗 ───────────── */

export function Funnel({ steps }: { steps: { label: string; value: number; href?: string }[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => {
        const prev = steps[i - 1]?.value;
        const rate = i > 0 && prev ? Math.round((s.value / prev) * 100) : null;
        const body = (
          <>
            <span className="w-12 shrink-0 text-sm text-muted-foreground">{s.label}</span>
            <span className="relative h-5 flex-1">
              <span
                className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-500"
                style={{
                  width: `${Math.max((s.value / max) * 100, s.value ? 2 : 0)}%`,
                  background: RAMP[Math.min(3, 3 - Math.floor((i * 4) / steps.length))],
                }}
              />
            </span>
            <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">{s.value}</span>
          </>
        );
        return (
          <li key={s.label}>
            {i > 0 && <p className="ml-12 py-0.5 pl-2 text-[11px] text-muted-foreground tabular-nums">↓ {rate === null ? "—" : `${rate}%`}</p>}
            {s.href ? (
              <Link href={s.href} className="-mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-0.5 hover:bg-muted/60">
                {body}
              </Link>
            ) : (
              <div className="flex items-center gap-2.5 py-0.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ───────────── 整体拆分：高分段条 ───────────── */

export function SegmentBar({
  parts,
  unit = "",
}: {
  parts: {
    label: string;
    value: number;
    color: string;
    dark?: boolean;
  }[];
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return <p className="py-6 text-center text-sm text-muted-foreground">暂无数据</p>;
  const cur = hover !== null ? parts[hover] : null;
  return (
    <div>
      <div className="flex h-7 gap-0.5" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}${unit}`).join("，")}>
        {parts.map((p, i) => {
          if (!p.value) return null;
          const share = p.value / total;
          return (
            <div
              key={p.label}
              tabIndex={0}
              aria-label={`${p.label} ${p.value}${unit}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className={cn(
                "flex min-w-1 items-center rounded-[4px] px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring text-[11px] font-semibold tabular-nums transition-opacity",
                p.dark ? "text-white" : "text-foreground",
                hover !== null && hover !== i && "opacity-45",
              )}
              style={{ flexGrow: p.value, flexBasis: 0, background: p.color }}
            >
              {share >= 0.14 && `${Math.round(share * 100)}%`}
            </div>
          );
        })}
      </div>
      <p className="mt-2 h-4 text-xs text-muted-foreground tabular-nums">
        {cur ? (
          <>
            <span className="text-foreground">{cur.label}</span> · {cur.value}
            {unit} · {Math.round((cur.value / total) * 100)}%
          </>
        ) : (
          <>
            合计 {total}
            {unit}
          </>
        )}
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
        {parts.map((p, i) => (
          <li
            key={p.label}
            className={cn("flex items-center gap-2 rounded-md", hover === i && "bg-muted")}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.label}</span>
            <span className="font-medium tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────── 活跃热力图（周一开头，按列为周） ───────────── */

export type HeatDay = { key: string; total: number; parts: [string, number][] };

export function Heatmap({ days, today }: { days: HeatDay[]; today: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // 窄屏时默认滚到最近一周
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const max = Math.max(...days.map((d) => d.total), 0);
  // 四档分位：按最大值等分
  const level = (v: number) => (v <= 0 || !max ? -1 : Math.min(3, Math.floor((v / max) * 4 - 1e-9)));
  const weeks = Math.ceil(days.length / 7);
  const active = days.filter((d) => d.total > 0).length;
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].total > 0) streak++;
    else if (days[i].key !== today) break;
  }
  const sum = days.reduce((n, d) => n + d.total, 0);
  const fmtDay = (k: string) => {
    const d = new Date(`${k}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 周${"日一二三四五六"[d.getUTCDay()]}`;
  };
  const months = Array.from({ length: weeks }, (_, w) => {
    const k = days[w * 7]?.key;
    const prev = days[(w - 1) * 7]?.key;
    return k && w < weeks - 1 && (!prev || k.slice(5, 7) !== prev.slice(5, 7)) ? `${Number(k.slice(5, 7))}月` : "";
  });
  const cur = hover !== null ? days[hover] : null;

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row-reverse lg:items-start lg:justify-end">
        <dl className="grid grid-cols-3 gap-3 lg:w-36 lg:shrink-0 lg:grid-cols-1">
          {(
            [
              ["活跃天数", `${active}`, `/ ${days.length} 天`],
              ["连续活跃", `${streak}`, "天"],
              ["日均动作", (sum / Math.max(days.length, 1)).toFixed(1), "次"],
            ] as const
          ).map(([k, v, u]) => (
            <div key={k} className="rounded-xl bg-muted/50 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 text-lg leading-tight font-semibold">
                {v} <span className="text-xs font-normal text-muted-foreground">{u}</span>
              </dd>
            </div>
          ))}
        </dl>
        <div ref={scroller} className="min-w-0 overflow-x-auto pb-1 [scrollbar-width:thin] lg:shrink-0">
          <div className="grid w-max gap-x-[3px] overflow-hidden" style={{ gridTemplateColumns: `1.25rem repeat(${weeks}, 13px)` }}>
            <span className="sticky left-0 z-[1] bg-card" />
            {months.map((m, w) => (
              <span key={w} className="h-4 w-0 overflow-visible text-[10px] whitespace-nowrap text-muted-foreground">
                {m}
              </span>
            ))}
          </div>
          <div
            className="grid w-max grid-flow-col gap-[3px]"
            style={{
              gridTemplateRows: "repeat(7, 13px)",
              gridTemplateColumns: `1.25rem repeat(${weeks}, 13px)`,
            }}
          >
            {["一", "", "三", "", "五", "", "日"].map((d, i) => (
              <span key={i} className="sticky left-0 z-[1] flex items-center bg-card text-[10px] leading-none text-muted-foreground">
                {d}
              </span>
            ))}
            {days.map((d, i) => {
              const lv = level(d.total);
              return (
                <button
                  key={d.key}
                  type="button"
                  aria-label={`${fmtDay(d.key)}：${d.total} 次`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className={cn(
                    "size-[13px] rounded-[3px] outline-none transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-ring",
                    d.key === today && "ring-2 ring-primary/50",
                  )}
                  style={{ background: lv < 0 ? NONE : RAMP[lv] }}
                />
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p className="min-h-4 tabular-nums">
          {cur ? (
            <>
              <span className="text-foreground">{fmtDay(cur.key)}</span> · 共 {cur.total} 次
              {cur.parts.filter(([, v]) => v).map(([k, v]) => ` · ${k} ${v}`)}
            </>
          ) : (
            `近 ${weeks} 周共 ${sum} 次跟进与发出`
          )}
        </p>
        <span className="flex items-center gap-1">
          少
          {[NONE, ...RAMP].map((c) => (
            <span key={c} className="size-2.5 rounded-[2px]" style={{ background: c }} />
          ))}
          多
        </span>
      </div>
    </div>
  );
}

/* ───────────── 按天堆叠柱 ───────────── */

export function StackedDaily({ labels, series }: { labels: string[]; series: { label: string; color: string; values: number[] }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = labels.map((_, i) => series.reduce((n, s) => n + s.values[i], 0));
  const top = niceMax(Math.max(...totals, 0));
  const peak = totals.indexOf(Math.max(...totals));
  if (!totals.some(Boolean)) return <p className="py-10 text-center text-sm text-muted-foreground">这段时间没有往来消息</p>;
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.label}
            <span className="font-medium text-foreground tabular-nums">{s.values.reduce((a, b) => a + b, 0)}</span>
          </li>
        ))}
      </ul>
      <div className="relative ml-7 h-36">
        {[0, top / 2, top].map((t) => (
          <div key={t} className="absolute inset-x-0 border-t border-border/70" style={{ top: `${(1 - t / top) * 100}%` }}>
            <span className="absolute -left-7 w-5 -translate-y-1/2 text-right text-[11px] text-muted-foreground tabular-nums">{compact(t)}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-0.5">
          {labels.map((l, i) => (
            <div
              key={l}
              className="relative flex h-full flex-1 flex-col-reverse items-center"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            >
              <div
                className={cn("flex w-full max-w-6 flex-col-reverse gap-0.5", hover === i && "brightness-110")}
                style={{ height: `${(totals[i] / top) * 100}%` }}
              >
                {series.map(
                  (s, k) =>
                    s.values[i] > 0 && (
                      <span
                        key={s.label}
                        className={cn("w-full", k === series.findLastIndex((x) => x.values[i] > 0) && "rounded-t-[4px]")}
                        style={{
                          flexGrow: s.values[i],
                          flexBasis: 0,
                          background: s.color,
                        }}
                      />
                    ),
                )}
              </div>
              {i === peak && hover === null && totals[i] > 0 && (
                <span className="absolute text-[11px] font-medium tabular-nums" style={{ bottom: `calc(${(totals[i] / top) * 100}% + 2px)` }}>
                  {totals[i]}
                </span>
              )}
              {hover === i && (
                <div
                  className={cn(
                    "pointer-events-none absolute bottom-full z-10 mb-1 min-w-28 rounded-lg bg-popover px-2.5 py-2 text-xs shadow-lg ring-1 ring-border",
                    i > labels.length / 2 ? "right-0" : "left-0",
                  )}
                >
                  <p className="mb-1 text-muted-foreground">
                    {l} · 共 {totals[i]}
                  </p>
                  {series.map((s) => (
                    <p key={s.label} className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                      <span className="font-semibold tabular-nums">{s.values[i]}</span>
                      <span className="text-muted-foreground">{s.label}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 ml-7 flex gap-0.5 text-[10px] text-muted-foreground tabular-nums">
        {labels.map((l, i) => (
          <span key={l} className="flex-1 text-center">
            {i % 2 === (labels.length - 1) % 2 ? l : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
