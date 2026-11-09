import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/crm/bits";
import { formatDate } from "@/lib/crm";
import { formatAmount, orderStatus, quotationStatus } from "@/lib/docs";
import { PaneEmpty, PaneToolbar } from "./detail-ui";

export type CustomerDocRow = {
  id: string;
  no: string;
  status: string;
  total: string;
  currency: string;
  date: string;
  /** 订单：已收金额 */
  paid?: string;
};

/** 客户详情页签里的报价单 / 订单列表（放在页签卡片内，不自带卡片） */
export function CustomerDocsCard({
  kind,
  customerId,
  rows,
  canCreate,
  tz,
}: {
  kind: "quotation" | "order";
  customerId: string;
  rows: CustomerDocRow[];
  canCreate: boolean;
  tz: string;
}) {
  const isQuote = kind === "quotation";
  const base = isQuote ? "/quotations" : "/orders";
  return (
    <div>
      <PaneToolbar
        action={
          canCreate && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`${base}/new?customerId=${customerId}`}>
                <Plus /> {isQuote ? "新建报价单" : "新建订单"}
              </Link>
            </Button>
          )
        }
      >
        {rows.length > 0 && <span className="tabular-nums">共 {rows.length} 张{isQuote ? "报价单" : "订单"}</span>}
      </PaneToolbar>
      {rows.length === 0 ? (
        <PaneEmpty>{isQuote ? "还没有报价单" : "还没有订单"}</PaneEmpty>
      ) : (
        <ul className="divide-y divide-border/70">
          {rows.map((r) => {
            const st = isQuote ? quotationStatus(r.status) : orderStatus(r.status);
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link href={`${base}/${r.id}`} className="font-medium tabular-nums hover:text-primary hover:underline">
                    {r.no}
                  </Link>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(r.date, tz)}
                    {r.paid !== undefined && ` · 已收 ${formatAmount(r.paid)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium whitespace-nowrap tabular-nums">{formatAmount(r.total, r.currency)}</span>
                  <StatusBadge name={st.label} color={st.color} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
