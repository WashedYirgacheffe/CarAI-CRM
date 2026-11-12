"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight } from "@/components/icons";
import type { Visual, VisualItem } from "@/lib/ai-visual";
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (v: number, unit?: string) => `${Math.abs(v) >= 100_000 ? compact.format(v) : nf.format(v)}${unit ?? ""}`;

/** 占比图的颜色：沿用站内图表色，超出的并进「其他」 */
const SLICE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function VisualView({ v, onNavigate }: { v: Visual; onNavigate?: () => void }) {
  return (
    <figure className="ai-fade @container/vis overflow-hidden rounded-2xl border bg-card">
      {v.title && <figcaption className="px-3.5 pt-3 text-[0.93em] font-medium">{v.title}</figcaption>}
      <div className="p-3.5 pt-2.5">
        {v.kind === "stats" ? (
          <Stats items={v.items} />
        ) : v.kind === "bars" ? (
          <Bars items={v.items} unit={v.unit} />
        ) : v.kind === "trend" ? (
          <Trend items={v.items} unit={v.unit} />
        ) : v.kind === "donut" ? (
          <Donut items={v.items} unit={v.unit} />
        ) : v.kind === "funnel" ? (
          <Funnel items={v.items} unit={v.unit} />
        ) : v.kind === "progress" ? (
          <Progress items={v.items} unit={v.unit} />
        ) : v.kind === "table" ? (
          <Table columns={v.columns} rows={v.rows} />
        ) : v.kind === "list" ? (
          <List items={v.items} onNavigate={onNavigate} />
        ) : (
          <Timeline items={v.items} />
        )}
      </div>
    </figure>
  );
}

