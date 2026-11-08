import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { DocEditor } from "@/components/crm/doc-editor";
import { can, requireUser } from "@/server/auth";
import { docEditorData, getQuotationForUser, serializeItems, withCurrentCustomer } from "@/server/documents";
import { toLocalInput } from "@/lib/crm";
import { saveQuotationAction } from "../../actions";

export const metadata: Metadata = { title: "编辑报价单" };

export default async function EditQuotationPage({ params }: PageProps<"/quotations/[id]/edit">) {
  const { id } = await params;
  const user = await requireUser();
  const q = await getQuotationForUser(user, id);
  if (!q) notFound();
  if (!can(user, "quotation.edit")) redirect(`/quotations/${id}`);
  const data = await docEditorData(user);
  const tz = user.timezone;
  const customers = withCurrentCustomer(data.customers, q.customer, q.opportunity);

  return (
    <>
      <PageHeader title={`编辑报价单 ${q.no}`} />
      <DocEditor
        kind="quotation"
        action={saveQuotationAction}
        cancelHref={`/quotations/${id}`}
        customers={customers}
        products={data.products}
        rates={data.rates}
        initial={{
          id: q.id,
          customerId: q.customerId,
          opportunityId: q.opportunityId,
          buyerName: q.buyerName,
          buyerContact: q.buyerContact,
          buyerEmail: q.buyerEmail,
          buyerPhone: q.buyerPhone,
          buyerAddress: q.buyerAddress,
          currency: q.currency,
          date: toLocalInput(q.quoteDate, tz, false),
          date2: toLocalInput(q.validUntil, tz, false),
          tradeTerm: q.tradeTerm,
          port: q.port,
          paymentTerm: q.paymentTerm,
          deliveryTime: q.deliveryTime,
          title: q.title,
          discount: Number(q.discount),
          shippingFee: Number(q.shippingFee),
          otherFee: Number(q.otherFee),
          terms: q.terms,
          remark: q.remark,
          items: serializeItems(q.items),
        }}
      />
    </>
  );
}
