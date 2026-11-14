"use client";

import { useState } from "react";
import { Eye, Loader2 } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VisitList, VisitSummary } from "@/components/crm/visit-timeline";
import { formatDateTime } from "@/lib/crm";
import type { VisitView } from "@/lib/share-visit";
import { shareVisitsAction } from "../visit-actions";

/** 客户动态里「客户打开了报价单 / 表单 / 产品卡」：点开看每次打开的地点、设备和停留 */
export function ShareViewRow({
  customerId,
  refKey,
  content,
  at,
  tz,
}: {
  customerId: string;
  refKey: string;
  content: string;
  at: string;
  tz: string;
}) {
  const [visits, setVisits] = useState<VisitView[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (open: boolean) => {
    if (!open || loading) return;
    setLoading(true);
    setVisits((await shareVisitsAction(customerId, refKey)) ?? []);
    setLoading(false);
  };

  return (
    <li className="relative flex gap-3 text-xs">
      <span className="z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink ring-4 ring-card">
        <Eye className="size-3" />
      </span>
      <Popover onOpenChange={load}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="-mx-1.5 -my-0.5 min-w-0 flex-1 rounded-md px-1.5 py-0.5 text-left text-muted-foreground hover:bg-muted/60 data-[state=open]:bg-muted/60"
          >
            <span className="tabular-nums">{formatDateTime(at, tz)}</span> · <span className="text-foreground">{content}</span>
            <span className="ml-1 text-primary">详情</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-[min(32rem,70vh)] w-[22rem] overflow-y-auto">
          {visits === null ? (
            <p className="flex items-center gap-1.5 py-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-3.5" /> 正在读取访问记录
            </p>
          ) : (
            <>
              <VisitSummary visits={visits} />
              <VisitList visits={visits} tz={tz} />
            </>
          )}
        </PopoverContent>
      </Popover>
    </li>
  );
}
