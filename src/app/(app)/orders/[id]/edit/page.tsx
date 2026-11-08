import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { DocEditor } from "@/components/crm/doc-editor";
import { can, requireUser } from "@/server/auth";
import { docEditorData, getOrderForUser, serializeItems, withCurrentCustomer } from "@/server/documents";
import { toLocalInput } from "@/lib/crm";
import { saveOrderAction } from "../../actions";

export const metadata: Metadata = { title: "编辑订单" };

export default async function EditOrderPage({ params }: PageProps<"/orders/[id]/edit">) {
  const { id } = await params;
  const user = await requireUser();
  const o = await getOrderForUser(user, id);
  if (!o) notFound();
  if (!can(user, "order.edit")) redirect(`/orders/${id}`);
  const data = await docEditorData(user);
  const tz = user.timezone;

  return (
    <>
      <PageHeader title={`编辑订单 ${o.no}`} />
      <DocEditor
        kind="order"
        action={saveOrderAction}
        cancelHref={`/orders/${id}`}
        customers={withCurrentCustomer(data.customers, o.customer, o.opportunity)}
        products={data.products}
        rates={data.rates}
        initial={{
          id: o.id,
          customerId: o.customerId,
          opportunityId: o.opportunityId,
          buyerName: o.buyerName,
          buyerContact: o.buyerContact,
          buyerEmail: o.buyerEmail,
          buyerPhone: o.buyerPhone,
          buyerAddress: o.buyerAddress,
          currency: o.currency,
          date: toLocalInput(o.orderDate, tz, false),
          date2: toLocalInput(o.deliveryDate, tz, false),
          tradeTerm: o.tradeTerm,
          port: o.port,
          paymentTerm: o.paymentTerm,
          shippingMark: o.shippingMark,
          discount: Number(o.discount),
          shippingFee: Number(o.shippingFee),
          otherFee: Number(o.otherFee),
          terms: o.terms,
          remark: o.remark,
          items: serializeItems(o.items),
        }}
      />
    </>
  );
}
