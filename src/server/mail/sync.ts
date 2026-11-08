import "server-only";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { prisma } from "@/server/db";
import { archiveMail } from "@/server/mail/archive";
import { configOf, friendlyError, imapClient } from "@/server/mail/client";
import {
  MAX_ATTACHMENT_BYTES,
  htmlToText,
  makeSnippet,
  saveAttachment,
  type MailAddress,
  type MailAttachmentMeta,
} from "@/server/mail/store";
import type { MailFolder } from "@/generated/prisma/client";

/** 首次同步只拉最近 N 天、最多 M 封，避免老邮箱一次拉几万封 */
const FIRST_SYNC_DAYS = 30;
const FIRST_SYNC_MAX = 300;
/** 每次增量同步每个文件夹最多处理的邮件数，剩下的下一轮继续 */
const BATCH_MAX = 200;
const LOCK_MS = 10 * 60_000;

type FolderState = { uidValidity: string; lastUid: number };
type SyncState = Record<string, FolderState>;

export type SyncResult = { ok: boolean; added: number; error?: string; skipped?: boolean };

function addresses(v: AddressObject | AddressObject[] | undefined): MailAddress[] {
  if (!v) return [];
  const list = Array.isArray(v) ? v : [v];
  return list
    .flatMap((o) => o.value)
    .filter((a) => a.address)
    .map((a) => ({ name: a.name || null, address: a.address!.toLowerCase() }));
}

function isAutomated(p: ParsedMail) {
  const h = p.headers;
  const auto = String(h.get("auto-submitted") ?? "");
  return (
    h.has("list-unsubscribe") ||
    h.has("list-id") ||
    (auto !== "" && auto !== "no") ||
    /bulk|list|junk/i.test(String(h.get("precedence") ?? ""))
  );
}

/** 同步一个邮箱的收件箱和已发送。会抢占租约，正在同步时直接返回 skipped。 */
export async function syncMailAccount(accountId: string): Promise<SyncResult> {
  const now = new Date();
  const { count } = await prisma.mailAccount.updateMany({
    where: { id: accountId, status: { not: "PAUSED" }, OR: [{ syncLockUntil: null }, { syncLockUntil: { lt: now } }] },
    data: { syncLockUntil: new Date(now.getTime() + LOCK_MS) },
  });
  if (!count) return { ok: true, added: 0, skipped: true };

  const account = await prisma.mailAccount.findUniqueOrThrow({ where: { id: accountId } });
  const state = { ...((account.syncState ?? {}) as SyncState) };
  let added = 0;
  let client: ReturnType<typeof imapClient> | null = null;
  try {
    client = imapClient(configOf(account));
    client.on("error", () => {});
    await client.connect();
    const boxes = await client.list();
    const sent =
      boxes.find((b) => b.specialUse === "\\Sent") ??
      boxes.find((b) => /^(sent|sent items|sent messages|已发送|已发送邮件)$/i.test(b.name));
    const folders: [string, MailFolder][] = [["INBOX", "INBOX"]];
    if (sent) folders.push([sent.path, "SENT"]);

    for (const [path, folder] of folders) {
      added += await syncFolder(client, account, path, folder, state);
      await prisma.mailAccount.update({ where: { id: accountId }, data: { syncState: state } });
    }
    await client.logout().catch(() => {});
    await prisma.mailAccount.update({
      where: { id: accountId },
      data: { status: "ACTIVE", lastError: null, lastSyncAt: new Date(), syncLockUntil: null },
    });
    return { ok: true, added };
  } catch (e) {
    client?.close();
    const error = friendlyError(e);
    await prisma.mailAccount.update({
      where: { id: accountId },
      data: { status: "ERROR", lastError: error, lastSyncAt: new Date(), syncLockUntil: null, syncState: state },
    });
    return { ok: false, added, error };
  }
}

type Account = Awaited<ReturnType<typeof prisma.mailAccount.findUniqueOrThrow>>;

