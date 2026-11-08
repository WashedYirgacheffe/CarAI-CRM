import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DocEditor } from "@/components/crm/doc-editor";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { docEditorData } from "@/server/documents";
import { dateInput } from "@/lib/docs";
import { saveQuotationAction } from "../actions";

export const metadata: Metadata = { title: "新建报价单" };

export default async function NewQuotationPage({ searchParams }: PageProps<"/quotations/new">) {
  const user = await requirePermission("quotation.create");
  const sp = await searchParams;
  const want = typeof sp.customerId === "string" ? sp.customerId : "";
  const oppId = typeof sp.opportunityId === "string" ? sp.opportunityId : "";
  const [data, tenant] = await Promise.all([
    docEditorData(user),
    prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
  ]);
  const c = data.customers.find((x) => x.id === want);
  const contact = c?.contacts[0];
  const tz = user.timezone;

  return (
    <>
      <PageHeader title="新建报价单" description="单号保存后自动生成；明细是快照，之后改产品资料不影响这张单。" />
      <DocEditor
        kind="quotation"
        action={saveQuotationAction}
        cancelHref={c ? `/customers/${c.id}` : "/quotations"}
        customers={data.customers}
        products={data.products}
        rates={data.rates}
        initial={{
          customerId: c?.id,
          opportunityId: c?.opportunities.some((o) => o.id === oppId) ? oppId : null,
          buyerName: c?.name,
          buyerContact: contact?.name,
          buyerEmail: contact?.email,
          buyerPhone: contact?.phone,
          buyerAddress: c?.address,
          currency: tenant.defaultCurrency,
          date: dateInput(tz),
          date2: tenant.quotationValidDays ? dateInput(tz, tenant.quotationValidDays) : "",
          tradeTerm: "FOB",
          terms: tenant.docQuotationTerms,
          items: [],
        }}
      />
    </>
  );
}
