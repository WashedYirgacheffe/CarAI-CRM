import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "邮箱绑定" };

export default async function Page() {
  await requirePermission("mail.use");
  return (
    <PlannedModule
      title={"邮箱绑定"}
      phase="P3"
      features={["绑定个人工作邮箱"]}
    />
  );
}
