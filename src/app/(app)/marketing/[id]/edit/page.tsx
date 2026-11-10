import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { inScope } from "@/server/scope";
import { SequenceEditor } from "../../sequence-editor";

export const metadata: Metadata = { title: "编辑营销序列" };

export default async function EditSequencePage({ params }: PageProps<"/marketing/[id]/edit">) {
  const user = await requirePermission("mail.use");
  const { id } = await params;
  const db = tenantDb(user.tenantId);
  const seq = await db.mailSequence.findFirst({ where: { id }, include: { steps: { orderBy: { sort: "asc" } } } });
  if (!seq || !(await inScope(user, seq.ownerId))) notFound();
  const accounts = await db.mailAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, displayName: true },
  });
  // 别人的序列（主管查看下属）发件邮箱不在自己名下，也列出来
  if (!accounts.some((a) => a.id === seq.accountId)) {
    const a = await db.mailAccount.findFirst({ where: { id: seq.accountId }, select: { id: true, email: true, displayName: true } });
    if (a) accounts.unshift(a);
  }
  return (
    <>
      <PageHeader title="编辑营销序列" description="修改后，进行中的收件人按新内容继续发送后续邮件" />
      <SequenceEditor
        accounts={accounts}
        senderName={accounts.find((a) => a.id === seq.accountId)?.displayName || user.name}
        sequence={{
          id: seq.id,
          name: seq.name,
          accountId: seq.accountId,
          dailyLimit: seq.dailyLimit,
          workHours: seq.workHours,
          stopOnReply: seq.stopOnReply,
          steps: seq.steps.map((s) => ({ delayDays: s.delayDays, subject: s.subject, body: s.body })),
        }}
      />
    </>
  );
}
