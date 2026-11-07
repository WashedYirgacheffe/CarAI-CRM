import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "商机" };

export default async function Page() {
  await requirePermission("opportunity.view");
  return (
    <PlannedModule
      title={"商机"}
      phase="P1"
      features={["商机阶段看板", "金额、币种、预计成交日期", "阶段可自定义"]}
    />
  );
}
