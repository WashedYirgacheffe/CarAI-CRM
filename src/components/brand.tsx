import { cn } from "@/lib/utils";

/** 产品标识：方形色块 + 字标。正式 Logo 出来后替换这里即可。 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground",
        className,
      )}
      aria-hidden
    >
      车
    </span>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <BrandMark />
      <span className="text-base font-semibold tracking-tight">车车外贸 CRM</span>
    </span>
  );
}
