"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid, LoaderCircle, Plus, Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchTargetsAction, type TargetHit } from "@/app/(app)/dashboard/widget-actions";
import { MAX_ITEMS, WIDGETS, type WidgetDef } from "@/lib/canvas";
import { METRICS } from "@/lib/metrics";
import { noAutofill } from "@/lib/no-autofill";

type Props = {
  available: Set<string>;
  onCanvas: Set<string>;
  full: boolean;
  metrics: string[];
  onAdd: (type: string, params?: Record<string, string>) => void;
};

/** 「添加组件」：概览卡片直接加；业务组件先挑对象（客户、会话、指标） */
export function AddMenu({ available, onCanvas, full, metrics, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<WidgetDef | null>(null);
  const cards = WIDGETS.filter((w) => available.has(w.type) && !w.multi);
  const business = WIDGETS.filter((w) => available.has(w.type) && w.multi);
  const done = (type: string, params?: Record<string, string>) => {
    onAdd(type, params);
    setOpen(false);
    setPick(null);
  };
  const choose = (w: WidgetDef) => {
    if (w.type === "team") return done("team", { range: "month" });
    setPick(w);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setPick(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="ml-1">
          <Plus /> 添加组件
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1.5">
        {pick ? (
          <div>
            <button
              type="button"
              onClick={() => setPick(null)}
              className="mb-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              <ChevronLeft className="size-3.5" /> {pick.label}
            </button>
            {pick.type === "chart" ? (
              <ul>
                {METRICS.filter((m) => metrics.includes(m.key)).map((m) => (
                  <li key={m.key}>
                    <Row title={m.label} sub={m.desc} onClick={() => done("chart", { metric: m.key, by: "time", range: "30d", chart: "bar" })} />
                  </li>
                ))}
              </ul>
            ) : (
              <TargetSearch
                kind={pick.type === "whatsapp" ? "chat" : "customer"}
                onPick={(hit) =>
                  done(pick.type, pick.type === "whatsapp" ? { chatId: hit.id, title: hit.title } : { customerId: hit.id, title: hit.title })
                }
              />
            )}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            {business.length > 0 && (
              <>
                <p className="px-2.5 pt-1.5 pb-1 text-xs text-muted-foreground">业务组件</p>
                <ul>
                  {business.map((w) => (
                    <li key={w.type}>
                      <Row title={w.label} sub={w.desc} disabled={full} onClick={() => choose(w)} chevron={w.type !== "team"} />
                    </li>
                  ))}
                </ul>
                <p className="mt-1 border-t px-2.5 pt-2.5 pb-1 text-xs text-muted-foreground">概览卡片</p>
              </>
            )}
            <ul>
              {cards.map((w) => {
                const placed = onCanvas.has(w.type);
                return (
                  <li key={w.type}>
                    <Row
                      title={w.label}
                      sub={w.desc}
                      disabled={placed || full}
                      note={placed ? "已在画布上" : undefined}
                      onClick={() => done(w.type)}
                    />
                  </li>
                );
              })}
            </ul>
            {full && <p className="px-2.5 py-2 text-xs text-muted-foreground">画布最多放 {MAX_ITEMS} 个组件</p>}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Row({
  title,
  sub,
  note,
  disabled,
  chevron,
  onClick,
}: {
  title: string;
  sub?: string;
  note?: string;
  disabled?: boolean;
  chevron?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
    >
      <LayoutGrid className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
          {title}
          {note && <span className="text-xs font-normal text-muted-foreground">{note}</span>}
        </span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
      {chevron && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}

function TargetSearch({ kind, onPick }: { kind: "customer" | "chat"; onPick: (h: TargetHit) => void }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ q: string; hits: TargetHit[] } | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      searchTargetsAction(kind, q)
        .then((hits) => live && setState({ q, hits }))
        .catch(() => live && setState({ q, hits: [] }));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [kind, q]);
  const loading = state?.q !== q;
  return (
    <div>
      <label className="mx-1 mb-1 flex items-center gap-2 rounded-lg border px-2.5">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          {...noAutofill}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={kind === "chat" ? "搜索会话名称、号码、客户" : "搜索客户或联系人"}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {loading && <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />}
      </label>
      <ul className="max-h-72 overflow-y-auto">
        {state?.hits.map((h) => (
          <li key={h.id}>
            <button type="button" onClick={() => onPick(h)} className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-muted">
              <span className="block truncate text-sm font-medium">{h.title}</span>
              {h.sub && <span className="block truncate text-xs text-muted-foreground">{h.sub}</span>}
            </button>
          </li>
        ))}
      </ul>
      {state && !loading && state.hits.length === 0 && (
        <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">{kind === "chat" ? "没有找到会话" : "没有找到客户"}</p>
      )}
    </div>
  );
}
