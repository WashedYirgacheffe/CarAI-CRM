import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { DocSettingsForm, RatesForm } from "./forms";

export const metadata: Metadata = { title: "单据设置" };

export default async function DocumentSettingsPage() {
  const user = await requirePermission("settings.business");
  const [t, rates] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    tenantDb(user.tenantId).exchangeRate.findMany(),
  ]);
  return (
    <>
      <PageHeader title="单据设置" description="报价单和 PI 的抬头、银行信息、默认条款，以及多币种折算用的汇率。" />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <DocSettingsForm
          defaults={{
            name: t.name,
            docCompanyName: t.docCompanyName ?? "",
            docAddress: t.docAddress ?? "",
            docPhone: t.docPhone ?? "",
            docEmail: t.docEmail ?? "",
            docWebsite: t.docWebsite ?? "",
            docBankInfo: t.docBankInfo ?? "",
            docQuotationTerms: t.docQuotationTerms ?? "",
            quotationValidDays: t.quotationValidDays,
          }}
        />
        <RatesForm
          rates={Object.fromEntries(rates.map((r) => [r.currency, Number(r.rate)]))}
          updatedAt={rates.reduce<string | null>((m, r) => (!m || r.updatedAt.toISOString() > m ? r.updatedAt.toISOString() : m), null)}
          tz={user.timezone}
        />
      </div>
    </>
  );
}
