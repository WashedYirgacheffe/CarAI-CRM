import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "统计" };

export default async function Page() {
  await requirePermission("report.view");
  return (
    <PlannedModule
      title={"统计"}
      phase="P4"
      features={["询盘数、报价数、成交额", "渠道转化率", "团队业绩"]}
    />
  );
}
