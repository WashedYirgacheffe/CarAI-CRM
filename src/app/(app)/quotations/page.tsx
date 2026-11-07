import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "报价单" };

export default async function Page() {
  await requirePermission("quotation.view");
  return (
    <PlannedModule
      title={"报价单"}
      phase="P2"
      features={["多币种报价单", "导出 PDF / PI", "报价转订单"]}
    />
  );
}
