"use server";

import { syncCustomerTimes } from "@/server/pool";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { testMailConfig } from "@/server/mail/client";
import { sendMail } from "@/server/mail/send";
import { markSeenOnServer, syncMailAccount } from "@/server/mail/sync";
import { MAX_ATTACHMENT_BYTES, asAttachments, readAttachment, type MailAddress } from "@/server/mail/store";
import { AiError, aiConfigured, aiJson, analyzeMail } from "@/server/ai";
import { googleTranslateMany } from "@/server/translate";
import { getCustomerForUser, logActivity } from "@/server/customers";
import { scopeOwnerIds } from "@/server/scope";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { extractDomain } from "@/lib/crm";

const denied = (message = "没有操作权限"): ActionState => ({ ok: false, message });

function revalidateMail() {
  revalidatePath("/mail", "layout");
  revalidatePath("/settings/mailboxes");
}

async function requireMailUser() {
  const user = await requireUser();
  return can(user, "mail.use") ? user : null;
}

async function ownAccount(user: CurrentUser, id: string) {
  return tenantDb(user.tenantId).mailAccount.findFirst({ where: { id, userId: user.id } });
}

async function ownMessage(user: CurrentUser, id: string) {
  return tenantDb(user.tenantId).mailMessage.findFirst({
    where: { id, account: { userId: user.id } },
    include: { account: { select: { id: true, email: true, userId: true } } },
  });
}

// ── 邮箱绑定 ──

const port = z.coerce.number().int().min(1).max(65535);
const accountSchema = z.object({
  id: z.string().optional(),
  email: z.email({ message: "邮箱格式不正确" }).transform((v) => v.trim().toLowerCase()),
  displayName: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || null),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(500).optional(),
  imapHost: z.string().trim().min(3, "请填写收信服务器").max(200),
  imapPort: port,
  imapSecure: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  smtpHost: z.string().trim().min(3, "请填写发信服务器").max(200),
  smtpPort: port,
  smtpSecure: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  signature: z
    .string()
    .max(3000)
    .optional()
    .transform((v) => v?.trim() || null),
  autoLead: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

export async function saveMailAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireMailUser();
  if (!user) return denied();
  const parsed = accountSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, password, username, ...data } = parsed.data;
  const db = tenantDb(user.tenantId);
  const existing = id ? await ownAccount(user, id) : null;
  if (id && !existing) return denied("邮箱不存在");
  if (!existing && !password) return { ok: false, fieldErrors: { password: ["请填写密码或授权码"] } };

  const clash = await db.mailAccount.findFirst({ where: { email: data.email, ...(id ? { NOT: { id } } : {}) } });
  if (clash) return { ok: false, fieldErrors: { email: ["这个邮箱已经被绑定过了"] } };

  let passwordEnc = existing?.passwordEnc ?? "";
  if (password) passwordEnc = encryptSecret(password);
  const login = username || data.email;

  const error = await testMailConfig({ ...data, username: login, password: password || decryptSecret(passwordEnc) });
  if (error) return { ok: false, message: error };

  const row = existing
    ? await prisma.mailAccount.update({
        where: { id: existing.id },
        data: { ...data, username: login, passwordEnc, status: "ACTIVE", lastError: null },
      })
    : await db.mailAccount.create({
        data: { ...data, username: login, passwordEnc, userId: user.id, tenantId: user.tenantId },
      });
  // 新绑定的邮箱立即在后台拉一次
  if (!existing) void syncMailAccount(row.id).then(() => revalidateMail());
  revalidateMail();
  return { ok: true, message: existing ? "已保存" : "绑定成功，正在同步最近 30 天的邮件" };
}

export async function deleteMailAccountAction(id: string): Promise<ActionState> {
  const user = await requireMailUser();
  if (!user) return denied();
  const a = await ownAccount(user, id);
  if (!a) return denied("邮箱不存在");
  await prisma.mailAccount.delete({ where: { id: a.id } });
  revalidateMail();
  return { ok: true, message: "已解除绑定，本地同步的邮件已删除" };
}

