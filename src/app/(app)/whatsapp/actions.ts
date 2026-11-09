"use server";

import { syncCustomerTimes } from "@/server/pool";
import { revalidatePath } from "next/cache";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { getCustomerForUser, logActivity } from "@/server/customers";
import { digitsOf } from "@/server/whatsapp/match";
import type { ActionState } from "@/lib/action";

const denied = (message = "没有操作权限"): ActionState => ({ ok: false, message });

async function waUser() {
  const user = await requireUser();
  return can(user, "whatsapp.use") ? user : null;
}

async function ownChat(user: CurrentUser, id: string) {
  return tenantDb(user.tenantId).waChat.findFirst({ where: { id, account: { userId: user.id } } });
}

function revalidate() {
  revalidatePath("/whatsapp", "layout");
  revalidatePath("/settings/whatsapp");
}

/** 开始连接：没有账号时创建；worker 会生成二维码 */
/** 发起登录。传手机号则用「手机号 + 配对码」登录，不传则扫码登录 */
export async function connectWhatsappAction(phone?: string): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  let pairPhone: string | null = null;
  if (phone !== undefined) {
    pairPhone = phone.replace(/\D/g, "").replace(/^00/, "");
    if (pairPhone.length < 8 || pairPhone.length > 15) return denied("请输入带国家码的完整手机号，例如 8613800138000");
  }
  const data = { enabled: true, status: "CONNECTING" as const, lastError: null, qr: null, pairCode: null, pairPhone };
  await prisma.waAccount.upsert({
    where: { userId: user.id },
    create: { tenantId: user.tenantId, userId: user.id, ...data },
    update: data,
  });
  revalidate();
  return { ok: true, message: pairPhone ? "正在获取配对码…" : "正在生成二维码…" };
}

export async function disconnectWhatsappAction(logout: boolean): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const a = await prisma.waAccount.findUnique({ where: { userId: user.id } });
  if (!a) return denied("还没有绑定 WhatsApp");
  await prisma.waAccount.update({
    where: { id: a.id },
    data: logout ? { logoutRequested: true } : { enabled: false },
  });
  revalidate();
  return { ok: true, message: logout ? "正在退出登录…" : "已断开，聊天记录会保留" };
}

/** 发消息：写入待发队列，worker 几秒内发出 */
export async function sendWaMessageAction(chatId: string, body: string): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const text = body.trim();
  if (!text) return denied("消息不能为空");
  if (text.length > 4000) return denied("消息太长了（最多 4000 字）");
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  const account = await prisma.waAccount.findUnique({ where: { id: chat.accountId } });
  if (account?.status !== "CONNECTED") return denied("WhatsApp 未连接，请先到「WhatsApp 绑定」登录");
  const now = new Date();
  await prisma.$transaction([
    prisma.waMessage.create({
      data: { tenantId: user.tenantId, accountId: chat.accountId, chatId, fromMe: true, body: text, status: "QUEUED", sentById: user.id, timestamp: now },
    }),
    prisma.waChat.update({ where: { id: chatId }, data: { lastMessageAt: now, lastText: text.slice(0, 200), lastFromMe: true, unread: 0 } }),
  ]);
  revalidatePath("/whatsapp", "layout");
  return { ok: true };
}

export async function retryWaMessageAction(id: string): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const m = await tenantDb(user.tenantId).waMessage.findFirst({ where: { id, status: "FAILED", account: { userId: user.id } } });
  if (!m) return denied("消息不存在");
  await prisma.waMessage.update({ where: { id: m.id }, data: { status: "QUEUED", error: null, waId: null, createdAt: new Date() } });
  revalidatePath("/whatsapp", "layout");
  return { ok: true, message: "已重新排队发送" };
}

export async function markChatReadAction(chatId: string): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const chat = await ownChat(user, chatId);
  if (chat?.unread) await prisma.waChat.update({ where: { id: chat.id }, data: { unread: 0 } });
  return { ok: true };
}

/** 按手机号新建会话；返回会话 id */
export async function startChatAction(phone: string, customerId?: string): Promise<ActionState & { id?: string }> {
  const user = await waUser();
  if (!user) return denied();
  const d = digitsOf(phone);
  if (d.length < 7 || d.length > 15) return denied("请输入带国家码的手机号，如 +1 555 123 4567");
  const account = await prisma.waAccount.findUnique({ where: { userId: user.id } });
  if (!account) return denied("请先绑定 WhatsApp");
  let linked: { customerId: string; contactId: string | null } | null = null;
  if (customerId) {
    const found = await getCustomerForUser(user, customerId);
    if (found?.access.edit) {
      const contact = await tenantDb(user.tenantId).contact.findFirst({ where: { customerId, OR: [{ whatsapp: { not: null } }, { phone: { not: null } }] } });
      linked = { customerId, contactId: contact && (digitsOf(contact.whatsapp) === d || digitsOf(contact.phone) === d) ? contact.id : null };
    }
  }
  const existing = await prisma.waChat.findFirst({ where: { accountId: account.id, OR: [{ phone: d }, { jid: `${d}@s.whatsapp.net` }] } });
  const chat =
    existing ??
    (await prisma.waChat.create({
      data: { tenantId: user.tenantId, accountId: account.id, jid: `${d}@s.whatsapp.net`, phone: d, ...(linked ?? {}) },
    }));
  if (existing && linked && !existing.customerId) await prisma.waChat.update({ where: { id: existing.id }, data: linked });
  revalidatePath("/whatsapp", "layout");
  return { ok: true, id: chat.id };
}

/** 把会话关联到客户；手机号写进联系人（没有时新建联系人） */
export async function linkChatAction(chatId: string, customerId: string): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  const found = await getCustomerForUser(user, customerId);
  if (!found?.access.edit) return denied("只能关联到你负责的客户");
  const db = tenantDb(user.tenantId);
  let contactId: string | null = null;
  if (chat.phone) {
    const contacts = await db.contact.findMany({ where: { customerId } });
    const hit = contacts.find((c) => digitsOf(c.whatsapp) === chat.phone || digitsOf(c.phone) === chat.phone);
    contactId =
      hit?.id ??
      (
        await db.contact.create({
          data: { tenantId: user.tenantId, customerId, name: chat.name || `+${chat.phone}`, whatsapp: `+${chat.phone}`, remark: "从 WhatsApp 会话关联时添加" },
        })
      ).id;
  }
  await prisma.waChat.update({ where: { id: chat.id }, data: { customerId, contactId } });
  await logActivity({ tenantId: user.tenantId, customerId, event: "wa_linked", content: `关联了 WhatsApp 会话 ${chat.name ?? ""} +${chat.phone ?? ""}`.trim(), userId: user.id });
  await syncCustomerTimes(user.tenantId, customerId);
  revalidatePath("/whatsapp", "layout");
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: `已关联到「${found.customer.name}」` };
}
