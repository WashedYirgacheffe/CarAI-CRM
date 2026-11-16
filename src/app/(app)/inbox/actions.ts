"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { getCustomerForUser, logActivity } from "@/server/customers";
import { syncCustomerTimes } from "@/server/pool";
import { enqueueMatrixJob, logMatrixEvent } from "@/server/matrix";
import { kickCloud } from "@/server/matrix-cloud";
import { canUseInbox, syncInboxNow, threadScope } from "@/server/inbox";
import { googleTranslateCode } from "@/server/translate";
import { isChineseLang, isInboxPlatform, langName } from "@/lib/inbox";
import { matrixPlatform } from "@/lib/matrix";
import type { ActionState } from "@/lib/action";

const denied = (message = "没有权限") => ({ ok: false, message });

async function inboxUser() {
  const user = await requireUser();
  return canUseInbox(user) ? user : null;
}

/** 当前用户能看到的会话 */
async function ownThread(user: CurrentUser, id: string) {
  return prisma.socialThread.findFirst({
    where: { id, ...threadScope(user) },
    include: { account: { select: { id: true, name: true, platform: true, status: true, proxyId: true } } },
  });
}

/** 交给云端的任务（账号没有归属设备、企业开了云端）就拉起云端运行器；归属桌面版的由那台电脑自己领 */
async function kick(tenantId: string) {
  await kickCloud(tenantId, undefined, (fn) => after(fn));
}

// ── 发消息 ──

/** 回复：可选先译成对方语言；排队后由运行器在对应账号里发出 */
export async function sendSocialReplyAction(threadId: string, text: string, translate: boolean): Promise<ActionState & { sent?: string }> {
  const user = await inboxUser();
  if (!user) return denied();
  const t = await ownThread(user, threadId);
  if (!t) return denied("会话不存在");
  const raw = text.trim().slice(0, 4000);
  if (!raw) return denied("消息是空的");
  if (t.account.status !== "active") return denied("这个账号没登录，先在社媒矩阵里登录");
  if (!t.account.proxyId) return denied("这个账号没有绑定代理");
  if (!isInboxPlatform(t.platform)) return denied(`${matrixPlatform(t.platform)?.label ?? t.platform} 还不支持回复`);

  let body = raw;
  let original: string | null = null;
  if (translate && t.peerLang && !isChineseLang(t.peerLang)) {
    try {
      const [r] = await googleTranslateCode([raw], t.peerLang);
      if (r.text.trim()) {
        body = r.text.trim();
        original = raw;
      }
    } catch {
      return denied(`翻译成${langName(t.peerLang)}失败，可以关掉翻译直接发`);
    }
  }
  await prisma.socialMessage.create({
    data: { tenantId: user.tenantId, threadId: t.id, fromMe: true, body, translation: original, status: "queued", sentById: user.id, timestamp: new Date() },
  });
  await prisma.socialThread.update({
    where: { id: t.id },
    data: { lastMessageAt: new Date(), lastText: body.slice(0, 300), lastFromMe: true, unread: 0 },
  });
  await enqueueMatrixJob({ tenantId: user.tenantId, accountId: t.accountId, kind: "reply", userId: user.id });
  await kick(user.tenantId);
  revalidatePath("/inbox");
  return { ok: true, sent: body };
}

/** 发送失败的重发 */
export async function retrySocialMessageAction(id: string): Promise<ActionState> {
  const user = await inboxUser();
  if (!user) return denied();
  const m = await prisma.socialMessage.findFirst({ where: { id, tenantId: user.tenantId, status: "failed", fromMe: true }, select: { threadId: true } });
  if (!m) return denied("消息不存在");
  const t = await ownThread(user, m.threadId);
  if (!t) return denied("会话不存在");
  await prisma.socialMessage.update({ where: { id }, data: { status: "queued", error: null } });
  await enqueueMatrixJob({ tenantId: user.tenantId, accountId: t.accountId, kind: "reply", userId: user.id });
  await kick(user.tenantId);
  revalidatePath("/inbox");
  return { ok: true, message: "已重新排队发送" };
}

/** 删掉发送失败、不想再发的消息 */
export async function deleteFailedMessageAction(id: string): Promise<ActionState> {
  const user = await inboxUser();
  if (!user) return denied();
  const m = await prisma.socialMessage.findFirst({ where: { id, tenantId: user.tenantId, status: "failed", fromMe: true }, select: { threadId: true } });
  if (!m || !(await ownThread(user, m.threadId))) return denied("消息不存在");
  await prisma.socialMessage.delete({ where: { id } });
  revalidatePath("/inbox");
  return { ok: true, message: "已删除" };
}

export async function markThreadReadAction(threadId: string): Promise<void> {
  const user = await inboxUser();
  if (!user) return;
  await prisma.socialThread.updateMany({ where: { id: threadId, ...threadScope(user), unread: { gt: 0 } }, data: { unread: 0 } });
}

