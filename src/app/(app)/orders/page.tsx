import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "订单" };

export default async function Page() {
  await requirePermission("order.view");
  return (
    <PlannedModule
      title={"订单"}
      phase="P2"
      features={["订单管理", "汇率设置"]}
    />
  );
}
