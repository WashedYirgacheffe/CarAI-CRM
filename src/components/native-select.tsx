"use client";

import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Check, ChevronDown, Search } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { noAutofill } from "@/lib/no-autofill";

/*
 * 自定义下拉（替代浏览器原生 select 的弹出列表），用法和 <select> 完全一样：
 *   <NativeSelect name="x" defaultValue="a" onChange={(e) => e.target.value}>
 *     <option value="a">A</option>
 *   </NativeSelect>
 * 里面保留一个隐藏的原生 select：负责表单提交（FormData / required），选中时派发真实的 change 事件，
 * 所以 onChange 拿到的还是原来的 e.target.value，调用处不用改。
 */

type Opt = { value: string; label: string; disabled?: boolean; group?: string };

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function parse(children: ReactNode, group?: string, out: Opt[] = []): Opt[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<{ value?: unknown; children?: ReactNode; disabled?: boolean; label?: string }>;
    if (el.type === "option") {
      const label = textOf(el.props.children);
      out.push({ value: el.props.value != null ? String(el.props.value) : label, label, disabled: el.props.disabled, group });
    } else if (el.type === "optgroup") parse(el.props.children, el.props.label, out);
    else parse(el.props.children, group, out);
  });
  return out;
}

export function NativeSelect({
  className,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  id,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  ...rest
}: React.ComponentProps<"select">) {
  const opts = useMemo(() => parse(children), [children]);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(() => (defaultValue != null ? String(defaultValue) : (opts.find((o) => !o.disabled)?.value ?? "")));
  const current = controlled ? String(value ?? "") : inner;
  const sel = opts.find((o) => o.value === current);
  const placeholder = sel && sel.value === "";

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const searchable = opts.length > 10;
  const shown = q ? opts.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : opts;

  // 表单 reset 后跟着回到默认值
  useEffect(() => {
    const form = selectRef.current?.form;
    if (!form || controlled) return;
    const onReset = () => setInner(defaultValue != null ? String(defaultValue) : (opts.find((o) => !o.disabled)?.value ?? ""));
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [controlled, defaultValue, opts]);

  const pick = (v: string) => {
    setOpen(false);
    if (v === current) return;
    const s = selectRef.current;
    if (!controlled) setInner(v);
    if (s) {
      s.value = v;
      // 真实的 change 事件：React 的 onChange 照常触发，e.target 就是这个 select
      s.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const focusItem = (dir: 1 | -1 | 0) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)") ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      dir === 0
        ? Math.max(
            0,
            items.findIndex((x) => x.dataset.selected === "true"),
          )
        : (i + dir + items.length) % items.length;
    items[next]?.focus({ preventScroll: false });
    items[next]?.scrollIntoView({ block: "nearest" });
  };

  return (
    <>
      <select
        ref={selectRef}
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        value={current}
        onChange={(e) => {
          if (!controlled) setInner(e.target.value);
          onChange?.(e);
        }}
        className="sr-only"
        {...rest}
      >
        {children}
      </select>
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setQ("");
        }}
      >
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-label={ariaLabel}
            aria-invalid={ariaInvalid}
            aria-expanded={open}
            aria-controls={listId}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setOpen(true);
              }
            }}
            className={cn(
              "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm outline-none transition-colors hover:border-primary/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-ring aria-invalid:border-destructive max-md:h-10 max-md:text-[15px]",
              className,
            )}
          >
            <span className={cn("truncate", placeholder && "text-muted-foreground")}>{sel?.label ?? "请选择"}</span>
            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[max(var(--radix-popover-trigger-width),11rem)] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden rounded-xl p-1"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() =>
              searchable ? listRef.current?.parentElement?.querySelector<HTMLInputElement>("input")?.focus() : focusItem(0),
            );
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              focusItem(e.key === "ArrowDown" ? 1 : -1);
            }
          }}
        >
          {searchable && (
            <div className="relative mb-1 border-b border-border/70 p-1 pb-2">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-[60%] text-muted-foreground" />
              <input
                {...noAutofill}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索"
                className="h-8 w-full rounded-lg bg-muted/70 pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <div ref={listRef} id={listId} role="listbox" className="max-h-72 overflow-y-auto overscroll-contain">
            {shown.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的选项</p>}
            {shown.map((o, i) => {
              const head = o.group && o.group !== shown[i - 1]?.group ? o.group : null;
              const on = o.value === current;
              return (
                <div key={`${o.group ?? ""}:${o.value}`}>
                  {head && <p className="px-2.5 pt-2 pb-1 text-xs text-muted-foreground">{head}</p>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    data-selected={on}
                    disabled={o.disabled}
                    onClick={() => pick(o.value)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-40 max-md:py-2.5 max-md:text-[15px]",
                      on && "font-medium text-brand-ink",
                      o.value === "" && !on && "text-muted-foreground",
                    )}
                  >
                    <span className="flex-1 truncate">{o.label}</span>
                    {on && <Check className="size-4 shrink-0" />}
                  </button>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