export async function archiveThreadAction(threadId: string, archived: boolean): Promise<ActionState> {
  const user = await inboxUser();
  if (!user) return denied();
  const t = await ownThread(user, threadId);
  if (!t) return denied("会话不存在");
  await prisma.socialThread.update({ where: { id: t.id }, data: { archived, ...(archived ? { unread: 0 } : {}) } });
  revalidatePath("/inbox");
  return { ok: true, message: archived ? "已归档" : "已移回收件箱" };
}

/** 立即同步这个会话所在账号的私信 */
export async function syncThreadAccountAction(threadId: string): Promise<ActionState> {
  const user = await inboxUser();
  if (!user) return denied();
  const t = await ownThread(user, threadId);
  if (!t) return denied("会话不存在");
  if (t.account.status !== "active") return denied("这个账号没登录");
  await syncInboxNow(user.tenantId, t.accountId, user.id);
  await kick(user.tenantId);
  return { ok: true, message: "已开始同步，1～2 分钟后刷新" };
}

// ── 客户、线索 ──

/** 归到客户：同时把对方主页记进客户的社媒档案，以后的会话自动归过去 */
export async function linkThreadAction(threadId: string, customerId: string): Promise<ActionState> {
  const user = await inboxUser();
  if (!user) return denied();
  const t = await ownThread(user, threadId);
  if (!t) return denied("会话不存在");
  const found = await getCustomerForUser(user, customerId);
  if (!found?.access.edit) return denied("只能关联到你负责的客户");
  await prisma.socialThread.update({ where: { id: t.id }, data: { customerId } });
  if (t.peerUrl) {
    await tenantDb(user.tenantId)
      .customerSocial.upsert({
        where: { tenantId_customerId_url: { tenantId: user.tenantId, customerId, url: t.peerUrl } },
        create: { tenantId: user.tenantId, customerId, platform: t.platform, url: t.peerUrl, handle: t.peerHandle, source: "manual", createdById: user.id },
        update: {},
      })
      .catch(() => null);
  }
  const label = matrixPlatform(t.platform)?.label ?? t.platform;
  await logActivity({
    tenantId: user.tenantId,
    customerId,
    event: "social_linked",
    content: `关联了 ${label} 私信会话 ${t.peerName ?? ""}`.trim(),
    userId: user.id,
  });
  await syncCustomerTimes(user.tenantId, customerId);
  revalidatePath("/inbox");
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: `已关联到「${found.customer.name}」` };
}

export async function unlinkThreadAction(threadId: string): Promise<ActionState> {
  const user = await inboxUser();
  if (!user) return denied();
  const t = await ownThread(user, threadId);
  if (!t?.customerId) return denied("这个会话没有关联客户");
  await prisma.socialThread.update({ where: { id: t.id }, data: { customerId: null } });
  revalidatePath("/inbox");
  revalidatePath(`/customers/${t.customerId}`);
  return { ok: true, message: "已取消关联" };
}

/** 没归上客户的会话一键建线索 */
export async function threadToLeadAction(threadId: string): Promise<ActionState> {
  const user = await inboxUser();
  if (!user) return denied();
  if (!can(user, "lead.create")) return denied("没有新建线索的权限");
  const t = await ownThread(user, threadId);
  if (!t) return denied("会话不存在");
  if (t.leadId) return denied("这个会话已经建过线索了");
  const recent = await prisma.socialMessage.findMany({
    where: { threadId: t.id, fromMe: false },
    orderBy: { timestamp: "desc" },
    take: 8,
    select: { body: true, translation: true },
  });
  const label = matrixPlatform(t.platform)?.label ?? t.platform;
  const who = [t.peerName, t.peerHandle ? `@${t.peerHandle.replace(/^@/, "")}` : null].filter(Boolean).join(" ");
  const lead = await tenantDb(user.tenantId).lead.create({
    data: {
      tenantId: user.tenantId,
      contactName: t.peerName,
      source: `${label} 私信`,
      inquiry: [
        `来自 ${label} 私信（账号「${t.account.name}」）：${who}`,
        t.peerUrl ? `主页：${t.peerUrl}` : null,
        "",
        ...recent.reverse().map((m) => (m.translation ? `${m.body}\n（${m.translation}）` : m.body)),
      ]
        .filter((x) => x !== null)
        .join("\n")
        .slice(0, 3000),
      ownerId: user.id,
      assignedAt: new Date(),
      createdById: user.id,
    },
  });
  await prisma.socialThread.update({ where: { id: t.id }, data: { leadId: lead.id } });
  revalidatePath("/inbox");
  revalidatePath("/leads");
  return { ok: true, message: "已建为线索" };
}

// ── 分配 ──

