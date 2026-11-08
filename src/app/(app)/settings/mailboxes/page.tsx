import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { MAIL_PRESETS } from "@/server/mail/client";
import { MailboxManager } from "./mailbox-manager";

export const metadata: Metadata = { title: "邮箱绑定" };

export default async function Page() {
  const user = await requirePermission("mail.use");
  const accounts = await tenantDb(user.tenantId).mailAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const counts = await tenantDb(user.tenantId).mailMessage.groupBy({
    by: ["accountId"],
    where: { accountId: { in: accounts.map((a) => a.id) } },
    _count: true,
  });
  const n = new Map(counts.map((c) => [c.accountId, c._count]));
  return (
    <>
      <PageHeader
        title="邮箱绑定"
        description="绑定你的工作邮箱后，收件箱和已发送会每隔几分钟自动同步；和客户的往来邮件自动归档到客户动态，陌生询盘自动建成线索。"
      />
      <MailboxManager
        tz={user.timezone}
        presets={MAIL_PRESETS}
        accounts={accounts.map((a) => ({
          id: a.id,
          email: a.email,
          displayName: a.displayName,
          username: a.username,
          imapHost: a.imapHost,
          imapPort: a.imapPort,
          imapSecure: a.imapSecure,
          smtpHost: a.smtpHost,
          smtpPort: a.smtpPort,
          smtpSecure: a.smtpSecure,
          signature: a.signature,
          autoLead: a.autoLead,
          status: a.status,
          lastError: a.lastError,
          lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
          count: n.get(a.id) ?? 0,
        }))}
      />
    </>
  );
}
