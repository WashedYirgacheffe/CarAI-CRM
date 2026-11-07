import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "联系人" };

export default async function Page() {
  await requirePermission("customer.view");
  return (
    <PlannedModule
      title={"联系人"}
      phase="P1"
      features={["联系人列表与详情", "按邮箱/电话查重"]}
    />
  );
}
