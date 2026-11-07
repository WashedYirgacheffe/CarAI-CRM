import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "邮件" };

export default async function Page() {
  await requirePermission("mail.use");
  return (
    <PlannedModule
      title={"邮件"}
      phase="P3"
      features={["IMAP/SMTP 绑定邮箱", "收发同步，往来邮件自动建档", "邮件归档到客户动态"]}
    />
  );
}
