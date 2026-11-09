import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "企业信息" };

export default async function CompanyPage() {
  const user = await requirePermission("settings.company");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  return (
    <>
      <PageHeader title="企业信息" description="企业名称会显示在顶栏和单据抬头上。" />
      <CompanyForm
        defaults={{ name: tenant.name, defaultCurrency: tenant.defaultCurrency, timezone: tenant.timezone }}
      />
    </>
  );
}
