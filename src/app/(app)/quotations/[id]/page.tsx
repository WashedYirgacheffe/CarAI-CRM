import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/crm/bits";
import { InfoGrid, ItemsCard, moneyOf, viewItems } from "@/components/crm/doc-view";
import { can, requireUser } from "@/server/auth";
import { getQuotationForUser } from "@/server/documents";
import { formatDate, formatDateTime } from "@/lib/crm";
import { isPast, orderStatus, quotationStatus } from "@/lib/docs";
import { QuotationActions } from "./quotation-actions";

export async function generateMetadata({ params }: PageProps<"/quotations/[id]">): Promise<Metadata> {
  const { id } = await params;
  const q = await getQuotationForUser(await requireUser(), id);
  return { title: q ? `报价单 ${q.no}` : "报价单" };
}

export default async function QuotationPage({ params }: PageProps<"/quotations/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const q = await getQuotationForUser(user, id);
  if (!q) notFound();
  const tz = user.timezone;
  const st = quotationStatus(q.status);
  const expired = (q.status === "DRAFT" || q.status === "SENT") && isPast(q.validUntil);

  return (
    <>
      <Link href="/quotations" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        报价单
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight tabular-nums">{q.no}</h1>
            <StatusBadge name={st.label} color={st.color} />
          </div>
          <p className="text-sm text-muted-foreground">
            <Link href={`/customers/${q.customer.id}`} className="text-foreground hover:text-primary hover:underline">
              {q.customer.name}
            </Link>
            {q.title && ` · ${q.title}`}
          </p>
        </div>
        <QuotationActions
          id={q.id}
          no={q.no}
          status={q.status}
          perms={{
            edit: can(user, "quotation.edit"),
            create: can(user, "quotation.create"),
            delete: can(user, "quotation.delete"),
            createOrder: can(user, "order.create"),
          }}
        />
      </div>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">报价信息</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoGrid
              items={[
                ["报价日期", formatDate(q.quoteDate, tz)],
                ["有效期至", q.validUntil ? formatDate(q.validUntil, tz) + (expired ? "（已过期）" : "") : null],
                ["贸易术语", [q.tradeTerm, q.port].filter(Boolean).join(" ")],
                ["付款方式", q.paymentTerm],
                ["交货期", q.deliveryTime],
                ["关联商机", q.opportunity?.name],
                ["买方", [q.buyerName, q.buyerAddress].filter(Boolean).join("\n")],
                ["联系人", [q.buyerContact, q.buyerEmail, q.buyerPhone].filter(Boolean).join("\n")],
                ["负责人", q.owner?.name],
              ]}
            />
          </CardContent>
        </Card>

        <ItemsCard items={viewItems(q.items)} money={moneyOf(q)} />

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">条款</CardTitle>
            </CardHeader>
            <CardContent className="text-sm whitespace-pre-line">
              {q.terms || <span className="text-muted-foreground">无</span>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">内部备注与关联</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="whitespace-pre-line">{q.remark || <span className="text-muted-foreground">无备注</span>}</p>
              {q.orders.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">已转订单</p>
                  <ul className="mt-1 space-y-1">
                    {q.orders.map((o) => (
                      <li key={o.id} className="flex items-center gap-2">
                        <Link href={`/orders/${o.id}`} className="tabular-nums hover:text-primary hover:underline">
                          {o.no}
                        </Link>
                        <StatusBadge name={orderStatus(o.status).label} color={orderStatus(o.status).color} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                创建于 {formatDateTime(q.createdAt, tz)} · 更新于 {formatDateTime(q.updatedAt, tz)}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
