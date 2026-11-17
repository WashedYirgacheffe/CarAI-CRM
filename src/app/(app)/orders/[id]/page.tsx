import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/crm/bits";
import { InfoGrid, ItemsCard, moneyOf, viewItems } from "@/components/crm/doc-view";
import { can, requireUser } from "@/server/auth";
import { getOrderForUser } from "@/server/documents";
import { formatDate, formatDateTime, toLocalInput } from "@/lib/crm";
import { dateInput, orderStatus, approvalStatus } from "@/lib/docs";
import { OrderActions } from "./order-actions";
import { QuickReminder } from "@/components/crm/tasks";
import { PaymentsCard } from "./payments-card";
import { ShipmentsCard } from "./shipments-card";
import { tenantDb } from "@/server/db";

export async function generateMetadata({ params }: PageProps<"/orders/[id]">): Promise<Metadata> {
  const { id } = await params;
  const o = await getOrderForUser(await requireUser(), id);
  return { title: o ? `订单 ${o.no}` : "订单" };
}

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const o = await getOrderForUser(user, id);
  if (!o) notFound();
  const tz = user.timezone;
  const st = orderStatus(o.status);
  const canEdit = can(user, "order.edit");
  const [members, files] = await Promise.all([
    tenantDb(user.tenantId).user.findMany({ select: { id: true, name: true } }),
    canEdit
      ? tenantDb(user.tenantId).crmFile.findMany({
          where: { customerId: o.customerId },
          orderBy: { createdAt: "desc" },
          take: 60,
          select: { id: true, name: true },
        })
      : [],
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const day = (d: Date | null) => (d ? toLocalInput(d, tz, false) : null);

  return (
    <>
      <Link href="/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        订单
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-normal tracking-tight tabular-nums">{o.no}</h1>
            <StatusBadge name={st.label} color={st.color} />
            {o.approval !== "NONE" && <StatusBadge name={approvalStatus(o.approval).label} color={approvalStatus(o.approval).color} />}
          </div>
          <p className="text-sm text-muted-foreground">
            <Link href={`/customers/${o.customer.id}`} className="text-foreground hover:text-primary hover:underline">
              {o.customer.name}
            </Link>
            {o.quotation && (
              <>
                {" · 来自报价单 "}
                <Link href={`/quotations/${o.quotation.id}`} className="tabular-nums hover:text-primary hover:underline">
                  {o.quotation.no}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuickReminder tz={tz} context="order" customerId={o.customerId} link={`/orders/${o.id}`} subject={`订单 ${o.no}`} />
          <OrderActions id={o.id} no={o.no} status={o.status} perms={{ edit: canEdit, delete: can(user, "order.delete") }} />
        </div>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Card>
            <CardHeader>
              <CardTitle>订单信息</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid
                items={[
                  ["下单日期", formatDate(o.orderDate, tz)],
                  ["交货日期", formatDate(o.deliveryDate, tz)],
                  ["贸易术语", [o.tradeTerm, o.port].filter(Boolean).join(" ")],
                  ["付款方式", o.paymentTerm],
                  ["关联商机", o.opportunity?.name],
                  ["负责人", o.owner?.name],
                  ["买方", [o.buyerName, o.buyerAddress].filter(Boolean).join("\n")],
                  ["联系人", [o.buyerContact, o.buyerEmail, o.buyerPhone].filter(Boolean).join("\n")],
                  ["唛头", o.shippingMark],
                ]}
              />
            </CardContent>
          </Card>
          <PaymentsCard
            orderId={o.id}
            canEdit={canEdit}
            currency={o.currency}
            total={o.total.toString()}
            paid={o.paidAmount.toString()}
            today={dateInput(tz)}
            orderDate={toLocalInput(o.orderDate, tz, false)}
            deliveryDate={o.deliveryDate ? toLocalInput(o.deliveryDate, tz, false) : null}
            files={files}
            plans={o.plans.map((p) => ({ id: p.id, label: p.label, amount: p.amount.toString(), dueDate: toLocalInput(p.dueDate, tz, false) }))}
            payments={o.payments.map((p) => ({
              id: p.id,
              no: p.no,
              amount: p.amount.toString(),
              fee: p.fee?.toString() ?? null,
              payer: p.payer,
              receivedAt: toLocalInput(p.receivedAt, tz, false),
              method: p.method,
              remark: p.remark,
              file: p.file,
            }))}
          />
        </div>

        <ShipmentsCard
          canEdit={canEdit}
          today={dateInput(tz)}
          order={{ id: o.id, no: o.no, buyer: o.buyerName, contact: o.buyerContact, port: o.port, seller: user.tenantName }}
          shipments={o.shipments.map((s) => ({
            id: s.id,
            no: s.no,
            status: s.status,
            mode: s.mode,
            forwarder: s.forwarder,
            carrier: s.carrier,
            bookingNo: s.bookingNo,
            blNo: s.blNo,
            containerNo: s.containerNo,
            containerType: s.containerType,
            sealNo: s.sealNo,
            vessel: s.vessel,
            trackingNo: s.trackingNo,
            trackingUrl: s.trackingUrl,
            portLoading: s.portLoading,
            portDischarge: s.portDischarge,
            packages: s.packages,
            grossWeight: s.grossWeight?.toString() ?? null,
            volume: s.volume?.toString() ?? null,
            freight: s.freight?.toString() ?? null,
            freightCcy: s.freightCcy,
            cutoffAt: day(s.cutoffAt),
            etd: day(s.etd),
            eta: day(s.eta),
            atd: day(s.atd),
            ata: day(s.ata),
            deliveredAt: day(s.deliveredAt),
            remark: s.remark,
            events: s.events.map((e) => ({ id: e.id, status: e.status, at: day(e.at)!, note: e.note, by: e.userId ? (nameOf.get(e.userId) ?? null) : null })),
          }))}
        />

        <ItemsCard items={viewItems(o.items)} money={moneyOf(o)} />

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>条款</CardTitle>
            </CardHeader>
            <CardContent className="text-sm whitespace-pre-line">{o.terms || <span className="text-muted-foreground">无</span>}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>内部备注</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="whitespace-pre-line">{o.remark || <span className="text-muted-foreground">无备注</span>}</p>
              <p className="text-xs text-muted-foreground">
                创建于 {formatDateTime(o.createdAt, tz)} · 更新于 {formatDateTime(o.updatedAt, tz)}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
