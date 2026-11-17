import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { approvalRules } from "@/server/approvals";
import { ApprovalRulesForm } from "./approval-rules-form";

export const metadata: Metadata = { title: "审批规则" };

export default async function ApprovalRulesPage() {
  const user = await requirePermission("settings.business");
  const r = await approvalRules(user.tenantId);
  return (
    <>
      <PageHeader title="审批规则" description="哪些操作要先经过上级审批。提交的申请在左侧「审批」里处理。" />
      <ApprovalRulesForm
        defaults={{ approvalDiscountPct: r.discountPct, approvalRelease: r.release, approvalDelete: r.del, approvalTransfer: r.transfer }}
      />
    </>
  );
}
