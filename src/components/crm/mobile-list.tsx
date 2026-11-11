"use client";

import { useRef } from "react";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/crm/empty-state";
import { SwipeRow, type SwipeAction } from "@/components/crm/swipe-row";

/**
 * 手机端卡片列表。桌面端表格包一层 <DesktopOnly>，手机端用 <MobileList> + <MobileCard> 显示同样的数据。
 * 断点统一在 md（768px）。
 */
export function DesktopOnly({ children }: { children: React.ReactNode }) {
  return <div className="hidden md:block">{children}</div>;
}

export function MobileList({ children, empty, className }: { children?: React.ReactNode; empty?: React.ReactNode; className?: string }) {
  const has = Array.isArray(children) ? children.some(Boolean) : !!children;
  return (
    <div className={cn("md:hidden", className)}>
      {has ? (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-b-2xl">{children}</ul>
      ) : (
        <EmptyState className="px-6 py-14">{empty}</EmptyState>
      )}
    </div>
  );
}

/**
 * 一行：顶部 [勾选] 标题 + 右侧 aside（状态/金额），下面 sub（副标题）、children（自由内容）、footer（标签/操作）。
 * 手机上是贴边的扁平行（不再卡片套卡片）：
 * - 传 href 时整行可点
 * - 传 select 时长按进入多选，多选中（select.selecting）才显示勾选框，点整行即勾选
 * - 传 swipe 时可左右滑出操作按钮
 */
export function MobileCard({
  href,
  leading,
  title,
  aside,
  sub,
  children,
  footer,
  select,
  selected,
  swipe,
  className,
}: {
  href?: string;
  leading?: React.ReactNode;
  title: React.ReactNode;
  aside?: React.ReactNode;
  sub?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  select?: { checked: boolean; onChange: (v: boolean) => void; label: string; selecting?: boolean };
  selected?: boolean;
  swipe?: { left?: SwipeAction[]; right?: SwipeAction[] };
  className?: string;
}) {
  const press = useRef<{ t: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({ t: null, x: 0, y: 0, fired: false });
  const selecting = !!select && (select.selecting ?? select.checked);
  const cancel = () => {
    if (press.current.t) clearTimeout(press.current.t);
    press.current.t = null;
  };
  const on = selected || select?.checked;

  const body = (
    <div
      className={cn(
        "relative bg-card px-4 py-3 transition-colors select-none [-webkit-touch-callout:none]",
        (href || selecting) && "active:bg-muted/60",
        on && "bg-accent",
        className,
      )}
      onPointerDown={(e) => {
        if (!select || e.pointerType !== "touch") return;
        press.current = { t: null, x: e.clientX, y: e.clientY, fired: false };
        press.current.t = setTimeout(() => {
          press.current.fired = true;
          select.onChange(!select.checked);
          navigator.vibrate?.(12);
        }, 450);
      }}
      onPointerMove={(e) => {
        if (Math.abs(e.clientX - press.current.x) > 8 || Math.abs(e.clientY - press.current.y) > 8) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => select && e.preventDefault()}
      onClickCapture={(e) => {
        // 长按刚触发 / 多选中：点击只用来勾选
        if (press.current.fired) {
          press.current.fired = false;
          e.preventDefault();
          e.stopPropagation();
        } else if (selecting && select && !(e.target as HTMLElement).closest("[data-slot=checkbox]")) {
          e.preventDefault();
          e.stopPropagation();
          select.onChange(!select.checked);
        }
      }}
    >
      <div className="flex items-start gap-3">
        {select && selecting && (
          <Checkbox
            aria-label={select.label}
            checked={select.checked}
            onCheckedChange={(v) => select.onChange(!!v)}
            className="relative z-10 mt-0.5 size-5 rounded-full"
          />
        )}
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 text-[15px] leading-snug font-medium">
              {href ? (
                <Link href={href} className="line-clamp-2 after:absolute after:inset-0 after:content-['']">
                  {title}
                </Link>
              ) : (
                <span className="line-clamp-2">{title}</span>
              )}
            </div>
            {aside && <div className="relative z-10 shrink-0 text-right">{aside}</div>}
          </div>
          {sub && <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{sub}</div>}
          {children && <div className="mt-1.5">{children}</div>}
          {footer && <div className="relative z-10 mt-2 flex flex-wrap items-center gap-1.5">{footer}</div>}
        </div>
      </div>
    </div>
  );

  return (
    <li>
      {swipe && !selecting ? (
        <SwipeRow left={swipe.left} right={swipe.right}>
          {body}
        </SwipeRow>
      ) : (
        body
      )}
    </li>
  );
}

/** 手机上一行小字的元信息：「23 天前联系 · 下次 11/19 · 苏颖」 */
export function MobileLine({ items }: { items: (React.ReactNode | false | null | undefined | "")[] }) {
  const list = items.filter((x) => x !== false && x !== null && x !== undefined && x !== "");
  if (!list.length) return null;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground tabular-nums">
      {list.map((x, i) => (
        <span key={i} className="inline-flex min-w-0 items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden className="text-foreground/25">
              ·
            </span>
          )}
          {x}
        </span>
      ))}
    </p>
  );
}

/** 行里的小字段：一行接一行地排「标签 值 · 标签 值」，比两列网格省一半高度 */
export function MobileMeta({ items }: { items: (readonly [React.ReactNode, React.ReactNode, string?] | false | null | undefined | "" | 0)[] }) {
  const list = items.filter(Boolean) as (readonly [React.ReactNode, React.ReactNode, string?])[];
  if (!list.length) return null;
  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
      {list.map(([k, v, cls], i) => (
        <div key={i} className="flex min-w-0 max-w-full items-baseline gap-1">
          <dt className="shrink-0 text-muted-foreground">{k}</dt>
          <dd className={cn("min-w-0 truncate tabular-nums", cls)}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
