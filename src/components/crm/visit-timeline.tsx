"use client";

import { useState } from "react";
import { ChevronDown, Clock, MapPin, Smartphone } from "@/components/icons";
import { formatDateTime } from "@/lib/crm";
import { clickLabel, deviceText, durationText, sectionLabel, type VisitEvent, type VisitView } from "@/lib/share-visit";
import { cn } from "@/lib/utils";

/** 一组访问的汇总：打开几次、累计看了多久 */
export function VisitSummary({ visits }: { visits: VisitView[] }) {
  const total = visits.reduce((n, v) => n + v.activeMs, 0);
  return (
    <p className="text-[12px] text-muted-foreground">
      打开 <span className="font-medium text-foreground tabular-nums">{visits.length}</span> 次
      {total >= 1000 && (
        <>
          {" "}
          · 累计看了 <span className="font-medium text-foreground tabular-nums">{durationText(total)}</span>
        </>
      )}
    </p>
  );
}

/** 访问列表：最新在上，第一条默认展开看时间轴 */
export function VisitList({
  visits,
  tz,
  className,
  labels,
}: {
  visits: VisitView[];
  tz: string;
  className?: string;
  /** 每次访问前面加的说明（如产品页里显示是哪个客户），按 visit id */
  labels?: Record<string, React.ReactNode>;
}) {
  const [open, setOpen] = useState<string | null>(visits[0]?.id ?? null);
  if (!visits.length) return <p className="py-2 text-[13px] text-muted-foreground">还没有人打开过</p>;
  return (
    <ol className={cn("divide-y", className)}>
      {visits.map((v, i) => (
        <li key={v.id} className="py-2 first:pt-0 last:pb-0">
          <button
            type="button"
            className="flex w-full items-start gap-2 text-left"
            aria-expanded={open === v.id}
            onClick={() => setOpen(open === v.id ? null : v.id)}
          >
            <span className="mt-0.5 w-5 shrink-0 text-[11px] text-muted-foreground tabular-nums">#{visits.length - i}</span>
            <span className="min-w-0 flex-1 space-y-0.5 text-[12px]">
              {labels?.[v.id] && <span className="block font-medium text-foreground">{labels[v.id]}</span>}
              <span className="flex items-center gap-1.5">
                <span className="font-medium text-foreground tabular-nums">{formatDateTime(v.startedAt, tz)}</span>
                {v.activeMs >= 1000 && <span className="text-muted-foreground tabular-nums">看了 {durationText(v.activeMs)}</span>}
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{v.place ?? (v.ip ? `${v.ip}（归属地查询中）` : "未知地点")}</span>
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Smartphone className="size-3 shrink-0" />
                <span className="truncate">{deviceText(v) ?? "未知设备"}</span>
              </span>
            </span>
            <ChevronDown className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform", open === v.id && "rotate-180")} />
          </button>
          {open === v.id && <VisitDetail v={v} tz={tz} />}
        </li>
      ))}
    </ol>
  );
}

function VisitDetail({ v, tz }: { v: VisitView; tz: string }) {
  const max = Math.max(...v.sections.map((s) => s.ms), 1);
  const steps = compactEvents(v.events);
  return (
    <div className="mt-2 ml-7 space-y-2.5 text-[12px]">
      {v.sections.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] text-muted-foreground">停留在哪</p>
          <table className="w-full tabular-nums">
            <caption className="sr-only">各部分停留时长</caption>
            <tbody>
              {v.sections.map((s) => (
                <tr key={s.name}>
                  <th scope="row" className="w-20 py-0.5 text-left font-normal">
                    {sectionLabel(s.name)}
                  </th>
                  <td className="py-0.5 pr-2">
                    <span className="block h-1.5 rounded-full bg-chart-1" style={{ width: `${Math.max(4, (s.ms / max) * 100)}%` }} />
                  </td>
                  <td className="w-14 py-0.5 text-right text-muted-foreground">{durationText(s.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {steps.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] text-muted-foreground">经过</p>
          <ol className="space-y-0.5">
            {steps.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-14 shrink-0 text-muted-foreground tabular-nums">{offsetText(e.t)}</span>
                <span className={cn(e.type === "click" && "font-medium")}>{eventText(e)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        {v.maxScroll > 0 && <span>最远看到页面 {v.maxScroll}%</span>}
        <span className="inline-flex items-center gap-0.5">
          <Clock className="size-3" />
          最后活动 {formatDateTime(v.lastSeenAt, tz)}
        </span>
        {v.ip && <span>IP {v.ip}</span>}
        {v.referrer && <span className="truncate">来自 {hostOf(v.referrer)}</span>}
      </p>
    </div>
  );
}

/** 「+1:05」：距打开的时间 */
function offsetText(ms: number) {
  const s = Math.round(ms / 1000);
  if (s >= 3600) return `+${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function eventText(e: VisitEvent) {
  if (e.type === "open") return e.t === 0 ? "打开页面" : "又打开 / 刷新";
  if (e.type === "section") return `看到「${sectionLabel(e.name ?? "")}」`;
  if (e.type === "click") return clickLabel(e.name ?? "");
  if (e.type === "hide") return "切走了";
  return "切回来继续看";
}

/** 连续看同一块只留第一条，切走又马上切回来的去掉，最多 30 条 */
function compactEvents(events: VisitEvent[]) {
  const out: VisitEvent[] = [];
  for (const e of events) {
    const prev = out.at(-1);
    if (prev && e.type === "section" && prev.type === "section" && prev.name === e.name) continue;
    if (prev && e.type === "show" && prev.type === "hide" && e.t - prev.t < 3000) {
      out.pop();
      continue;
    }
    out.push(e);
  }
  return out.slice(0, 30);
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