function Stats({ items }: { items: VisualItem[] }) {
  return (
    <div
      className={cn("grid gap-2", items.length === 1 ? "grid-cols-1" : items.length % 3 === 0 ? "grid-cols-2 @md/vis:grid-cols-3" : "grid-cols-2")}
    >
      {items.map((it) => (
        <div key={it.label} className="min-w-0 rounded-xl bg-muted/50 px-3 py-2.5">
          <div className="truncate text-[0.8em] text-muted-foreground">{it.label}</div>
          <div className="mt-0.5 truncate text-[1.3em] leading-tight font-semibold tabular-nums">{it.display ?? fmt(it.value ?? 0)}</div>
          {it.hint && (
            <div
              className={cn(
                "mt-0.5 flex items-center gap-0.5 truncate text-[0.78em]",
                it.tone === "up" ? "text-emerald-700" : it.tone === "down" ? "text-rose-700" : "text-muted-foreground",
              )}
            >
              {it.tone === "up" && <ArrowUpRight className="size-3.5 shrink-0" />}
              {it.tone === "down" && <ArrowDownRight className="size-3.5 shrink-0" />}
              {it.hint}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Bars({ items, unit }: { items: VisualItem[]; unit?: string }) {
  const max = Math.max(...items.map((i) => Math.abs(i.value ?? 0)), 1);
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li
          key={it.label}
          title={`${it.label}：${fmt(it.value ?? 0, unit)}`}
          className="grid grid-cols-[minmax(4rem,7.5rem)_1fr_auto] items-center gap-2.5"
        >
          <span className="truncate text-[0.86em] text-foreground/80">{it.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-muted">
            <span
              className="ai-grow block h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: it.value ? `${Math.max(2, (Math.abs(it.value) / max) * 100)}%` : 0 }}
            />
          </span>
          <span className="text-right text-[0.86em] font-medium tabular-nums">{fmt(it.value ?? 0, unit)}</span>
        </li>
      ))}
    </ul>
  );
}

function Trend({ items, unit }: { items: VisualItem[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId();
  const W = 560;
  const H = 150;
  const pad = { l: 4, r: 4, t: 10, b: 4 };
  const vals = items.map((i) => i.value ?? 0);
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (items.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (items.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(vals.length - 1).toFixed(1)},${y(min)}L${x(0).toFixed(1)},${y(min)}Z`;
  const h = hover ?? vals.length - 1;
  const total = vals.reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[1.25em] font-semibold tabular-nums">{fmt(vals[h], unit)}</span>
        <span className="text-[0.8em] text-muted-foreground">{items[h].label}</span>
        <span className="ml-auto text-[0.78em] text-muted-foreground tabular-nums">合计 {fmt(total, unit)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="ai-reveal h-32 w-full touch-none overflow-visible"
        preserveAspectRatio="none"
        role="img"
        aria-label={`趋势：${items.map((i) => `${i.label} ${fmt(i.value ?? 0, unit)}`).join("，")}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (items.length - 1));
          setHover(Math.max(0, Math.min(items.length - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={pad.t + f * (H - pad.t - pad.b)}
            y2={pad.t + f * (H - pad.t - pad.b)}
            stroke="var(--border)"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <line
          x1={x(h)}
          x2={x(h)}
          y1={pad.t}
          y2={H}
          stroke="var(--foreground)"
          strokeOpacity={hover === null ? 0 : 0.25}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* 圆点单独画在 SVG 外，避免被 preserveAspectRatio 拉成椭圆 */}
      <div className="relative -mt-32 h-32 pointer-events-none">
        <span
          className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-card"
          style={{ left: `${(x(h) / W) * 100}%`, top: `${(y(vals[h]) / H) * 100}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[0.72em] text-muted-foreground tabular-nums">
        <span>{items[0].label}</span>
        {items.length > 2 && <span>{items[Math.floor((items.length - 1) / 2)].label}</span>}
        {items.length > 1 && <span>{items[items.length - 1].label}</span>}
      </div>
    </div>
  );
}

function Donut({ items, unit }: { items: VisualItem[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const sorted = [...items].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const head = sorted.slice(0, SLICE.length - (sorted.length > SLICE.length ? 1 : 0));
  const rest = sorted.slice(head.length);
  const slices = rest.length ? [...head, { label: "其他", value: rest.reduce((a, b) => a + (b.value ?? 0), 0) }] : head;
  const total = slices.reduce((a, b) => a + Math.max(0, b.value ?? 0), 0) || 1;
  const R = 15.9155; // 周长 100
  const pcts = slices.map((s) => (Math.max(0, s.value ?? 0) / total) * 100);
  const offs = pcts.map((_, i) => pcts.slice(0, i).reduce((a, b) => a + b, 0));
  const focus = hover !== null ? slices[hover] : null;
  return (
    <div className="flex flex-col items-center gap-3 @xs/vis:flex-row @xs/vis:gap-4">
      <div className="ai-pop relative size-28 shrink-0">
        <svg viewBox="0 0 42 42" className="size-full -rotate-90" role="img" aria-label="占比">
          <circle cx="21" cy="21" r={R} fill="none" stroke="var(--muted)" strokeWidth="5" />
          {slices.map((s, i) => {
            const pct = pcts[i];
            const off = offs[i];
            return (
              <circle
                key={s.label}
                cx="21"
                cy="21"
                r={R}
                fill="none"
                stroke={SLICE[i]}
                strokeWidth={hover === i ? 6.5 : 5}
                // 每段之间留一点缝
                strokeDasharray={`${Math.max(0, pct - (slices.length > 1 ? 0.8 : 0))} ${100 - pct + (slices.length > 1 ? 0.8 : 0)}`}
                strokeDashoffset={-off}
                className="transition-[stroke-width]"
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[0.95em] font-semibold tabular-nums">{fmt(focus ? (focus.value ?? 0) : total, unit)}</span>
          <span className="max-w-[5rem] truncate text-[0.7em] text-muted-foreground">{focus ? focus.label : "合计"}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5">
        {slices.map((s, i) => (
          <li
            key={s.label}
            className={cn("flex items-center gap-2 rounded-md px-1 text-[0.86em]", hover === i && "bg-muted/60")}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: SLICE[i] }} />
            <span className="min-w-0 flex-1 truncate text-foreground/80">{s.label}</span>
            <span className="tabular-nums">{fmt(s.value ?? 0, unit)}</span>
            <span className="w-10 text-right text-muted-foreground tabular-nums">{Math.round((Math.max(0, s.value ?? 0) / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const numeric = columns.map((_, c) => rows.every((r) => !r[c] || /^[-+¥$€£]?[\d,.\s]+%?[万千亿KMk]?$/.test(r[c].trim())));
  return (
    <div className="-mx-3.5 -mb-3.5 overflow-x-auto">
      <table className="w-full text-[0.86em]">
        <thead>
          <tr className="border-b text-muted-foreground">
            {columns.map((c, i) => (
              <th key={i} className={cn("px-3.5 py-1.5 font-normal whitespace-nowrap", numeric[i] ? "text-right" : "text-left")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b last:border-0 hover:bg-muted/40">
              {r.map((cell, ci) => (
                <td key={ci} className={cn("px-3.5 py-2", numeric[ci] ? "text-right tabular-nums" : "text-left", ci === 0 && "font-medium")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function List({ items, onNavigate }: { items: VisualItem[]; onNavigate?: () => void }) {
  return (
    <ul className="-mx-1.5 -my-1">
      {items.map((it, i) => {
        const body = (
          <>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[0.78em] font-semibold text-brand-ink">
              {it.label.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{it.label}</span>
              {it.subtitle && <span className="block truncate text-[0.82em] text-muted-foreground">{it.subtitle}</span>}
            </span>
            {it.meta && <span className="shrink-0 text-[0.82em] text-foreground/70 tabular-nums">{it.meta}</span>}
            {it.href && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
          </>
        );
        const cls = "flex items-center gap-2.5 rounded-xl px-1.5 py-1.5";
        return (
          <li key={i}>
            {it.href ? (
              <Link href={it.href} onClick={onNavigate} className={cn(cls, "transition-colors hover:bg-muted/60")}>
                {body}
              </Link>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Timeline({ items }: { items: VisualItem[] }) {
  return (
    <ol className="relative ml-1.5 space-y-3 border-l border-border pl-4">
      {items.map((it, i) => (
        <li key={i} className="relative">
          <span
            className={cn("absolute top-1.5 -left-[1.36rem] size-2.5 rounded-full ring-2 ring-card", i === 0 ? "bg-brand" : "bg-muted-foreground/40")}
          />
          {it.time && <div className="text-[0.78em] text-muted-foreground tabular-nums">{it.time}</div>}
          <div className="font-medium">{it.label}</div>
          {it.subtitle && <div className="text-[0.86em] text-foreground/75">{it.subtitle}</div>}
        </li>
      ))}
    </ol>
  );
}

/* ---------------- 轻量 Markdown：加粗、行内代码、小标题、列表、引用 ---------------- */

function inline(s: string, key: string) {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(
      m[1] !== undefined ? (
        <strong key={`${key}-${i++}`} className="font-semibold text-foreground">
          {m[1]}
        </strong>
      ) : (
        <code key={`${key}-${i++}`} className="rounded bg-muted px-1 py-px text-[0.92em]">
          {m[2]}
        </code>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const lines = text
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split("\n")
    .filter((l) => !/^\s*\|?\s*:?-{3,}/.test(l));
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list;
    const Tag = L.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={cn("space-y-1 pl-5", L.ordered ? "list-decimal" : "list-disc marker:text-brand")}>
        {L.items.map((t, i) => (
          <li key={i} className="pl-0.5">
            {inline(t, `${blocks.length}-${i}`)}
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    const ul = /^\s*[-*•]\s+(.*)$/.exec(l);
    const ol = /^\s*\d+[.、)]\s+(.*)$/.exec(l);
    if (ul || ol) {
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    flush();
    if (!l.trim()) continue;
    const h = /^#{1,4}\s+(.*)$/.exec(l);
    if (h) {
      blocks.push(
        <p key={blocks.length} className="pt-1 font-semibold text-foreground">
          {inline(h[1], String(blocks.length))}
        </p>,
      );
    } else if (/^>\s?/.test(l)) {
      blocks.push(
        <blockquote key={blocks.length} className="border-l-2 border-brand/60 pl-2.5 text-foreground/75">
          {inline(l.replace(/^>\s?/, ""), String(blocks.length))}
        </blockquote>,
      );
    } else if (/^\s*\|/.test(l)) {
      // 模型偶尔还是写表格：按竖线拆成一行文字
      blocks.push(
        <p key={blocks.length} className="text-foreground/90">
          {l
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean)
            .join(" · ")}
        </p>,
      );
    } else {
      blocks.push(
        <p key={blocks.length} className="whitespace-pre-line">
          {inline(l, String(blocks.length))}
        </p>,
      );
    }
  }
  flush();
  return <div className="space-y-2 leading-relaxed text-foreground/90">{blocks}</div>;
}

/** 漏斗：每一层宽度按第一层的比例，层与层之间标出转化率 */
function Funnel({ items, unit }: { items: VisualItem[]; unit?: string }) {
  // 按最大的一层算宽度（偶尔后一层比前一层多，比如一条询盘报了多次价）
  const top = Math.max(...items.map((i) => i.value ?? 0), 1);
  return (
    <ol className="space-y-0.5">
      {items.map((it, i) => {
        const v = it.value ?? 0;
        const prev = i ? (items[i - 1].value ?? 0) : 0;
        const w = Math.max(18, (Math.max(0, v) / top) * 100);
        return (
          <li key={it.label}>
            {i > 0 && (
              <div className="flex items-center justify-center gap-1 py-0.5 text-[0.72em] text-muted-foreground tabular-nums">
                <ArrowDownRight className="size-3 rotate-45" />
                {prev > 0 ? `${Math.round((v / prev) * 100)}%` : "—"}
              </div>
            )}
            <div
              title={`${it.label}：${fmt(v, unit)}`}
              className="ai-grow-c mx-auto flex h-9 items-center justify-between gap-2 rounded-lg px-3 text-[0.86em]"
              style={{
                width: `${w}%`,
                minWidth: "min(9.5rem, 100%)",
                background: `color-mix(in oklab, var(--brand) ${Math.round(88 - (i / Math.max(1, items.length - 1)) * 58)}%, var(--card))`,
                color: i / Math.max(1, items.length - 1) < 0.5 ? "var(--brand-foreground)" : "var(--foreground)",
                animationDelay: `${i * 70}ms`,
              }}
            >
              <span className="min-w-0 truncate font-medium">{it.label}</span>
              <span className="shrink-0 font-semibold tabular-nums">{it.display ?? fmt(v, unit)}</span>
            </div>
          </li>
        );
      })}
      {items.length > 1 && (items[0].value ?? 0) > 0 && (
        <li className="pt-2 text-center text-[0.78em] text-muted-foreground tabular-nums">
          整体转化 {nf.format(((items[items.length - 1].value ?? 0) / (items[0].value ?? 1)) * 100)}%
        </li>
      )}
    </ol>
  );
}

/** 完成度：数值 / 目标，超额用实心标出 */
function Progress({ items, unit }: { items: VisualItem[]; unit?: string }) {
  return (
    <ul className="space-y-3">
      {items.map((it, i) => {
        const v = it.value ?? 0;
        const t = it.target || 1;
        const pct = (v / t) * 100;
        const done = pct >= 100;
        return (
          <li key={it.label}>
            <div className="mb-1 flex items-baseline gap-2 text-[0.86em]">
              <span className="min-w-0 flex-1 truncate text-foreground/80">{it.label}</span>
              <span className="tabular-nums">
                <span className="font-semibold">{it.display ?? fmt(v, unit)}</span>
                <span className="text-muted-foreground"> / {fmt(t, unit)}</span>
              </span>
              <span className={cn("w-11 text-right font-semibold tabular-nums", done ? "text-emerald-700" : "text-foreground")}>
                {Math.round(pct)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("ai-grow h-full rounded-full", done ? "bg-emerald-600" : "bg-brand")}
                style={{ width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%`, animationDelay: `${i * 70}ms` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
