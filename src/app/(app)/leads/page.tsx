import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "线索 / 询盘" };

export default async function Page() {
  await requirePermission("lead.view");
  return (
    <PlannedModule
      title={"线索 / 询盘"}
      phase="P1"
      features={["询盘线索池", "自动查重与分配", "转化为客户和商机"]}
    />
  );
}
