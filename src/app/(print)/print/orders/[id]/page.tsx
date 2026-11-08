import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintDoc } from "@/components/crm/print-doc";
import { PrintToolbar } from "@/components/crm/print-toolbar";
import { requireUser } from "@/server/auth";
import { getOrderForUser, getSeller } from "@/server/documents";

export async function generateMetadata({ params }: PageProps<"/print/orders/[id]">): Promise<Metadata> {
  const { id } = await params;
  const o = await getOrderForUser(await requireUser(), id);
  return { title: { absolute: o ? `PI ${o.no} - ${o.buyerName}` : "Proforma Invoice" } };
}

export default async function PrintOrderPage({ params }: PageProps<"/print/orders/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const [o, seller] = await Promise.all([getOrderForUser(user, id), getSeller(user.tenantId)]);
  if (!o) notFound();
  return (
    <>
      <PrintToolbar backHref={`/orders/${id}`} hint="单据抬头和银行信息在「设置 → 单据设置」里维护" />
      <PrintDoc
        tz={user.timezone}
        seller={seller}
        doc={{
          kind: "order",
          no: o.no,
          date: o.orderDate,
          date2: o.deliveryDate,
          buyerName: o.buyerName,
          buyerContact: o.buyerContact,
          buyerEmail: o.buyerEmail,
          buyerPhone: o.buyerPhone,
          buyerAddress: o.buyerAddress,
          currency: o.currency,
          tradeTerm: o.tradeTerm,
          port: o.port,
          paymentTerm: o.paymentTerm,
          shippingMark: o.shippingMark,
          subtotal: o.subtotal.toString(),
          discount: o.discount.toString(),
          shippingFee: o.shippingFee.toString(),
          otherFee: o.otherFee.toString(),
          total: o.total.toString(),
          terms: o.terms,
          salesName: o.owner?.name ?? null,
          items: o.items.map((i) => ({
            id: i.id,
            sku: i.sku,
            name: i.name,
            spec: i.spec,
            imageUrl: i.imageUrl,
            unit: i.unit,
            quantity: i.quantity.toString(),
            unitPrice: i.unitPrice.toString(),
            amount: i.amount.toString(),
          })),
        }}
      />
    </>
  );
}
