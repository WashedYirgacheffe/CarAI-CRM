import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * 列表页顶部的洞察卡片行：手机上横向滑动（每张约占 85% 屏宽），平板两列，大屏四列。
 */
export function InsightRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "-mx-3 mb-3 flex snap-x snap-mandatory scroll-px-3 gap-2.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none]",
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
    // 手机上只留标题 + 数字的小卡片（约 40% 屏宽，一屏两张半），明细图表和说明桌面端才显示
    <section
      className={cn(
        "surface flex w-[40%] min-w-0 shrink-0 snap-start flex-col px-3.5 py-3 md:w-auto md:p-4",
        value === undefined && "max-md:hidden",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="truncate text-[13px] text-muted-foreground md:text-sm">{title}</h2>
        {action && (
          <Link href={action.href} className="hidden shrink-0 text-xs text-muted-foreground hover:text-primary md:inline">
            {action.label}
          </Link>
        )}
      </header>
      {value !== undefined && <p className="mt-0.5 truncate text-xl leading-tight font-normal md:mt-1 md:text-2xl">{value}</p>}
      {hint && <div className="mt-0.5 hidden text-xs text-muted-foreground md:block">{hint}</div>}
      {children && <div className="mt-3 hidden flex-1 md:block">{children}</div>}
    </section>
  );
}
