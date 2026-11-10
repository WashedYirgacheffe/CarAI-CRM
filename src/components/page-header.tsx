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
    <div className={cn("mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2.5 md:mb-6", className)}>
      <div className="space-y-1">
        <h1 className="text-2xl leading-tight font-normal tracking-[-0.02em] md:text-[30px]">{title}</h1>
        {description && <p className="text-[13px] text-muted-foreground md:text-sm">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
