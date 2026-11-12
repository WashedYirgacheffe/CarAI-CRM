"use client";

import { NativeSelect } from "@/components/native-select";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, LoaderCircle, MessageCircle, RefreshCw, Settings2, Table2, BarChart3 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { runAction } from "@/hooks/use-action-form";
import { loadWidgetAction, type WidgetData } from "@/app/(app)/dashboard/widget-actions";
import { addFollowUpAction } from "@/app/(app)/customers/actions";
import { FOLLOW_METHODS, formatDate, formatDateTime } from "@/lib/crm";
import { CHARTS, DIMENSIONS, METRICS, METRIC_DIMS, RANGES, isMetric, type ChartKey } from "@/lib/metrics";
import { itemTitle, type CanvasItem, type CanvasSize } from "@/lib/canvas";
import { cn } from "@/lib/utils";
import { MetricChart, fmtMetric } from "./metric-chart";

export type WidgetApi = {
  tz: string;
  /** 修改本组件参数（例如换时间范围），会进撤销历史 */
  setParams: (params: Record<string, string>) => void;
  /** 在画布上再打开一个组件（例如从客户资料打开 WhatsApp） */
  open: (type: string, params: Record<string, string>, size?: CanvasSize) => void;
};

/** 画布上的业务组件：按类型渲染，数据按需拉取 */
export function BusinessWidget({ item, api }: { item: CanvasItem; api: WidgetApi }) {
  if (item.type === "whatsapp") return <WhatsappWidget item={item} />;
  return <DataWidget item={item} api={api} />;
}

