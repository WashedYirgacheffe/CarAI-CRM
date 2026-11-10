"use client";

import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

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
        <ul className="space-y-2 p-3">{children}</ul>
      ) : (
        <p className="px-6 py-14 text-center text-sm text-muted-foreground">{empty ?? "暂无数据"}</p>
      )}
    </div>
  );
}

/**
 * 一张卡片：顶部 [勾选] 标题 + 右侧 aside（状态/金额），下面 sub（副标题）、children（自由内容）、footer（标签/操作）。
 * 传 href 时整张卡可点（操作区按钮仍可单独点）。
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
  className,
}: {
  href?: string;
  leading?: React.ReactNode;
  title: React.ReactNode;
  aside?: React.ReactNode;
  sub?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  select?: { checked: boolean; onChange: (v: boolean) => void; label: string };
  selected?: boolean;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "relative rounded-2xl bg-muted/45 p-3.5 ring-1 ring-border/50 transition-colors",
        href && "active:bg-accent/70",
        (selected || select?.checked) && "bg-accent/70 ring-primary/30",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        {select && (
          <Checkbox
            aria-label={select.label}
            checked={select.checked}
            onCheckedChange={(v) => select.onChange(!!v)}
            className="relative z-10 mt-0.5 bg-card"
          />
        )}
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 text-[15px] leading-snug font-medium">
              {href ? (
                <Link href={href} className="line-clamp-2 after:absolute after:inset-0 after:rounded-2xl after:content-['']">
                  {title}
                </Link>
              ) : (
                <span className="line-clamp-2">{title}</span>
              )}
            </div>
            {aside && <div className="relative z-10 shrink-0 text-right">{aside}</div>}
          </div>
          {sub && <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{sub}</div>}
          {children && <div className="mt-2.5">{children}</div>}
          {footer && <div className="relative z-10 mt-2.5 flex flex-wrap items-center gap-1.5">{footer}</div>}
        </div>
      </div>
    </li>
  );
}

/** 卡片里的两列小字段 */
export function MobileMeta({ items }: { items: (readonly [React.ReactNode, React.ReactNode, string?] | false | null | undefined | "" | 0)[] }) {
  const list = items.filter(Boolean) as (readonly [React.ReactNode, React.ReactNode, string?])[];
  if (!list.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
      {list.map(([k, v, cls], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className={cn("truncate tabular-nums", cls)}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
