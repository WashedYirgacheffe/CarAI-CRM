import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { SEQUENCE_PRESETS } from "@/lib/sequences";
import { SequenceEditor } from "../sequence-editor";

export const metadata: Metadata = { title: "新建营销序列" };

export default async function NewSequencePage({ searchParams }: PageProps<"/marketing/new">) {
  const user = await requirePermission("mail.use");
  const accounts = await tenantDb(user.tenantId).mailAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, displayName: true },
  });
  if (!accounts.length) redirect("/settings/mailboxes");
  const sp = await searchParams;
  const preset = SEQUENCE_PRESETS.find((p) => p.key === sp.preset) ?? SEQUENCE_PRESETS[0];
  return (
    <>
      <PageHeader title="新建营销序列" description="写好每封邮件和间隔天数，保存后再选择收件人" />
      <SequenceEditor
        accounts={accounts}
        senderName={accounts[0].displayName || user.name}
        sequence={{
          name: sp.preset ? preset.name : "",
          accountId: accounts[0].id,
          dailyLimit: 100,
          workHours: true,
          stopOnReply: true,
          steps: preset.steps,
        }}
      />
    </>
  );
}
