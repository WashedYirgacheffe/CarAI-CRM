import { Inbox, type LucideIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** 统一空状态：虚线圆圈 + 图标 + 一句话 */
export function EmptyState({
  children,
  icon: Icon = Inbox,
  className,
  compact,
}: {
  children?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2.5 text-center", compact ? "py-5" : "py-10", className)}>
      <span
        className={cn(
          "flex items-center justify-center rounded-full border border-dashed border-foreground/25 text-muted-foreground",
          compact ? "size-9" : "size-12",
        )}
      >
        <Icon className={compact ? "size-4" : "size-5"} strokeWidth={1.75} />
      </span>
      <p className="text-sm text-muted-foreground">{children ?? "暂无数据"}</p>
    </div>
  );
}
