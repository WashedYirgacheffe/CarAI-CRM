import { cn } from "@/lib/utils";

/** 客户详情页里的白色卡片（surface），可带标题栏和右侧操作 */
export function Panel({
  title,
  icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("surface", className)}>
      {title && (
        <header className="flex min-h-12 items-center gap-2 px-4 pt-3 pb-2 md:px-5">
          <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            {icon}
            {title}
          </h2>
          {action && <div className="ml-auto flex shrink-0 items-center gap-1">{action}</div>}
        </header>
      )}
      <div className={cn("px-4 pb-4 md:px-5 md:pb-5", !title && "pt-4 md:pt-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** 页签内容顶部的工具条：左侧说明，右侧操作 */
export function PaneToolbar({ children, action }: { children?: React.ReactNode; action?: React.ReactNode }) {
  if (!children && !action) return null;
  return (
    <div className="mb-3 flex min-h-8 items-center gap-3">
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">{children}</div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** 页签内容的空状态 */
export function PaneEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}