function WhatsappWidget({ item }: { item: CanvasItem }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="surface relative h-[640px] overflow-hidden p-0">
      {!loaded && (
        <span className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" /> 正在打开聊天…
        </span>
      )}
      <iframe
        title={itemTitle(item)}
        src={`/embed/whatsapp?chat=${encodeURIComponent(item.params?.chatId ?? "")}`}
        className={cn("size-full border-0 transition-opacity", loaded ? "opacity-100" : "opacity-0")}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

function useWidgetData(item: CanvasItem) {
  const key = JSON.stringify([item.type, item.params ?? {}]);
  const [state, setState] = useState<{ key: string; data: WidgetData | null }>({ key: "", data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const [type, params] = JSON.parse(key) as [string, Record<string, string>];
    loadWidgetAction(type, params)
      .then((data) => live && setState({ key, data }))
      .catch(() => live && setState({ key, data: { ok: false, message: "加载失败，请重试" } }));
    return () => {
      live = false;
    };
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // AI 卡片执行成功（写了跟进、建了提醒等）后刷新画布上的数据
  useEffect(() => {
    window.addEventListener("crm:widgets-refresh", reload);
    return () => window.removeEventListener("crm:widgets-refresh", reload);
  }, [reload]);
  // 参数变了、还没拿到新数据时显示加载中
  return { data: state.key === key ? state.data : null, reload, loading: state.key !== key };
}

function Shell({
  title,
  sub,
  actions,
  children,
  loading,
}: {
  title: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <section className="surface flex h-full min-h-40 flex-col p-4 md:p-5">
      <header className="mb-3 flex items-start gap-2 pr-1">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-medium">{title}</h3>
          {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
        {loading && <LoaderCircle className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" aria-label="加载中" />}
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function DataWidget({ item, api }: { item: CanvasItem; api: WidgetApi }) {
  const { data, reload, loading } = useWidgetData(item);
  const title = itemTitle(item);
  if (!data)
    return (
      <Shell title={title} loading>
        <div className="space-y-2.5">
          {[70, 90, 55].map((w) => (
            <div key={w} className="h-3 animate-pulse rounded-full bg-muted" style={{ width: `${w}%` }} />
          ))}
        </div>
      </Shell>
    );
  if (!data.ok)
    return (
      <Shell title={title}>
        <p className="py-6 text-center text-sm text-muted-foreground">{data.message}</p>
      </Shell>
    );
  switch (data.type) {
    case "customer":
      return <CustomerWidget data={data} api={api} loading={loading} />;
    case "followups":
      return <FollowupsWidget data={data} api={api} reload={reload} loading={loading} />;
    case "team":
      return <TeamWidget data={data} api={api} loading={loading} />;
    case "chart":
      return <ChartWidget item={item} data={data} api={api} loading={loading} />;
  }
}

// ── 客户资料 ──

function CustomerWidget({ data, api, loading }: { data: Extract<WidgetData, { type: "customer" }>; api: WidgetApi; loading: boolean }) {
  const c = data.customer;
  const rows: [string, React.ReactNode][] = [
    ["国家", c.country ?? "—"],
    ["状态", c.status ?? "—"],
    ["负责人", c.inPool ? "公海" : (c.owner ?? "—")],
    ["来源", c.source ?? "—"],
    ["最近联系", c.lastContactAt ? formatDate(c.lastContactAt, api.tz) : "从未联系"],
    ["下次跟进", c.nextFollowAt ? formatDate(c.nextFollowAt, api.tz) : "—"],
  ];
  return (
    <Shell
      title={c.name}
      sub={`商机 ${c.stats.opps} · 报价 ${c.stats.quotes} · 订单 ${c.stats.orders}`}
      loading={loading}
      actions={
        <Button asChild variant="ghost" size="icon-sm" aria-label="打开客户详情">
          <Link href={`/customers/${c.id}`}>
            <ExternalLink />
          </Link>
        </Button>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm @md:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="truncate">{v}</dd>
          </div>
        ))}
      </dl>
      {c.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {c.tags.slice(0, 8).map((t) => (
            <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {t}
            </span>
          ))}
        </div>
      )}
      {c.contacts.length > 0 && (
        <ul className="mt-4 space-y-2 border-t pt-3">
          {c.contacts.map((x, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium">{x.name}</span>
              {x.title && <span className="text-muted-foreground"> · {x.title}</span>}
              <span className="block truncate text-xs text-muted-foreground">
                {[x.email, x.whatsapp].filter(Boolean).join(" · ") || "没有联系方式"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {c.chats.map((ch) => (
          <Button key={ch.id} size="xs" variant="outline" onClick={() => api.open("whatsapp", { chatId: ch.id, title: ch.name })}>
            <MessageCircle /> WhatsApp{c.chats.length > 1 ? `：${ch.name}` : ""}
          </Button>
        ))}
        <Button size="xs" variant="outline" onClick={() => api.open("followups", { customerId: c.id, title: c.name })}>
          跟进记录
        </Button>
      </div>
    </Shell>
  );
}

// ── 跟进记录 ──

function FollowupsWidget({
  data,
  api,
  reload,
  loading,
}: {
  data: Extract<WidgetData, { type: "followups" }>;
  api: WidgetApi;
  reload: () => void;
  loading: boolean;
}) {
  const [text, setText] = useState("");
  const [method, setMethod] = useState("WHATSAPP");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("customerId", data.customer.id);
    fd.set("method", method);
    fd.set("content", text.trim());
    try {
      const r = await runAction(addFollowUpAction({}, fd));
      if (r.ok) {
        setText("");
        reload();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell
      title={`跟进记录 · ${data.customer.name}`}
      sub={`${data.items.filter((i) => i.follow).length} 条跟进`}
      loading={loading}
      actions={
        <Button variant="ghost" size="icon-sm" onClick={reload} aria-label="刷新">
          <RefreshCw />
        </Button>
      }
    >
      {data.customer.canEdit && (
        <div className="mb-4 rounded-xl border p-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="写一条跟进…"
            rows={2}
            className="min-h-0 resize-none border-0 p-1 shadow-none focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
          />
          <div className="mt-1 flex items-center gap-2">
            <NativeSelect
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              aria-label="跟进方式"
              className="h-7 w-auto rounded-md px-2 text-xs text-muted-foreground max-md:h-8"
            >
              {FOLLOW_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
            <Button size="xs" className="ml-auto" disabled={busy || !text.trim()} onClick={submit}>
              保存
            </Button>
          </div>
        </div>
      )}
      {data.items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">还没有跟进记录</p>
      ) : (
        <ol className="max-h-[28rem] space-y-0 overflow-y-auto pr-1">
          {data.items.map((a) => (
            <li key={a.id} className="relative border-l pb-3.5 pl-4 last:pb-0">
              <span
                className={cn("absolute top-1.5 -left-[4.5px] size-2 rounded-full", a.follow ? "bg-primary" : "bg-muted-foreground/40")}
                aria-hidden
              />
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatDateTime(a.at, api.tz)}
                {a.user && ` · ${a.user}`}
                {a.method && ` · ${a.method}`}
              </p>
              <p className={cn("mt-0.5 text-sm whitespace-pre-line", !a.follow && "text-muted-foreground")}>{a.content}</p>
            </li>
          ))}
        </ol>
      )}
    </Shell>
  );
}

// ── 团队业绩 ──

function RangeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <NativeSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="时间范围"
      className="h-7 w-auto rounded-md px-2 text-xs max-md:h-8"
    >
      {RANGES.map((r) => (
        <option key={r.key} value={r.key}>
          {r.label}
        </option>
      ))}
    </NativeSelect>
  );
}

function TeamWidget({ data, api, loading }: { data: Extract<WidgetData, { type: "team" }>; api: WidgetApi; loading: boolean }) {
  const max = Math.max(...data.rows.map((r) => r.deal), 0);
  const total = data.rows.reduce((n, r) => n + r.deal, 0);
  const cols: [keyof (typeof data.rows)[number], string][] = [
    ["orders", "订单"],
    ["quotes", "报价"],
    ["followups", "跟进"],
    ["customers", "新客户"],
    ["leads", "新询盘"],
  ];
  return (
    <Shell
      title="团队业绩"
      sub={`${data.from} 至 ${data.to} · 合计成交 ${fmtMetric(total, "cny")}`}
      loading={loading}
      actions={
        <>
          <RangeSelect value={data.range} onChange={(range) => api.setParams({ range })} />
          <Button asChild variant="ghost" size="icon-sm" aria-label="打开团队数据">
            <Link href="/reports">
              <ExternalLink />
            </Link>
          </Button>
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-normal">成员</th>
              <th className="w-[34%] py-2 text-left font-normal">成交额</th>
              {cols.map(([, l]) => (
                <th key={l} className="py-2 text-right font-normal">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-3 font-medium whitespace-nowrap">{r.name}</td>
                <td className="py-2 pr-4">
                  <span className="flex items-center gap-2">
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${max ? (r.deal / max) * 100 : 0}%` }} />
                    </span>
                    <span className="w-16 text-right tabular-nums">{fmtMetric(r.deal, "cny")}</span>
                  </span>
                </td>
                {cols.map(([k]) => (
                  <td key={k} className="py-2 text-right tabular-nums">
                    {r[k] as number}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">数据范围内没有成员</p>}
    </Shell>
  );
}

// ── 数据图表 ──

function ChartWidget({
  item,
  data,
  api,
  loading,
}: {
  item: CanvasItem;
  data: Extract<WidgetData, { type: "chart" }>;
  api: WidgetApi;
  loading: boolean;
}) {
  const [table, setTable] = useState(false);
  const r = data.result;
  const p = item.params ?? {};
  const set = (k: string, v: string) => {
    const next: Record<string, string> = { ...p, [k]: v };
    // 换了指标或维度，原来的 AI 标题就不准了
    if (k !== "chart") delete next.title;
    if (k === "metric" && isMetric(v) && !METRIC_DIMS[v].includes(next.by as never)) next.by = "time";
    if (k === "by") next.chart = v === "time" ? "bar" : "hbar";
    api.setParams(next);
  };
  return (
    <Shell
      title={p.title || r.title}
      sub={`合计 ${fmtMetric(r.total, r.unit)}`}
      loading={loading}
      actions={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setTable((t) => !t)}
            aria-label={table ? "看图表" : "看表格"}
            title={table ? "看图表" : "看表格"}
          >
            {table ? <BarChart3 /> : <Table2 />}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="图表设置">
                <Settings2 />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-3 text-sm">
              <ChartSelect label="指标" value={r.metric} options={METRICS.map((m) => [m.key, m.label])} onChange={(v) => set("metric", v)} />
              <ChartSelect
                label="维度"
                value={r.by}
                options={DIMENSIONS.filter((d) => METRIC_DIMS[r.metric].includes(d.key)).map((d) => [d.key, d.label])}
                onChange={(v) => set("by", v)}
              />
              <ChartSelect label="时间" value={r.range} options={RANGES.map((x) => [x.key, x.label])} onChange={(v) => set("range", v)} />
              <ChartSelect label="图表" value={data.chart} options={CHARTS.map((c) => [c.key, c.label])} onChange={(v) => set("chart", v)} />
            </PopoverContent>
          </Popover>
        </>
      }
    >
      <MetricChart result={r} chart={data.chart as ChartKey} table={table} />
    </Shell>
  );
}

function ChartSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="grid grid-cols-[3rem_1fr] items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-md px-2">
        {options.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
