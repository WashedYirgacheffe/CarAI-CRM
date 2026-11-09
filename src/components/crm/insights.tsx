import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * 列表页顶部的洞察卡片行：手机上横向滑动（每张约占 85% 屏宽），平板两列，大屏四列。
 */
export function InsightRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "-mx-3 mb-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none]",
        "md:mx-0 md:mb-4 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function InsightCard({
  title,
  value,
  hint,
  action,
  children,
  className,
}: {
  title: string;
  value?: React.ReactNode;
  hint?: React.ReactNode;
  action?: { href: string; label: string };
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface flex w-[85%] min-w-0 shrink-0 snap-start flex-col p-4 md:w-auto", className)}>
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="truncate text-sm text-muted-foreground">{title}</h2>
        {action && (
          <Link href={action.href} className="shrink-0 text-xs text-muted-foreground hover:text-primary">
            {action.label}
          </Link>
        )}
      </header>
      {value !== undefined && <p className="mt-1 truncate text-2xl leading-tight font-bold">{value}</p>}
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      {children && <div className="mt-3 flex-1">{children}</div>}
    </section>
  );
}
