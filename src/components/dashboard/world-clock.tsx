"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/native-select";
import { COUNTRY_TZ } from "@/lib/dashboard";
import { countryName } from "@/lib/crm";
import { cn } from "@/lib/utils";

const STORE_KEY = "crm.worldClock";
const MAX = 8;

function partsIn(tz: string, now: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const hour = Number(p.hour) % 24;
  return { hour, minute: p.minute, date: `${p.month}-${p.day}`, weekday: p.weekday as string, ymd: `${p.year}${p.month}${p.day}` };
}

const WEEKDAY: Record<string, string> = { Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六", Sun: "周日" };

/** 时差（小时，可带 .5），正数表示比本地快 */
function diffHours(tz: string, localTz: string, now: Date) {
  const off = (z: string) => {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "longOffset" }).formatToParts(now).find((x) => x.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(s);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60) : 0;
  };
  return off(tz) - off(localTz);
}

/**
 * 世界时钟：默认显示「我的客户」最多的几个国家，可以自己增删（存在浏览器里）。
 * 时间只在浏览器里渲染，避免服务端和浏览器时间不一致。
 */
export function WorldClock({ suggested, localTz }: { suggested: string[]; localTz: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const [codes, setCodes] = useState<string[]>(suggested);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    // 挂载后再读浏览器里的设置和当前时间（服务端渲染时显示占位）
    const raf = requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
        if (Array.isArray(saved)) setCodes(saved.filter((c) => typeof c === "string" && COUNTRY_TZ[c]));
      } catch {}
      setNow(new Date());
    });
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);

  const save = (next: string[]) => {
    setCodes(next);
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  };

  const options = Object.keys(COUNTRY_TZ)
    .filter((c) => !codes.includes(c))
    .map((c) => ({ code: c, name: countryName(c) ?? c }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

  return (
    <div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {codes.map((code) => {
          const tz = COUNTRY_TZ[code];
          const p = now ? partsIn(tz, now) : null;
          const working = p && p.hour >= 9 && p.hour < 18 && p.weekday !== "Sat" && p.weekday !== "Sun";
          const d = now ? diffHours(tz, localTz, now) : 0;
          const local = now ? partsIn(localTz, now) : null;
          const dayShift = p && local ? (p.ymd > local.ymd ? "明天" : p.ymd < local.ymd ? "昨天" : "") : "";
          return (
            <li key={code} className="group relative flex items-center gap-3 rounded-lg border px-3 py-2">
              <span
                className={cn("size-2 shrink-0 rounded-full", !p ? "bg-muted" : working ? "bg-emerald-500" : "bg-slate-300")}
                title={working ? "工作时间" : "非工作时间"}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{countryName(code) ?? code}</p>
                <p className="truncate text-xs text-muted-foreground tabular-nums">
                  {p ? `${dayShift || p.date} ${WEEKDAY[p.weekday] ?? ""} · ${d === 0 ? "同本地" : `${d > 0 ? "+" : ""}${d}h`}` : "—"}
                </p>
              </div>
              <span className="text-xl font-semibold tabular-nums">{p ? `${String(p.hour).padStart(2, "0")}:${p.minute}` : "--:--"}</span>
              <button
                type="button"
                onClick={() => save(codes.filter((c) => c !== code))}
                className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border bg-background text-muted-foreground group-hover:flex hover:text-foreground"
                aria-label={`移除 ${countryName(code)}`}
              >
                <X className="size-3" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        {adding ? (
          <NativeSelect
            autoFocus
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) save([...codes, e.target.value]);
              setAdding(false);
            }}
            onBlur={() => setAdding(false)}
            className="h-8 w-48"
            aria-label="添加国家"
          >
            <option value="">选择国家…</option>
            {options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        ) : (
          codes.length < MAX && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setAdding(true)}>
              <Plus /> 添加国家
            </Button>
          )
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          <span className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />
          当地工作时间（周一至周五 9:00–18:00）
        </span>
      </div>
    </div>
  );
}
