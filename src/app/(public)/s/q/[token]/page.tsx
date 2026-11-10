import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintDoc } from "@/components/crm/print-doc";
import { prisma } from "@/server/db";
import { getSeller } from "@/server/documents";
import { publicImageUrl, readShareToken } from "@/server/share";
import { logActivity } from "@/server/customers";
import { PublicPrintBar } from "../../public-bits";

export const dynamic = "force-dynamic";

async function load(token: string) {
  const id = readShareToken("q", token);
  if (!id) return null;
  return prisma.quotation.findUnique({
    where: { id },
    include: { items: { orderBy: { sort: "asc" } }, owner: { select: { name: true } }, tenant: { select: { timezone: true } } },
  });
}

export async function generateMetadata({ params }: PageProps<"/s/q/[token]">): Promise<Metadata> {
  const q = await load((await params).token);
  return { title: { absolute: q ? `Quotation ${q.no} - ${q.buyerName}` : "Quotation" }, robots: { index: false } };
}

/** 客户在线查看报价单（WhatsApp 里发出去的链接），可直接打印 / 另存 PDF */
export default async function SharedQuotationPage({ params }: PageProps<"/s/q/[token]">) {
  const q = await load((await params).token);
  if (!q) notFound();
  const seller = await getSeller(q.tenantId);

  // 客户打开了报价单：记一条动态（6 小时内只记一次），业务员能在客户动态里看到
  const recent = await prisma.activity.findFirst({
    where: { tenantId: q.tenantId, customerId: q.customerId, event: "quote_viewed", createdAt: { gt: hoursAgo(6) } },
    select: { id: true },
  });
  if (!recent) await logActivity({ tenantId: q.tenantId, customerId: q.customerId, event: "quote_viewed", content: `客户在线查看了报价单 ${q.no}` });

  return (
    <>
      <PublicPrintBar label="Print / Save as PDF" />
      <PrintDoc
        tz={q.tenant.timezone}
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
            imageUrl: publicImageUrl(i.imageUrl),
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

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3600_000);
}
