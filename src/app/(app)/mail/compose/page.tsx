import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "@/components/icons";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { aiConfigured } from "@/server/ai";
import { asAddresses, asAttachments, formatAddress } from "@/server/mail/store";
import { formatDateTime } from "@/lib/crm";
import { ComposeForm } from "./compose-form";

export const metadata: Metadata = { title: "写邮件" };

function quote(text: string | null) {
  return (text ?? "")
    .split("\n")
    .slice(0, 400)
    .map((l) => `> ${l}`)
    .join("\n");
}

export default async function ComposePage({ searchParams }: PageProps<"/mail/compose">) {
  const user = await requirePermission("mail.use");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const db = tenantDb(user.tenantId);
  const accounts = await db.mailAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, email: true } });

  const sourceId = s("reply") || s("forward");
  const source = sourceId ? await db.mailMessage.findFirst({ where: { id: sourceId, account: { userId: user.id } } }) : null;

  let to = s("to");
  let cc = "";
  let subject = s("subject");
  // AI 起草的正文可以通过 ?body= 带进来
  let text = s("body").slice(0, 20000);
  let accountId = accounts[0]?.id ?? "";
  let original: string | undefined;
  let forwardFiles: string[] = [];

  if (source) {
    accountId = source.accountId;
    const header = `${formatDateTime(source.date, user.timezone)}，${source.fromName || source.fromAddr} 写道：`;
    original = source.text ?? source.snippet;
    if (s("reply")) {
      const own = accounts.find((a) => a.id === source.accountId)?.email;
      const toList = source.folder === "SENT" ? asAddresses(source.toList) : [{ name: source.fromName, address: source.fromAddr }];
      to = toList.map(formatAddress).join(", ");
      if (s("all")) {
        cc = [...asAddresses(source.toList), ...asAddresses(source.ccList)]
          .filter((a) => a.address !== own && !toList.some((t) => t.address === a.address))
          .map(formatAddress)
          .join(", ");
      }
      subject = /^re:/i.test(source.subject) ? source.subject : `Re: ${source.subject}`;
      text = `\n\n\n${header}\n${quote(source.text)}`;
    } else {
      subject = /^fwd?:/i.test(source.subject) ? source.subject : `Fwd: ${source.subject}`;
      text = `\n\n\n---------- 转发的邮件 ----------\n发件人：${formatAddress({ name: source.fromName, address: source.fromAddr })}\n日期：${formatDateTime(source.date, user.timezone)}\n主题：${source.subject}\n收件人：${asAddresses(source.toList).map(formatAddress).join(", ")}\n\n${source.text ?? ""}`;
      forwardFiles = asAttachments(source.attachments).map((a) => a.filename);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/mail" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        邮件
      </Link>
      {accounts.length === 0 ? (
        <p className="surface p-10 text-center text-sm text-muted-foreground">
          请先到{" "}
          <Link href="/settings/mailboxes" className="text-primary underline">
            邮箱绑定
          </Link>{" "}
          绑定发件邮箱。
        </p>
      ) : (
        <ComposeForm
          accounts={accounts}
          canAi={can(user, "ai.use") && aiConfigured()}
          initial={{
            accountId,
            to,
            cc,
            subject,
            text,
            replyToId: s("reply") ? source?.id : undefined,
            forwardId: s("forward") ? source?.id : undefined,
            forwardFiles,
            original: s("reply") ? original : undefined,
          }}
        />
      )}
    </div>
  );
}
