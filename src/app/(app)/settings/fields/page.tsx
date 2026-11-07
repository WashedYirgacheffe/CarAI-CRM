import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "客户字段" };

export default async function Page() {
  await requirePermission("settings.business");
  return (
    <PlannedModule
      title={"客户字段"}
      phase="P1"
      features={["自定义客户字段"]}
    />
  );
}