async function syncFolder(
  client: ReturnType<typeof imapClient>,
  account: Account,
  path: string,
  folder: MailFolder,
  state: SyncState,
) {
  const lock = await client.getMailboxLock(path);
  try {
    const mailbox = client.mailbox;
    if (!mailbox) return 0;
    const validity = String(mailbox.uidValidity);
    const prev = state[path];
    let uids: number[];
    if (!prev || prev.uidValidity !== validity) {
      const since = new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
      const found = (await client.search({ since }, { uid: true })) || [];
      uids = found.sort((a, b) => a - b).slice(-FIRST_SYNC_MAX);
      state[path] = { uidValidity: validity, lastUid: uids.length ? uids[0] - 1 : Number(mailbox.uidNext ?? 1) - 1 };
    } else {
      if (mailbox.exists === 0) return 0;
      const found = (await client.search({ uid: `${prev.lastUid + 1}:*` }, { uid: true })) || [];
      uids = found.filter((u) => u > prev.lastUid).sort((a, b) => a - b);
    }
    uids = uids.slice(0, BATCH_MAX);
    if (!uids.length) return 0;

    // 先拿大小和标记，过大的邮件只存信封
    const meta = new Map<number, { size: number; seen: boolean; date?: Date }>();
    for await (const msg of client.fetch(uids.join(","), { uid: true, size: true, flags: true, internalDate: true }, { uid: true })) {
      meta.set(msg.uid, {
        size: msg.size ?? 0,
        seen: msg.flags?.has("\\Seen") ?? false,
        date: msg.internalDate ? new Date(msg.internalDate) : undefined,
      });
    }

    let added = 0;
    for (const uid of uids) {
      const m = meta.get(uid);
      if (!m) continue;
      const exists = await prisma.mailMessage.findFirst({ where: { accountId: account.id, folderPath: path, uid }, select: { id: true } });
      if (!exists) {
        const msg = await client.fetchOne(String(uid), m.size > 40 * 1024 * 1024 ? { uid: true, envelope: true } : { uid: true, source: true }, { uid: true });
        if (msg) {
          const ok = await storeMessage(account, path, folder, uid, m, msg.source ?? null, msg.envelope ?? null);
          if (ok) added++;
        }
      }
      state[path].lastUid = uid;
    }
    return added;
  } finally {
    lock.release();
  }
}

async function storeMessage(
  account: Account,
  path: string,
  folder: MailFolder,
  uid: number,
  meta: { seen: boolean; date?: Date },
  source: Buffer | null,
  envelope: { subject?: string; from?: { name?: string; address?: string }[]; messageId?: string } | null,
) {
  let parsed: ParsedMail | null = null;
  if (source) {
    try {
      parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
    } catch {
      parsed = null;
    }
  }
  const from = parsed ? addresses(parsed.from)[0] : envelope?.from?.[0]?.address ? { name: envelope.from[0].name ?? null, address: envelope.from[0].address.toLowerCase() } : undefined;
  const messageId = parsed?.messageId ?? envelope?.messageId ?? null;

  // 本系统发出的邮件：已经存过一份（folderPath 为空），这里只补上 IMAP 位置
  if (messageId) {
    const local = await prisma.mailMessage.findFirst({ where: { accountId: account.id, messageId, folder } });
    if (local) {
      if (!local.folderPath) await prisma.mailMessage.update({ where: { id: local.id }, data: { folderPath: path, uid } });
      return false;
    }
  }

  const to = parsed ? addresses(parsed.to) : [];
  const cc = parsed ? addresses(parsed.cc) : [];
  const html = parsed?.html || null;
  const text = parsed?.text || (html ? htmlToText(html) : null);
  const subject = (parsed?.subject ?? envelope?.subject ?? "").slice(0, 500);
  const date = parsed?.date ?? meta.date ?? new Date();

  const attachments: MailAttachmentMeta[] = [];
  for (const a of parsed?.attachments ?? []) {
    if (a.related || a.size > MAX_ATTACHMENT_BYTES) continue;
    attachments.push(await saveAttachment(account.tenantId, { filename: a.filename, contentType: a.contentType, content: a.content }));
  }

  const snippet = makeSnippet(text);
  const fromAddr = from ?? { name: null, address: "unknown" };
  const direction = folder === "SENT" ? "out" : "in";
  const linked = await archiveMail({
    tenantId: account.tenantId,
    accountId: account.id,
    userId: account.userId,
    ownAddress: account.email,
    autoLead: account.autoLead,
    direction,
    from: fromAddr,
    to,
    cc,
    subject,
    snippet,
    date,
    automated: parsed ? isAutomated(parsed) : true,
  });

  const refs = parsed?.references;
  await prisma.mailMessage.create({
    data: {
      tenantId: account.tenantId,
      accountId: account.id,
      folder,
      folderPath: path,
      uid,
      messageId,
      inReplyTo: parsed?.inReplyTo ?? null,
      references: Array.isArray(refs) ? refs : refs ? [refs] : [],
      fromAddr: fromAddr.address,
      fromName: fromAddr.name ?? null,
      toList: to,
      ccList: cc,
      subject,
      text: text?.slice(0, 200_000) ?? null,
      html: html ? html.slice(0, 1_000_000) : null,
      snippet,
      date,
      seen: folder === "SENT" ? true : meta.seen,
      attachments,
      ...linked,
    },
  });
  return true;
}

/** 在服务器上标记已读（失败不影响本地） */
export async function markSeenOnServer(accountId: string, path: string, uid: number, seen: boolean) {
  const account = await prisma.mailAccount.findUnique({ where: { id: accountId } });
  if (!account) return;
  const client = imapClient(configOf(account));
  client.on("error", () => {});
  try {
    await client.connect();
    const lock = await client.getMailboxLock(path);
    try {
      if (seen) await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      else await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
    } finally {
      lock.release();
    }
    await client.logout();
  } catch {
    client.close();
  }
}
