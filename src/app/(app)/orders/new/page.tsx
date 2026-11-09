import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DocEditor, type DocInitial } from "@/components/crm/doc-editor";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { docEditorData, getQuotationForUser, serializeItems, withCurrentCustomer } from "@/server/documents";
import { dateInput } from "@/lib/docs";
import { saveOrderAction } from "../actions";

export const metadata: Metadata = { title: "新建订单" };

export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const user = await requirePermission("order.create");
  const sp = await searchParams;
  const param = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const [data, tenant] = await Promise.all([
    docEditorData(user),
    prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
  ]);
  const tz = user.timezone;
  const q = param("quotationId") ? await getQuotationForUser(user, param("quotationId")) : null;

  let initial: DocInitial;
  let customers = data.customers;
  if (q) {
    // 报价转订单：带入报价单的全部内容
    customers = withCurrentCustomer(data.customers, q.customer, q.opportunity);
    initial = {
      customerId: q.customerId,
      opportunityId: q.opportunityId,
      quotationId: q.id,
      buyerName: q.buyerName,
      buyerContact: q.buyerContact,
      buyerEmail: q.buyerEmail,
      buyerPhone: q.buyerPhone,
      buyerAddress: q.buyerAddress,
      currency: q.currency,
      date: dateInput(tz),
      tradeTerm: q.tradeTerm,
      port: q.port,
      paymentTerm: q.paymentTerm,
      discount: Number(q.discount),
      shippingFee: Number(q.shippingFee),
      otherFee: Number(q.otherFee),
      terms: q.terms,
      items: serializeItems(q.items),
    };
  } else {
    const c = data.customers.find((x) => x.id === param("customerId"));
    const contact = c?.contacts[0];
    initial = {
      customerId: c?.id,
      opportunityId: c?.opportunities.some((o) => o.id === param("opportunityId")) ? param("opportunityId") : null,
      buyerName: c?.name,
      buyerContact: contact?.name,
      buyerEmail: contact?.email,
      buyerPhone: contact?.phone,
      buyerAddress: c?.address,
      currency: tenant.defaultCurrency,
      date: dateInput(tz),
      tradeTerm: "FOB",
      terms: tenant.docQuotationTerms,
      items: [],
    };
  }

  return (
    <>
      <PageHeader
        title="新建订单"
        description={q ? `由报价单 ${q.no} 转入，保存后报价单会标记为「已转订单」` : "保存后可打印 PI（形式发票）发给客户确认"}
      />
      <DocEditor
        kind="order"
        action={saveOrderAction}
        cancelHref={q ? `/quotations/${q.id}` : initial.customerId ? `/customers/${initial.customerId}` : "/orders"}
        customers={customers}
        products={data.products}
        rates={data.rates}
        initial={initial}
      />
    </>
  );
}
