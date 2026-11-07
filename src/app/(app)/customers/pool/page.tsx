import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "公海客户" };

export default async function Page() {
  await requirePermission("pool.view");
  return (
    <PlannedModule
      title={"公海客户"}
      phase="P1"
      features={["超期未跟进客户自动回收", "领取与分配，领取上限", "公海分组"]}
    />
  );
}
