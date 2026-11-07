import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "WhatsApp" };

export default async function Page() {
  await requirePermission("mail.use");
  return (
    <PlannedModule
      title={"WhatsApp"}
      phase="P4"
      features={["WhatsApp Business 接入", "聊天记录归档到客户"]}
    />
  );
}
