"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Building2, ChevronDown, Copy, LoaderCircle, Plus, Search, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatAmount } from "@/lib/docs";
import {
  FIELDS,
  ITEM_COLS,
  TEMPLATES,
  UNITS,
  lineAmount,
  missingFields,
  totals,
  type DocCharge,
  type DocData,
  type DocItem,
  type DocType,
  type FieldKey,
  type ItemCol,
} from "@/lib/trade-docs/schema";
import { cn } from "@/lib/utils";
import { customerPrefillAction, orderPrefillAction, searchProductsAction, searchSourcesAction } from "./actions";

type FieldMeta = { label: string; kind: string; options?: readonly string[]; placeholder?: string; hint?: string };

/** 快速选择的小标签 */
export function Chip({ on, onClick, children, title }: { on?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "max-w-full truncate rounded-full border px-2.5 py-[3px] text-[12px] leading-5 transition-colors",
        on ? "border-brand bg-brand-soft font-medium text-brand" : "border-line2 bg-card text-muted-foreground hover:border-foreground/25 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 这些字段保留原样大小写（邮箱、网址、中文名） */
export const KEEP_CASE = new Set<string>(["sellerNameCn", "sellerEmail", "sellerWebsite", "buyerEmail"]);

/** 一个字段的输入：文本 / 多行 / 日期 / 数字 / 点选，下面是快速选项 */
export function FieldInput({
  id,
  meta,
  value,
  onChange,
  placeholder,
  upper = true,
}: {
  id?: string;
  meta: FieldMeta;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  upper?: boolean;
}) {
  const opts = meta.options ?? [];
  const long = opts.some((o) => o.length > 40);
  if (meta.kind === "select") {
    return (
      <div id={id} className="flex flex-wrap gap-1.5">
        {opts.map((o) => (
          <Chip key={o} on={value === o} onClick={() => onChange(value === o ? "" : o)}>
            {o}
          </Chip>
        ))}
        {value && !opts.includes(value) && <Chip on onClick={() => onChange("")}>{value}</Chip>}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {meta.kind === "textarea" ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? meta.placeholder}
          className={cn("min-h-[60px] rounded-lg px-3 py-2 text-[13px]", upper && "uppercase placeholder:normal-case")}
        />
      ) : (
        <div className="flex gap-1.5">
          <Input
            id={id}
            type={meta.kind === "date" ? "date" : "text"}
            inputMode={meta.kind === "number" ? "decimal" : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder ?? meta.placeholder}
            className={cn("h-9 px-3 text-[13px]", meta.kind === "text" && upper && "uppercase placeholder:normal-case")}
          />
          {meta.kind === "date" && (
            <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => onChange(today())}>
              今天
            </Button>
          )}
        </div>
      )}
      {opts.length > 0 && (
        <div className={cn("flex gap-1.5", long ? "flex-col items-start" : "flex-wrap")}>
          {opts.map((o) => (
            <Chip key={o} title={o} on={value === o} onClick={() => onChange(meta.kind === "textarea" && long && value && value !== o ? `${value}\n${o}` : o)}>
              {o}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 从 CRM 带入 ──

function SourcePicker({ onApply }: { onApply: (p: Partial<DocData>, label: string) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Awaited<ReturnType<typeof searchSourcesAction>> | null>(null);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => start(async () => setRes(await searchSourcesAction(q))), 220);
    return () => clearTimeout(t);
  }, [q, open]);
  const pick = (kind: "order" | "customer", id: string, label: string) =>
    start(async () => {
      const p = kind === "order" ? await orderPrefillAction(id) : await customerPrefillAction(id);
      if (p) onApply(p, label);
      setOpen(false);
      setQ("");
    });
  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          onChange={(e) => setQ(e.target.value)}
          placeholder="从 CRM 带入：输入订单号或客户名"
          className="h-9 pl-9 text-[13px]"
        />
        {pending && <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      {open && res && (res.orders.length > 0 || res.customers.length > 0) && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-popover p-1 shadow-lg">
          {res.orders.length > 0 && <p className="px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">订单（带入买方、条款、明细、装箱、物流）</p>}
          {res.orders.map((o) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick("order", o.id, o.no)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-muted"
            >
              <span className="font-medium tabular-nums">{o.no}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{o.buyerName}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatAmount(o.total, o.currency)}</span>
            </button>
          ))}
          {res.customers.length > 0 && <p className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground">客户（带入买方信息）</p>}
          {res.customers.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick("customer", c.id, c.name)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-muted"
            >
              <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 明细 ──

function ProductAdd({ onAdd }: { onAdd: (it: DocItem) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Awaited<ReturnType<typeof searchProductsAction>>>([]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => setList(await searchProductsAction(q)), 220);
    return () => clearTimeout(t);
  }, [q, open]);
  return (
    <div className="relative flex-1">
      <Input
        value={q}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        onChange={(e) => setQ(e.target.value)}
        placeholder="从产品库添加…"
        className="h-8 px-3 text-[13px]"
      />
      {open && list.length > 0 && (
        <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-popover p-1 shadow-lg">
          {list.map((p) => (
            <button
              key={p.sku}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onAdd({
                  itemNo: p.sku,
                  name: (p.nameEn || p.name).toUpperCase(),
                  desc: p.spec ?? undefined,
                  unit: (p.unit || "pcs").toUpperCase(),
                  unitPrice: String(p.price),
                  imageUrl: p.imageUrl ?? undefined,
                  hsCode: p.hsCode ?? undefined,
                });
                setQ("");
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-muted"
            >
              <span className="shrink-0 font-medium tabular-nums">{p.sku}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.nameEn || p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemsEditor({ cols, data, currency, onItems }: { cols: ItemCol[]; data: DocData; currency: string; onItems: (items: DocItem[]) => void }) {
  const items = data.items;
  const set = (i: number, k: ItemCol, v: string) => onItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const t = totals(data);
  const showAmount = cols.includes("unitPrice");
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-line bg-card p-2.5">
          <div className="mb-1.5 flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">#{i + 1}</span>
            {showAmount && <span className="tabular-nums">金额 {formatAmount(lineAmount(it), currency)}</span>}
            <span className="ml-auto flex gap-0.5">
              <Button type="button" size="icon-xs" variant="ghost" title="复制一行" onClick={() => onItems([...items.slice(0, i + 1), { ...it }, ...items.slice(i + 1)])}>
                <Copy />
              </Button>
              <Button type="button" size="icon-xs" variant="ghost" title="删除" onClick={() => onItems(items.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {cols.map((k) => {
              const wide = k === "name" || k === "desc" || k === "imageUrl";
              if (k === "unit") {
                return (
                  <label key={k} className="col-span-2 space-y-0.5">
                    <span className="text-[11px] text-muted-foreground">{ITEM_COLS[k]}</span>
                    <Input
                      list="doc-units"
                      value={it.unit ?? ""}
                      onChange={(e) => set(i, k, e.target.value.toUpperCase())}
                      className="h-8 px-2 text-[13px] uppercase"
                    />
                  </label>
                );
              }
              return (
                <label key={k} className={cn("space-y-0.5", wide ? "col-span-6" : "col-span-2")}>
                  <span className="text-[11px] text-muted-foreground">{ITEM_COLS[k]}</span>
                  {k === "desc" ? (
                    <Textarea
                      value={it[k] ?? ""}
                      onChange={(e) => set(i, k, e.target.value)}
                      className="min-h-9 rounded-lg px-2 py-1.5 text-[13px]"
                    />
                  ) : (
                    <Input
                      value={it[k] ?? ""}
                      inputMode={["qty", "unitPrice", "cartons", "nw", "gw", "cbm"].includes(k) ? "decimal" : undefined}
                      onChange={(e) => set(i, k, k === "name" ? e.target.value.toUpperCase() : e.target.value)}
                      placeholder={k === "imageUrl" ? "图片链接（可不填）" : undefined}
                      className={cn("h-8 px-2 text-[13px]", k === "name" && "uppercase")}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <datalist id="doc-units">
        {UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onItems([...items, { unit: items.at(-1)?.unit || "PCS" }])}>
          <Plus /> 加一行
        </Button>
        <ProductAdd onAdd={(it) => onItems([...items, it])} />
      </div>
      {items.length > 0 && (
        <p className="text-[12px] text-muted-foreground tabular-nums">
          合计：数量 {t.qty || 0}
          {t.qtyUnit ? ` ${t.qtyUnit}` : ""}
          {showAmount && ` · 金额 ${formatAmount(t.total, currency)}`}
          {t.packages ? ` · ${t.packages} 件` : ""}
          {t.gw ? ` · 毛重 ${t.gw} KG` : ""}
          {t.cbm ? ` · ${t.cbm} CBM` : ""}
        </p>
      )}
    </div>
  );
}

function ChargesEditor({ charges, onCharges }: { charges: DocCharge[]; onCharges: (c: DocCharge[]) => void }) {
  return (
    <div className="space-y-1.5">
      {charges.map((c, i) => (
        <div key={i} className="flex gap-1.5">
          <Input
            value={c.label ?? ""}
            onChange={(e) => onCharges(charges.map((x, j) => (j === i ? { ...x, label: e.target.value.toUpperCase() } : x)))}
            placeholder="FREIGHT"
            className="h-8 flex-1 px-2 text-[13px] uppercase"
          />
          <Input
            value={c.amount ?? ""}
            inputMode="decimal"
            onChange={(e) => onCharges(charges.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
            placeholder="金额（折扣填负数）"
            className="h-8 w-36 px-2 text-[13px]"
          />
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => onCharges(charges.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {["FREIGHT", "EXPRESS FEE", "INSURANCE", "BANK CHARGES", "DISCOUNT"].map((l) => (
          <Chip key={l} onClick={() => onCharges([...charges, { label: l, amount: "" }])}>
            + {l}
          </Chip>
        ))}
      </div>
    </div>
  );
}

// ── 表单 ──

export function DocForm({
  type,
  data,
  onSet,
  onItems,
  onCharges,
  onApply,
  focusKey,
}: {
  type: DocType;
  data: DocData;
  onSet: (k: FieldKey, v: string) => void;
  onItems: (items: DocItem[]) => void;
  onCharges: (c: DocCharge[]) => void;
  onApply: (p: Partial<DocData>, label: string) => void;
  focusKey: { key: string; n: number } | null;
}) {
  const t = TEMPLATES[type];
  const missing = useMemo(() => new Set<string>(missingFields(type, data)), [type, data]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, { closed: boolean; at: number }>>({});
  const root = useRef<HTMLDivElement>(null);
  // 从「还缺 N 项」点过来：所在分组强制展开（比上次手动收起更新就算数）
  const focusGroup = focusKey ? t.groups.find((g) => g.fields.includes(focusKey.key as FieldKey))?.title ?? (focusKey.key === "items" ? "产品明细" : null) : null;
  const isClosed = (title: string) => {
    const c = collapsed[title];
    if (!c?.closed) return false;
    return !(focusKey && focusGroup === title && focusKey.n > c.at);
  };

  // 滚动到那一项并聚焦
  useEffect(() => {
    if (!focusKey) return;
    const raf = requestAnimationFrame(() => {
      const el = root.current?.querySelector<HTMLElement>(`#f-${focusKey.key}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      (el?.matches("input,textarea") ? el : el?.querySelector<HTMLElement>("input,textarea,button"))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusKey]);

  const req = (k: string) => (t.required as string[]).includes(k);
  const totalsNow = totals(data);
  const autoHint = (k: FieldKey) =>
    k === "totalPackages" && totalsNow.packages
      ? `按明细：${totalsNow.packages}`
      : k === "totalGw" && totalsNow.gw
        ? `按明细：${totalsNow.gw}`
        : k === "totalNw" && totalsNow.nw
          ? `按明细：${totalsNow.nw}`
          : k === "totalCbm" && totalsNow.cbm
            ? `按明细：${totalsNow.cbm}`
            : k === "draftAmount" && totalsNow.total
              ? `按发票：${totalsNow.total}`
              : undefined;

  const group = (title: string, body: React.ReactNode, count?: number) => {
    const closed = isClosed(title);
    return (
      <section key={title} className="border-b border-line py-3 last:border-0">
        <button
          type="button"
          aria-expanded={!closed}
          onClick={() => setCollapsed((c) => ({ ...c, [title]: { closed: !closed, at: Date.now() } }))}
          className="flex w-full items-center gap-2 text-left text-[13px] font-medium"
        >
          {title}
          {!!count && <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-normal text-amber-700 tabular-nums">缺 {count}</span>}
          <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", closed && "-rotate-90")} />
        </button>
        {!closed && <div className="mt-2.5 space-y-3">{body}</div>}
      </section>
    );
  };

  return (
    <div ref={root} className="px-4 pb-6">
      <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-line bg-card/95 px-4 pt-3 pb-3 backdrop-blur">
        <SourcePicker onApply={onApply} />
        <button type="button" onClick={() => setRulesOpen((v) => !v)} className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("size-3.5 transition-transform", !rulesOpen && "-rotate-90")} />
          {t.name}版式要点（按公司样本）
        </button>
        {rulesOpen && (
          <ul className="ml-4 list-disc space-y-0.5 text-[12px] text-muted-foreground">
            {t.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      {t.itemCols.length > 0 &&
        group(
          "产品明细",
          <div id="f-items">
            <ItemsEditor cols={t.itemCols} data={data} currency={data.currency || "USD"} onItems={onItems} />
          </div>,
          missing.has("items") ? 1 : 0,
        )}
      {t.charges && group("附加费用", <ChargesEditor charges={data.charges} onCharges={onCharges} />)}
      {t.groups.map((g) =>
        group(
          g.title,
          g.fields.map((k) => {
            const meta = FIELDS[k] as FieldMeta;
            return (
              <div key={k} className="space-y-1">
                <label htmlFor={`f-${k}`} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  {meta.label}
                  {req(k) && <span className={cn("size-1.5 rounded-full", missing.has(k) ? "bg-amber-500" : "bg-ok")} />}
                </label>
                <FieldInput id={`f-${k}`} meta={meta} value={data[k] ?? ""} onChange={(v) => onSet(k, v)} placeholder={autoHint(k)} upper={!KEEP_CASE.has(k)} />
                {meta.hint && <p className="text-[11px] leading-snug text-muted-foreground/80">{meta.hint}</p>}
              </div>
            );
          }),
          g.fields.filter((k) => missing.has(k)).length,
        ),
      )}
    </div>
  );
}
