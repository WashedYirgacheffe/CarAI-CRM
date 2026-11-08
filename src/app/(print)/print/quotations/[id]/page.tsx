import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintDoc } from "@/components/crm/print-doc";
import { PrintToolbar } from "@/components/crm/print-toolbar";
import { requireUser } from "@/server/auth";
import { getQuotationForUser, getSeller } from "@/server/documents";

export async function generateMetadata({ params }: PageProps<"/print/quotations/[id]">): Promise<Metadata> {
  const { id } = await params;
  const q = await getQuotationForUser(await requireUser(), id);
  // 标题会成为「另存为 PDF」的默认文件名
  return { title: { absolute: q ? `Quotation ${q.no} - ${q.buyerName}` : "Quotation" } };
}

export default async function PrintQuotationPage({ params }: PageProps<"/print/quotations/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const [q, seller] = await Promise.all([getQuotationForUser(user, id), getSeller(user.tenantId)]);
  if (!q) notFound();
  return (
    <>
      <PrintToolbar backHref={`/quotations/${id}`} hint="单据抬头和银行信息在「设置 → 单据设置」里维护" />
      <PrintDoc
        tz={user.timezone}
        seller={seller}
        doc={{
          kind: "quotation",
          no: q.no,
          title: q.title,
          date: q.quoteDate,
          date2: q.validUntil,
          buyerName: q.buyerName,
          buyerContact: q.buyerContact,
          buyerEmail: q.buyerEmail,
          buyerPhone: q.buyerPhone,
          buyerAddress: q.buyerAddress,
          currency: q.currency,
          tradeTerm: q.tradeTerm,
          port: q.port,
          paymentTerm: q.paymentTerm,
          deliveryTime: q.deliveryTime,
          subtotal: q.subtotal.toString(),
          discount: q.discount.toString(),
          shippingFee: q.shippingFee.toString(),
          otherFee: q.otherFee.toString(),
          total: q.total.toString(),
          terms: q.terms,
          salesName: q.owner?.name ?? null,
          items: q.items.map((i) => ({
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