export async function toggleMailAccountAction(id: string): Promise<ActionState> {
  const user = await requireMailUser();
  if (!user) return denied();
  const a = await ownAccount(user, id);
  if (!a) return denied("邮箱不存在");
  await prisma.mailAccount.update({ where: { id: a.id }, data: { status: a.status === "PAUSED" ? "ACTIVE" : "PAUSED" } });
  revalidateMail();
  return { ok: true, message: a.status === "PAUSED" ? "已恢复同步" : "已暂停同步" };
}

/** 立即同步当前用户的全部邮箱 */
export async function syncNowAction(): Promise<ActionState> {
  const user = await requireMailUser();
  if (!user) return denied();
  const accounts = await tenantDb(user.tenantId).mailAccount.findMany({ where: { userId: user.id, status: { not: "PAUSED" } } });
  if (!accounts.length) return denied("还没有绑定邮箱");
  const results = await Promise.all(accounts.map((a) => syncMailAccount(a.id)));
  revalidateMail();
  const failed = results.find((r) => !r.ok);
  if (failed) return { ok: false, message: failed.error };
  const added = results.reduce((n, r) => n + r.added, 0);
  if (results.every((r) => r.skipped)) return { ok: true, message: "正在后台同步中，请稍后刷新" };
  return { ok: true, message: added ? `收到 ${added} 封新邮件` : "没有新邮件" };
}

// ── 发信 ──

const addrList = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const parts = (v ?? "")
      .split(/[,;，；\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const out: MailAddress[] = [];
    for (const p of parts) {
      const m = p.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
      const address = (m ? m[2] : p).trim().toLowerCase();
      if (!z.email().safeParse(address).success) {
        ctx.addIssue({ code: "custom", message: `邮箱地址不正确：${p}` });
        return z.NEVER;
      }
      out.push({ name: m?.[1]?.trim() || null, address });
    }
    return out.slice(0, 50);
  });

const sendSchema = z.object({
  accountId: z.string().min(1, "请选择发件邮箱"),
  to: addrList.refine((v) => v.length > 0, "请填写收件人"),
  cc: addrList,
  bcc: addrList,
  subject: z.string().trim().max(500).default(""),
  text: z.string().max(200_000).default(""),
  replyToId: z.string().optional(),
  forwardId: z.string().optional(),
});

export async function sendMailAction(_p: ActionState, fd: FormData): Promise<ActionState & { id?: string }> {
  const user = await requireMailUser();
  if (!user) return denied();
  const parsed = sendSchema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const d = parsed.data;
  if (!d.subject && !d.text.trim()) return denied("主题和正文不能都为空");
  const account = await ownAccount(user, d.accountId);
  if (!account) return denied("发件邮箱不存在");

  const files: { filename: string; contentType: string; content: Buffer }[] = [];
  let total = 0;
  for (const f of fd.getAll("files")) {
    if (!(f instanceof File) || !f.size) continue;
    total += f.size;
    if (total > MAX_ATTACHMENT_BYTES) return denied("附件合计不能超过 25MB");
    files.push({ filename: f.name, contentType: f.type || "application/octet-stream", content: Buffer.from(await f.arrayBuffer()) });
  }

  // 转发：带上原邮件的附件
  if (d.forwardId) {
    const orig = await ownMessage(user, d.forwardId);
    for (const a of orig ? asAttachments(orig.attachments) : []) {
      total += a.size;
      if (total > MAX_ATTACHMENT_BYTES) return denied("附件合计不能超过 25MB");
      files.push({ filename: a.filename, contentType: a.contentType, content: await readAttachment(user.tenantId, a.id) });
    }
  }

  let inReplyTo: string | null = null;
  let references: string[] = [];
  if (d.replyToId) {
    const orig = await tenantDb(user.tenantId).mailMessage.findFirst({ where: { id: d.replyToId } });
    if (orig?.messageId) {
      inReplyTo = orig.messageId;
      references = [...orig.references, orig.messageId].slice(-20);
    }
  }

  const r = await sendMail({ accountId: account.id, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, text: d.text, files, inReplyTo, references });
  if (!r.ok) return denied(r.error);
  revalidateMail();
  revalidatePath("/customers", "layout");
  return { ok: true, message: "邮件已发送", id: r.id };
}

// ── 阅读 ──

