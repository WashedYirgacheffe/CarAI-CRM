import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "公海规则" };

export default async function Page() {
  await requirePermission("settings.business");
  return (
    <PlannedModule
      title={"公海规则"}
      phase="P1"
      features={["N 天未跟进自动回收", "领取上限"]}
    />
  );
}
