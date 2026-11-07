import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "我的客户" };

export default async function Page() {
  await requirePermission("customer.view");
  return (
    <PlannedModule
      title={"我的客户"}
      phase="P1"
      features={["客户列表：按状态、分组、星级、标签、国家筛选", "客户详情：动态时间线 + 相关商机/日程/单据", "查重防撞单、转移客户"]}
    />
  );
}