export async function setSeenAction(id: string, seen: boolean): Promise<ActionState> {
  const user = await requireMailUser();
  if (!user) return denied();
  const m = await ownMessage(user, id);
  if (!m) return denied("邮件不存在");
  if (m.seen !== seen) {
    await prisma.mailMessage.update({ where: { id: m.id }, data: { seen } });
    if (m.folderPath && m.uid) void markSeenOnServer(m.accountId, m.folderPath, m.uid, seen);
  }
  revalidatePath("/mail", "layout");
  return { ok: true };
}

export async function setStarredAction(id: string, starred: boolean): Promise<ActionState> {
  const user = await requireMailUser();
  if (!user) return denied();
  const m = await ownMessage(user, id);
  if (!m) return denied("邮件不存在");
  await prisma.mailMessage.update({ where: { id: m.id }, data: { starred } });
  revalidatePath("/mail", "layout");
  return { ok: true };
}

/** 待办里「已处理」：不用回复的邮件从待办移走（done=false 撤销） */
export async function setMailDoneAction(id: string, done: boolean): Promise<ActionState> {
  const user = await requireMailUser();
  if (!user) return denied();
  const m = await ownMessage(user, id);
  if (!m) return denied("邮件不存在");
  await prisma.mailMessage.update({ where: { id: m.id }, data: { doneAt: done ? new Date() : null, ...(done ? { seen: true } : {}) } });
  if (done && !m.seen && m.folderPath && m.uid) void markSeenOnServer(m.accountId, m.folderPath, m.uid, true);
  revalidatePath("/todo");
  revalidatePath("/mail", "layout");
  return { ok: true, message: done ? "已处理，已从待办移走" : "已放回待办" };
}

export async function analyzeMailAction(id: string): Promise<ActionState> {
  const user = await requireMailUser();
  if (!user) return denied();
  if (!can(user, "ai.use")) return denied("没有使用 AI 的权限");
  if (!aiConfigured()) return denied("管理员还没有配置 AI 服务");
  const m = await ownMessage(user, id);
  if (!m) return denied("邮件不存在");
  try {
    const r = await analyzeMail({ from: `${m.fromName ?? ""} <${m.fromAddr}>`, subject: m.subject, text: m.text ?? m.snippet });
    await prisma.mailMessage.update({
      where: { id: m.id },
      data: { aiSummary: r.summary, aiIntent: r.intent, aiPriority: r.priority, aiAnalyzedAt: new Date() },
    });
  } catch (e) {
    return denied(e instanceof AiError ? e.message : "AI 分析失败");
  }
  revalidatePath("/mail", "layout");
  return { ok: true, message: "分析完成" };
}

// ── 归档 ──

