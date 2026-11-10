import "server-only";
import { randomBytes } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { prisma } from "@/server/db";
import { archiveMail } from "@/server/mail/archive";
import { configOf, friendlyError, imapClient, smtpAutoSavesSent, smtpTransport } from "@/server/mail/client";
import { makeSnippet, saveAttachment, textToHtml, type MailAddress, type MailAttachmentMeta } from "@/server/mail/store";
import { decorateHtml, newTrackId } from "@/server/mail/track";

export type OutgoingMail = {
  accountId: string;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  text: string;
  files: { filename: string; contentType: string; content: Buffer }[];
  inReplyTo?: string | null;
  references?: string[];
  /** 追踪打开和点击（默认开） */
  track?: boolean;
  /** 群发 / 序列发出的：带退订链接，并记到这个收件人名下 */
  enrollmentId?: string;
};

export async function sendMail(m: OutgoingMail): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const account = await prisma.mailAccount.findUniqueOrThrow({ where: { id: m.accountId }, include: { user: { select: { name: true } } } });
  const cfg = configOf(account);
  const domain = account.email.split("@")[1] ?? "localhost";
  const messageId = `<${Date.now().toString(36)}.${randomBytes(8).toString("hex")}@${domain}>`;
  const body = account.signature ? `${m.text}\n\n--\n${account.signature}` : m.text;
  const fromName = account.displayName || account.user.name;
  // 只发给一个收件人时才追踪：多人时分不清是谁打开的
  const trackId = m.track !== false && m.to.length + m.cc.length + m.bcc.length === 1 ? newTrackId() : null;
  const plainHtml = textToHtml(body);
  const html = trackId ? decorateHtml(plainHtml, trackId, { unsubscribe: !!m.enrollmentId }) : plainHtml;

  const composer = new MailComposer({
    from: { name: fromName, address: account.email },
    to: m.to.map((a) => ({ name: a.name ?? "", address: a.address })),
    cc: m.cc.map((a) => ({ name: a.name ?? "", address: a.address })),
    bcc: m.bcc.map((a) => ({ name: a.name ?? "", address: a.address })),
    subject: m.subject,
    text: body,
    html,
    messageId,
    inReplyTo: m.inReplyTo ?? undefined,
    references: m.references?.length ? m.references : undefined,
    attachments: m.files.map((f) => ({ filename: f.filename, content: f.content, contentType: f.contentType })),
  });
  const raw = await composer.compile().build();

  try {
    await smtpTransport(cfg).sendMail({
      envelope: { from: account.email, to: [...m.to, ...m.cc, ...m.bcc].map((a) => a.address) },
      raw,
    });
  } catch (e) {
    return { ok: false, error: `发送失败：${friendlyError(e)}` };
  }

  // 存一份到「已发送」（Gmail / Office365 会自动存，不重复存）
  if (!smtpAutoSavesSent(account.smtpHost)) {
    const client = imapClient(cfg);
    client.on("error", () => {});
    try {
      await client.connect();
      const boxes = await client.list();
      const sent = boxes.find((b) => b.specialUse === "\\Sent") ?? boxes.find((b) => /^(sent|sent items|sent messages|已发送)$/i.test(b.name));
      if (sent) await client.append(sent.path, raw, ["\\Seen"]);
      await client.logout();
    } catch {
      client.close();
    }
  }

  const attachments: MailAttachmentMeta[] = [];
  for (const f of m.files) attachments.push(await saveAttachment(account.tenantId, f));
  const date = new Date();
  const snippet = makeSnippet(m.text);
  const linked = await archiveMail({
    tenantId: account.tenantId,
    accountId: account.id,
    userId: account.userId,
    ownAddress: account.email,
    autoLead: false,
    direction: "out",
    from: { name: fromName, address: account.email },
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    snippet,
    date,
  });
  const row = await prisma.mailMessage.create({
    data: {
      tenantId: account.tenantId,
      accountId: account.id,
      folder: "SENT",
      messageId,
      inReplyTo: m.inReplyTo ?? null,
      references: m.references ?? [],
      fromAddr: account.email,
      fromName,
      toList: m.to,
      ccList: m.cc,
      subject: m.subject,
      text: body,
      html,
      snippet,
      trackId,
      enrollmentId: m.enrollmentId ?? null,
      date,
      seen: true,
      attachments,
      ...linked,
    },
  });
  return { ok: true, id: row.id };
}
