import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { can, requirePermission } from "@/server/auth";
import { findDuplicateGroups } from "@/server/duplicates";
import { DuplicateList } from "./duplicate-list";

export const metadata: Metadata = { title: "查重合并" };

export default async function DuplicatesPage() {
  const user = await requirePermission("customer.view");
  const groups = await findDuplicateGroups(user);
  return (
    <>
      <PageHeader
        title="查重合并"
        description="官网域名、联系人邮箱或电话 / WhatsApp 相同的客户可能是同一家公司。选一个保留，其余合并进去。"
      />
      <DuplicateList groups={groups} tz={user.timezone} canMerge={can(user, "customer.delete")} />
    </>
  );
}