/** 搜索当前用户能编辑的客户（关联邮件用） */
export async function searchCustomersAction(q: string) {
  const user = await requireUser();
  const scope = await scopeOwnerIds(user);
  const term = q.trim();
  return tenantDb(user.tenantId).customer.findMany({
    where: {
      ...(scope ? { ownerId: { in: scope } } : { ownerId: { not: null } }),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { domain: { contains: term.toLowerCase() } },
              { contacts: { some: { email: { contains: term, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, domain: true },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
}

/** 把一封邮件归到某个客户，并把对方邮箱加为联系人；同一对方的其他邮件一并归档 */
export async function linkMailAction(id: string, customerId: string): Promise<ActionState> {
  const user = await requireMailUser();
  if (!user) return denied();
  const m = await ownMessage(user, id);
  if (!m) return denied("邮件不存在");
  const found = await getCustomerForUser(user, customerId);
  if (!found?.access.edit) return denied("只能归档到你负责的客户");

  const other = m.folder === "INBOX" ? { address: m.fromAddr, name: m.fromName } : ((m.toList as MailAddress[])[0] ?? null);
  let contactId: string | null = null;
  if (other?.address) {
    const db = tenantDb(user.tenantId);
    const existing = await db.contact.findFirst({ where: { email: { equals: other.address, mode: "insensitive" } } });
    if (existing && existing.customerId !== customerId) {
      return denied(`${other.address} 已是客户「${(await db.customer.findFirst({ where: { id: existing.customerId } }))?.name ?? ""}」的联系人`);
    }
    contactId =
      existing?.id ??
      (
        await db.contact.create({
          data: {
            tenantId: user.tenantId,
            customerId,
            name: other.name?.trim() || other.address.split("@")[0],
            email: other.address,
            remark: "从邮件归档时添加",
          },
        })
      ).id;
    if (!found.customer.domain && extractDomain(other.address)) {
      await db.customer.updateMany({ where: { id: customerId }, data: { domain: extractDomain(other.address) } });
    }
    // 同一个对方地址的邮件一起归档
    await prisma.mailMessage.updateMany({
      where: {
        tenantId: user.tenantId,
        customerId: null,
        OR: [{ fromAddr: other.address }, { toList: { array_contains: [{ address: other.address }] } }],
      },
      data: { customerId, contactId },
    });
  }
  await prisma.mailMessage.update({ where: { id: m.id }, data: { customerId, contactId } });
  await logActivity({
    tenantId: user.tenantId,
    customerId,
    event: "mail_linked",
    content: `把邮件「${m.subject || "(无主题)"}」归档到客户`,
    userId: user.id,
  });
  await syncCustomerTimes(user.tenantId, customerId);
  revalidatePath("/mail", "layout");
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: `已归档到「${found.customer.name}」` };
}

/** 从邮件新建线索 */
export async function mailToLeadAction(id: string): Promise<ActionState> {
  const user = await requireMailUser();
  if (!user) return denied();
  if (!can(user, "lead.create")) return denied("没有新建线索的权限");
  const m = await ownMessage(user, id);
  if (!m) return denied("邮件不存在");
  if (m.leadId) return denied("这封邮件已经建过线索了");
  const domain = extractDomain(m.fromAddr);
  const lead = await tenantDb(user.tenantId).lead.create({
    data: {
      tenantId: user.tenantId,
      companyName: domain ? domain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase()) : null,
      contactName: m.fromName,
      email: m.fromAddr,
      source: "邮件来信",
      inquiry: `${m.subject}\n${(m.text ?? m.snippet).slice(0, 1500)}`,
      ownerId: user.id,
      assignedAt: new Date(),
      createdById: user.id,
    },
  });
  await prisma.mailMessage.update({ where: { id: m.id }, data: { leadId: lead.id } });
  revalidatePath("/mail", "layout");
  revalidatePath("/leads");
  return { ok: true, message: "已建为线索" };
}

/** 嵌入式翻译：邮件正文按段落传进来，逐段译成中文（谷歌优先，失败退回 AI） */
export async function translateMailSegmentsAction(id: string, segments: string[]): Promise<ActionState & { t?: string[] }> {
  const user = await requireMailUser();
  if (!user) return denied();
  if (!can(user, "ai.use")) return denied("没有使用翻译的权限");
  const m = await ownMessage(user, id);
  if (!m) return denied("邮件不存在");
  const segs = segments.slice(0, 220).map((x) => String(x).slice(0, 4800));
  if (!segs.length) return { ok: true, t: [] };
  try {
    return { ok: true, t: await googleTranslateMany(segs, "简体中文") };
  } catch (e) {
    console.warn("google translate failed, fallback to AI:", (e as Error).message);
  }
  if (!aiConfigured()) return denied("翻译服务暂时不可用");
  try {
    const out: string[] = [];
    for (let i = 0; i < segs.length; i += 40) {
      const part = segs.slice(i, i + 40);
      const r = await aiJson<{ t?: unknown }>({
        system: "你是外贸业务员的翻译助手，把客户邮件逐段译成自然的简体中文。只输出一个 JSON 对象。",
        messages: [
          {
            role: "user",
            content: `把下面 ${part.length} 段逐段译成简体中文，产品型号、数字、单位、人名保持原样，段内换行用 \\n 保留。输出 {"t": ["译文1", ...]}，数量和顺序必须与原文一致。\n\n${JSON.stringify(part)}`,
          },
        ],
        maxTokens: 4000,
        timeoutMs: 60_000,
      });
      const t = Array.isArray(r.t) ? r.t : [];
      part.forEach((_, k) => out.push(String(t[k] ?? "")));
    }
    return { ok: true, t: out };
  } catch (e) {
    return denied(e instanceof AiError ? e.message : "翻译失败，请稍后再试");
  }
}
