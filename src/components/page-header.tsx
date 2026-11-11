import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 md:mb-6 md:items-end", className)}>
      <div className="space-y-1">
        <h1 className="text-2xl leading-tight font-normal tracking-[-0.02em] md:text-[30px]">{title}</h1>
        {/* 说明文字手机上不显示，降低信息密度 */}
        {description && <p className="hidden text-sm text-muted-foreground md:block">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
