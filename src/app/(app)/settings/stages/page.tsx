import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "商机阶段" };

export default async function Page() {
  await requirePermission("settings.business");
  return (
    <PlannedModule
      title={"商机阶段"}
      phase="P1"
      features={["自定义商机阶段与赢率"]}
    />
  );
}
