import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "日程" };

export default async function Page() {
  await requirePermission("customer.view");
  return (
    <PlannedModule
      title={"日程"}
      phase="P1"
      features={["跟进任务与提醒", "逾期提醒"]}
    />
  );
}