/** 转交给别的同事（管理者或当前负责人能转） */
export async function assignThreadAction(threadId: string, assigneeId: string): Promise<ActionState> {
  const user = await inboxUser();
  if (!user) return denied();
  const t = await ownThread(user, threadId);
  if (!t) return denied("会话不存在");
  const to = await prisma.user.findFirst({ where: { id: assigneeId, tenantId: user.tenantId, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!to) return denied("同事不存在");
  await prisma.socialThread.update({ where: { id: t.id }, data: { assigneeId: to.id } });
  await logMatrixEvent({ tenantId: user.tenantId, accountId: t.accountId, userId: user.id, action: "inbox:assign", detail: `${t.peerName ?? t.externalId} → ${to.name}` });
  if (to.id !== user.id) {
    await prisma.task.create({
      data: {
        tenantId: user.tenantId,
        ownerId: to.id,
        title: `${user.name} 把 ${matrixPlatform(t.platform)?.label ?? t.platform} 私信「${t.peerName ?? "会话"}」转给了你`,
        dueAt: new Date(),
        link: `/inbox?t=${t.id}`,
      },
    });
  }
  revalidatePath("/inbox");
  return { ok: true, message: `已转给 ${to.name}` };
}

// ── 账号开关 ──

/** 社媒矩阵账号：开 / 关「收私信」 */
export async function setInboxSyncAction(accountId: string, on: boolean): Promise<ActionState> {
  const user = await requireUser();
  const acc = await prisma.matrixAccount.findFirst({ where: { id: accountId, tenantId: user.tenantId }, select: { id: true, platform: true, ownerId: true, status: true } });
  if (!acc) return denied("账号不存在");
  if (!can(user, "matrix.manage") && !(can(user, "matrix.use") && acc.ownerId === user.id)) return denied();
  if (on && !isInboxPlatform(acc.platform)) return denied(`${matrixPlatform(acc.platform)?.label ?? acc.platform} 还不支持收私信`);
  await prisma.matrixAccount.update({ where: { id: acc.id }, data: { inboxSync: on } });
  await logMatrixEvent({ tenantId: user.tenantId, accountId: acc.id, userId: user.id, action: on ? "inbox:on" : "inbox:off" });
  if (on && acc.status === "active") {
    await syncInboxNow(user.tenantId, acc.id, user.id);
    await kick(user.tenantId);
  }
  revalidatePath("/social/matrix");
  return { ok: true, message: on ? "已开启收私信，每 10 分钟同步一次" : "已关闭收私信" };
}

// ── 快捷回复 ──

const QuickReplySchema = z.object({
  id: z.string().optional(),
  group: z.string().trim().max(40).optional(),
  title: z.string().trim().min(1, "填个标题").max(60),
  body: z.string().trim().min(1, "填写内容").max(4000),
  shared: z.boolean(),
});

export async function listQuickRepliesAction() {
  const user = await requireUser();
  const rows = await prisma.quickReply.findMany({
    where: { tenantId: user.tenantId, OR: [{ ownerId: null }, { ownerId: user.id }] },
    orderBy: [{ group: "asc" }, { sort: "asc" }, { title: "asc" }],
    select: { id: true, group: true, title: true, body: true, ownerId: true },
  });
  return rows.map((r) => ({ id: r.id, group: r.group, title: r.title, body: r.body, shared: !r.ownerId }));
}

export async function saveQuickReplyAction(input: z.input<typeof QuickReplySchema>): Promise<ActionState> {
  const user = await requireUser();
  const parsed = QuickReplySchema.safeParse(input);
  if (!parsed.success) return denied(parsed.error.issues[0]?.message ?? "内容不对");
  const d = parsed.data;
  // 公共话术只有管理者能建、改
  if (d.shared && !can(user, "matrix.manage")) return denied("只有管理者能维护公共话术");
  const db = tenantDb(user.tenantId);
  const data = { group: d.group || null, title: d.title, body: d.body, ownerId: d.shared ? null : user.id };
  if (d.id) {
    const cur = await db.quickReply.findFirst({ where: { id: d.id } });
    if (!cur) return denied("话术不存在");
    if (cur.ownerId ? cur.ownerId !== user.id : !can(user, "matrix.manage")) return denied();
    await db.quickReply.update({ where: { id: d.id }, data });
  } else {
    await db.quickReply.create({ data: { ...data, tenantId: user.tenantId } });
  }
  revalidatePath("/inbox");
  return { ok: true, message: "已保存" };
}

export async function deleteQuickReplyAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const db = tenantDb(user.tenantId);
  const cur = await db.quickReply.findFirst({ where: { id } });
  if (!cur) return denied("话术不存在");
  if (cur.ownerId ? cur.ownerId !== user.id : !can(user, "matrix.manage")) return denied();
  await db.quickReply.delete({ where: { id } });
  revalidatePath("/inbox");
  return { ok: true, message: "已删除" };
}
