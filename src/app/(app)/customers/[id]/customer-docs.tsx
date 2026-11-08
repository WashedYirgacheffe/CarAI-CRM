import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/crm/bits";
import { formatDate } from "@/lib/crm";
import { formatAmount, orderStatus, quotationStatus } from "@/lib/docs";

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

/** 客户详情里的报价单 / 订单列表 */
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{isQuote ? "报价单" : "订单"}</CardTitle>
        {canCreate && (
          <CardAction>
            <Button size="sm" variant="outline" asChild>
              <Link href={`${base}/new?customerId=${customerId}`}>
                <Plus /> {isQuote ? "新建报价单" : "新建订单"}
              </Link>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{isQuote ? "还没有报价单" : "还没有订单"}</p>
        ) : (
          <ul className="divide-y">
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
      </CardContent>
    </Card>
  );
}
