import { Inbox, type LucideIcon } from "@/components/icons";
import { SkyGlow } from "@/components/agentes/sky";
import { cn } from "@/lib/utils";

/** 统一空状态：一团模块色的像素天光，中间漂着个小人（agentes 的空状态）；compact 时用图标 */
export function EmptyState({
  children,
  icon: Icon = Inbox,
  className,
  compact,
  surface,
}: {
  children?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
  compact?: boolean;
  /** 空状态所在的底色（CSS 变量名），天光从它淡出；放在卡片里时传 "--raised" */
  surface?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2.5 py-5" : "gap-1 py-6", className)}>
      {compact ? (
        <span className="ac-tile size-9 opacity-90">
          <Icon className="size-4" strokeWidth={2} />
        </span>
      ) : (
        <SkyGlow surface={surface ?? "--raised"} className="h-28 w-48" />
      )}
      <p className="text-sm text-muted-foreground">{children ?? "暂无数据"}</p>
    </div>
  );
}
