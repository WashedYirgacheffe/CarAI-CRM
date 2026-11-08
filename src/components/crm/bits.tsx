"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_COLORS, countryName } from "@/lib/crm";

export function StatusBadge({ name, color, className }: { name?: string | null; color?: string | null; className?: string }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_COLORS[color ?? "slate"] ?? STATUS_COLORS.slate,
        className,
      )}
    >
      {name}
    </span>
  );
}

/** 星级。传 onChange 时可点击修改（再点同一颗星清零） */
export function StarRating({
  value,
  onChange,
  size = "sm",
}: {
  value: number;
  onChange?: (v: number) => Promise<unknown> | void;
  size?: "sm" | "md";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [optimistic, setOptimistic] = useState<number | null>(null);
  const [, start] = useTransition();
  const shown = hover ?? optimistic ?? value;
  const cls = size === "md" ? "size-4.5" : "size-3.5";
  if (!onChange) {
    return (
      <span className="inline-flex gap-0.5" aria-label={`${value} 星`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={cn(cls, i <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />
        ))}
      </span>
    );
  }
  return (
    <span className="inline-flex gap-0.5" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          aria-label={`${i} 星`}
          className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onMouseEnter={() => setHover(i)}
          onClick={() => {
            const next = i === value ? 0 : i;
            setOptimistic(next);
            start(async () => {
              await onChange(next);
              setOptimistic(null);
            });
          }}
        >
          <Star className={cn(cls, i <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />
        </button>
      ))}
    </span>
  );
}

export function CountryLabel({ code }: { code?: string | null }) {
  if (!code) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="mr-1 text-xs text-muted-foreground">{code}</span>
      {countryName(code)}
    </span>
  );
}

export function Tags({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (!tags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.slice(0, max).map((t) => (
        <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {t}
        </span>
      ))}
      {tags.length > max && <span className="text-xs text-muted-foreground">+{tags.length - max}</span>}
    </span>
  );
}
