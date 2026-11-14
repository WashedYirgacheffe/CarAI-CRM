"use server";

import { syncCustomerTimes } from "@/server/pool";
import { revalidatePath } from "next/cache";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { getCustomerForUser, logActivity } from "@/server/customers";
import { digitsOf } from "@/server/whatsapp/match";
import type { ActionState } from "@/lib/action";
import { aiConfigured, aiJson, clip } from "@/server/ai";
import { looksChinese, looksForeign } from "@/lib/lang";
import { formatMoney, formatDate } from "@/lib/crm";
import { REMINDER_KINDS, TIME_PRESETS, presetDate, type TimePreset } from "@/lib/reminders";
import { formShareUrl, productShareUrl, quotationShareUrl } from "@/server/share";
import { productPayload } from "@/server/share-track";
import { MIME_OF } from "@/server/uploads";

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

type Outgoing = {
  body: string;
  type?: string;
  mediaKey?: string;
  mediaMime?: string;
  mediaName?: string | null;
  mediaSize?: number | null;
  quotedId?: string | null;
};

/** 写入待发队列（worker 几秒内发出），并更新会话列表上的最后一条 */
async function queueMessage(user: CurrentUser, chat: { id: string; accountId: string }, m: Outgoing): Promise<ActionState> {
  const account = await prisma.waAccount.findUnique({ where: { id: chat.accountId } });
  if (account?.status !== "CONNECTED") return denied("WhatsApp 未连接，请先到「WhatsApp 绑定」登录");
  let quotedId: string | null = null;
  if (m.quotedId) {
    const q = await prisma.waMessage.findFirst({ where: { id: m.quotedId, chatId: chat.id }, select: { id: true } });
    quotedId = q?.id ?? null;
  }
  const now = new Date();
  const type = m.type ?? "text";
  const preview =
    type === "text" ? m.body : `${{ image: "[图片]", video: "[视频]", audio: "[语音]" }[type] ?? `[文件] ${m.mediaName ?? ""}`} ${m.body}`.trim();
  await prisma.$transaction([
    prisma.waMessage.create({
      data: {
        tenantId: user.tenantId,
        accountId: chat.accountId,
        chatId: chat.id,
        fromMe: true,
        type,
        body: m.body,
        mediaKey: m.mediaKey ?? null,
        mediaMime: m.mediaMime ?? null,
        mediaName: m.mediaName ?? null,
        mediaSize: m.mediaSize ?? null,
        quotedId,
        status: "QUEUED",
        sentById: user.id,
        timestamp: now,
      },
    }),
    prisma.waChat.update({
      where: { id: chat.id },
      data: { lastMessageAt: now, lastText: preview.slice(0, 200), lastFromMe: true, unread: 0, archived: false },
    }),
  ]);
  revalidatePath("/whatsapp", "layout");
  return { ok: true };
}

/** 发消息：写入待发队列，worker 几秒内发出 */
export async function sendWaMessageAction(chatId: string, body: string, quotedId?: string | null): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const text = body.trim();
  if (!text) return denied("消息不能为空");
  if (text.length > 4000) return denied("消息太长了（最多 4000 字）");
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  return queueMessage(user, chat, { body: text, quotedId });
}

/** 发图片 / 视频 / 文件：文件先经 /api/upload/wa 上传，这里只排队 */
export async function sendWaMediaAction(
  chatId: string,
  file: { key: string; mime: string; name: string; size: number },
  caption: string,
  quotedId?: string | null,
): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  if (!file.key.startsWith(`${user.tenantId}/wa/out-`) || file.key.includes("..")) return denied("文件无效，请重新上传");
  const type = waTypeOf(file.mime);
  return queueMessage(user, chat, {
    body: type === "audio" ? "" : caption.trim().slice(0, 1000),
    type,
    mediaKey: file.key,
    mediaMime: file.mime,
    mediaName: file.name.slice(0, 200),
    mediaSize: file.size,
    quotedId,
  });
}

/** 图片按图片发（对方直接看到），视频、语音同理，其他一律按文件发 */
function waTypeOf(mime: string) {
  if (["image/jpeg", "image/png", "image/webp"].includes(mime)) return "image";
  if (mime === "video/mp4") return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
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
  revalidatePath("/todo");
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
      const contact = await tenantDb(user.tenantId).contact.findFirst({
        where: { customerId, OR: [{ whatsapp: { not: null } }, { phone: { not: null } }] },
      });
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
          data: {
            tenantId: user.tenantId,
            customerId,
            name: chat.name || `+${chat.phone}`,
            whatsapp: `+${chat.phone}`,
            remark: "从 WhatsApp 会话关联时添加",
          },
        })
      ).id;
  }
  await prisma.waChat.update({ where: { id: chat.id }, data: { customerId, contactId } });
  await logActivity({
    tenantId: user.tenantId,
    customerId,
    event: "wa_linked",
    content: `关联了 WhatsApp 会话 ${chat.name ?? ""} +${chat.phone ?? ""}`.trim(),
    userId: user.id,
  });
  await syncCustomerTimes(user.tenantId, customerId);
  revalidatePath("/whatsapp", "layout");
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: `已关联到「${found.customer.name}」` };
}

/** 取消会话与客户的关联（之后的消息不再记到这个客户名下；已记的跟进保留） */
export async function unlinkChatAction(chatId: string): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const chat = await ownChat(user, chatId);
  if (!chat?.customerId) return denied("这个会话没有关联客户");
  const customerId = chat.customerId;
  await prisma.waChat.update({ where: { id: chat.id }, data: { customerId: null, contactId: null } });
  await logActivity({
    tenantId: user.tenantId,
    customerId,
    event: "wa_unlinked",
    content: `取消关联 WhatsApp 会话 ${chat.name ?? ""} +${chat.phone ?? ""}`.trim(),
    userId: user.id,
  });
  revalidatePath("/whatsapp", "layout");
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: "已取消关联" };
}

export type ChatOp = "pin" | "unpin" | "archive" | "unarchive" | "unread" | "read";

/** 会话列表右键菜单：置顶、归档、标为未读 / 已读 */
export async function chatOpAction(chatId: string, op: ChatOp): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  if (op === "pin") {
    const pinned = await prisma.waChat.count({ where: { accountId: chat.accountId, pinnedAt: { not: null } } });
    if (pinned >= 5) return denied("最多置顶 5 个聊天");
  }
  const data = {
    pin: { pinnedAt: new Date(), archived: false },
    unpin: { pinnedAt: null },
    archive: { archived: true, pinnedAt: null },
    unarchive: { archived: false },
    unread: { unread: Math.max(chat.unread, 1) },
    read: { unread: 0 },
  }[op];
  await prisma.waChat.update({ where: { id: chat.id }, data });
  revalidatePath("/whatsapp", "layout");
  const msg = { pin: "已置顶", unpin: "已取消置顶", archive: "已归档", unarchive: "已移出归档", unread: "已标为未读", read: "已标为已读" }[op];
  return { ok: true, message: msg };
}

async function ownMessage(user: CurrentUser, id: string) {
  return tenantDb(user.tenantId).waMessage.findFirst({ where: { id, account: { userId: user.id } }, include: { chat: true } });
}

export type MessageOp = "star" | "unstar" | "hide";

/** 消息右键菜单：星标、为我删除（只在本系统隐藏） */
export async function messageOpAction(id: string, op: MessageOp): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const m = await ownMessage(user, id);
  if (!m) return denied("消息不存在");
  await prisma.waMessage.update({ where: { id: m.id }, data: op === "hide" ? { hiddenAt: new Date(), starred: false } : { starred: op === "star" } });
  revalidatePath("/whatsapp", "layout");
  return { ok: true, message: { star: "已加星标", unstar: "已取消星标", hide: "已删除（手机和对方那边不受影响）" }[op] };
}

/** 转发到其他会话：文字原样发，图片 / 文件复用已存的文件 */
export async function forwardWaMessageAction(id: string, chatIds: string[]): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const m = await ownMessage(user, id);
  if (!m) return denied("消息不存在");
  if (!chatIds.length) return denied("请选择要转发到的聊天");
  if (!m.mediaKey && !m.body.trim()) return denied("这条消息不能转发");
  let n = 0;
  for (const cid of chatIds.slice(0, 5)) {
    const chat = await ownChat(user, cid);
    if (!chat) continue;
    const media = m.mediaKey
      ? { type: m.type, mediaKey: m.mediaKey, mediaMime: m.mediaMime ?? undefined, mediaName: m.mediaName, mediaSize: m.mediaSize }
      : {};
    const body = m.mediaKey ? m.body.replace(/^\[(图片|视频|语音|表情|文件)\][^\n]*\n?/, "").trim() : m.body;
    const r = await queueMessage(user, chat, { body, ...media });
    if (!r.ok) return r;
    n++;
  }
  return { ok: true, message: `已转发到 ${n} 个聊天` };
}

/** 把一条消息记成客户跟进 */
export async function logMessageFollowUpAction(id: string): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const m = await ownMessage(user, id);
  if (!m) return denied("消息不存在");
  if (!m.chat.customerId) return denied("先关联客户，才能记到客户跟进里");
  const found = await getCustomerForUser(user, m.chat.customerId);
  if (!found?.access.edit) return denied("只能给你负责的客户写跟进");
  await logActivity({
    tenantId: user.tenantId,
    customerId: m.chat.customerId,
    type: "FOLLOW_UP",
    method: "WHATSAPP",
    event: "wa_note",
    content: `【WhatsApp ${m.fromMe ? "我方" : "客户"}】${m.body.slice(0, 1500)}`,
    userId: user.id,
  });
  await syncCustomerTimes(user.tenantId, m.chat.customerId);
  revalidatePath(`/customers/${m.chat.customerId}`);
  revalidatePath("/whatsapp", "layout");
  return { ok: true, message: "已记到客户跟进" };
}

/** 转发时选会话 */
export async function listChatsAction(q: string) {
  const user = await waUser();
  if (!user) return [];
  const term = q.trim();
  return tenantDb(user.tenantId).waChat.findMany({
    where: {
      account: { userId: user.id },
      lastMessageAt: { not: null },
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { phone: { contains: term.replace(/\D/g, "") || term } },
              { customer: { name: { contains: term, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: 20,
    select: { id: true, name: true, phone: true, customer: { select: { name: true } } },
  });
}

// ── 右侧面板：快捷发送 ──

export type ProductPick = {
  id: string;
  name: string;
  sku: string;
  model: string | null;
  imageUrl: string | null;
  price: string;
  currency: string;
  unit: string;
  moq: number | null;
};

export async function searchProductsAction(q: string): Promise<ProductPick[]> {
  const user = await waUser();
  if (!user) return [];
  const term = q.trim();
  const rows = await tenantDb(user.tenantId).product.findMany({
    where: {
      status: "ACTIVE",
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { nameEn: { contains: term, mode: "insensitive" } },
              { sku: { contains: term, mode: "insensitive" } },
              { model: { contains: term, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, name: true, nameEn: true, sku: true, model: true, imageUrl: true, price: true, currency: true, unit: true, moq: true },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.nameEn || p.name,
    sku: p.sku,
    model: p.model,
    imageUrl: p.imageUrl,
    price: p.price.toString(),
    currency: p.currency,
    unit: p.unit,
    moq: p.moq,
  }));
}

/** 发商品：主图 + 英文说明（品名、型号、规格、价格、起订量）；没有图就只发文字 */
export async function sendProductAction(chatId: string, productId: string, withPrice: boolean): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  const p = await tenantDb(user.tenantId).product.findFirst({ where: { id: productId } });
  if (!p) return denied("商品不存在");
  const lines = [
    `*${p.nameEn || p.name}*`,
    p.model && `Model: ${p.model}`,
    p.spec && `Spec: ${p.spec}`,
    withPrice && Number(p.price) > 0 && `Price: ${formatMoney(p.price.toString(), p.currency)} / ${p.unit}`,
    p.moq && `MOQ: ${p.moq} ${p.unit}`,
    p.cartonQty && `Packing: ${p.cartonQty} ${p.unit}/carton${p.cartonSize ? `, ${p.cartonSize}` : ""}`,
    // 产品卡链接：客户打开、看了多久会记到这个客户的跟进里
    `Details & photos: ${productShareUrl(productPayload(p.id, { chatId: chat.id, price: withPrice }))}`,
  ].filter(Boolean);
  const body = lines.join("\n");
  const key = /^\/api\/files\/(.+)$/.exec(p.imageUrl ?? "")?.[1];
  const ext = key?.split(".").pop() ?? "";
  if (key && key.startsWith(`${user.tenantId}/`) && ["jpg", "png", "webp"].includes(ext)) {
    return queueMessage(user, chat, { body, type: "image", mediaKey: key, mediaMime: MIME_OF[ext], mediaName: `${p.sku}.${ext}` });
  }
  return queueMessage(user, chat, { body });
}

/** 发报价单：在线查看链接（客户打开会记一条动态），草稿 / 已批准的报价单标为已发送 */
export async function sendQuotationAction(chatId: string, quotationId: string): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  const q = await tenantDb(user.tenantId).quotation.findFirst({ where: { id: quotationId } });
  if (!q || (chat.customerId && q.customerId !== chat.customerId)) return denied("报价单不存在");
  if (q.approval === "PENDING") return denied("报价单还在审批中，审批通过后才能发给客户");
  if (q.approval === "REJECTED") return denied("报价单审批被驳回，修改后重新提交审批");
  const greet = chat.name && !/^\+?\d+$/.test(chat.name) ? `Hi ${chat.name.split(/\s+/)[0]},` : "Hi,";
  const body = [
    greet,
    `Please find our quotation *${q.no}* below${q.validUntil ? ` (valid until ${formatDate(q.validUntil, user.timezone)})` : ""}:`,
    quotationShareUrl(q.id),
    `Total: ${formatMoney(q.total.toString(), q.currency)}${q.tradeTerm ? ` ${q.tradeTerm}${q.port ? ` ${q.port}` : ""}` : ""}`,
    "Any questions, just let me know.",
  ].join("\n");
  const r = await queueMessage(user, chat, { body });
  if (r.ok && (q.status === "DRAFT" || q.status === "APPROVED")) await prisma.quotation.update({ where: { id: q.id }, data: { status: "SENT" } });
  return r.ok ? { ok: true, message: `已发送报价单 ${q.no}` } : r;
}

/** 发表单链接：询价表单 / 收货信息表单，客户提交后回到这个会话 */
export async function sendFormAction(chatId: string, kind: "inquiry" | "shipping"): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  const body =
    kind === "inquiry"
      ? `To quote you accurately, could you fill in this short inquiry form? It only takes a minute:\n${formShareUrl("inquiry", chat.id)}`
      : `Please confirm the consignee / shipping details here so we can prepare the documents:\n${formShareUrl("shipping", chat.id)}`;
  const r = await queueMessage(user, chat, { body });
  return r.ok ? { ok: true, message: kind === "inquiry" ? "已发送询价表单" : "已发送收货信息表单" } : r;
}

// ── 右侧面板：AI 跟进 ──

export type AiTodo = { title: string; kind: string; when: TimePreset };
export type AiFollowUp = { summary: string; intent: string; todos: AiTodo[] };

const PRESET_KEYS = TIME_PRESETS.map((p) => p.key);

/** AI 读最近的聊天，写一段跟进记录，并给出接下来要做的事 */
export async function aiChatFollowUpAction(chatId: string): Promise<ActionState & { data?: AiFollowUp }> {
  const user = await waUser();
  if (!user || !can(user, "ai.use")) return denied();
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  const msgs = await prisma.waMessage.findMany({ where: { chatId: chat.id, hiddenAt: null }, orderBy: { timestamp: "desc" }, take: 60 });
  if (!msgs.length) return denied("还没有聊天内容");
  const transcript = msgs
    .reverse()
    .map((m) => `[${formatDate(m.timestamp, user.timezone)}] ${m.fromMe ? "我" : "客户"}：${m.body}`)
    .join("\n");
  const kinds = Object.values(REMINDER_KINDS)
    .map((k) => `${k.key}=${k.label}`)
    .join("，");
  try {
    const r = await aiJson<Partial<AiFollowUp>>({
      system: "你是外贸业务助理，帮业务员把 WhatsApp 聊天整理成跟进记录。只输出一个 JSON 对象，不要输出其他内容。",
      messages: [
        {
          role: "user",
          content: `根据下面的聊天，输出 JSON：
{"summary": "用简体中文写一条跟进记录（3～5 句）：客户要什么、谈到了哪些关键信息（产品、数量、价格、交期、付款、物流）、目前进展到哪一步、还有什么没解决。不要编造聊天里没有的数字。",
 "intent": "一句话概括客户当前意向（不超过 20 字）",
 "todos": [{"title": "接下来我要做的一件具体的事（不超过 30 字）", "kind": "场景 key", "when": "${PRESET_KEYS.join(" | ")} 之一"}]}
todos 最多 3 条，没有就给空数组。场景 key 从这些里选：${kinds}

客户：${chat.name ?? ""} +${chat.phone ?? ""}
今天：${formatDate(new Date(), user.timezone)}
聊天记录：
${clip(transcript, 8000)}`,
        },
      ],
      maxTokens: 1500,
    });
    const todos = (Array.isArray(r.todos) ? r.todos : [])
      .slice(0, 3)
      .map((t) => ({
        title: String(t?.title ?? "").slice(0, 80),
        kind: t?.kind && t.kind in REMINDER_KINDS ? t.kind : "",
        when: (PRESET_KEYS as string[]).includes(String(t?.when)) ? (t.when as TimePreset) : "tomorrow",
      }))
      .filter((t) => t.title);
    return { ok: true, data: { summary: String(r.summary ?? "").slice(0, 1500), intent: String(r.intent ?? "").slice(0, 60), todos } };
  } catch (e) {
    return denied((e as Error).message);
  }
}

/** 保存 AI 整理的跟进记录（可改过），勾选的待办加到日程 */
export async function saveChatFollowUpAction(chatId: string, summary: string, todos: AiTodo[]): Promise<ActionState> {
  const user = await waUser();
  if (!user) return denied();
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  const text = summary.trim();
  if (!text && !todos.length) return denied("没有要保存的内容");
  const customerId = chat.customerId && (await getCustomerForUser(user, chat.customerId))?.access.edit ? chat.customerId : null;
  if (text) {
    if (!customerId) return denied("先关联客户，跟进记录才能记到客户名下");
    await logActivity({
      tenantId: user.tenantId,
      customerId,
      type: "FOLLOW_UP",
      method: "WHATSAPP",
      event: "wa_summary",
      content: text.slice(0, 3000),
      userId: user.id,
    });
    await syncCustomerTimes(user.tenantId, customerId);
  }
  for (const t of todos.slice(0, 5)) {
    if (!t.title.trim()) continue;
    await prisma.task.create({
      data: {
        tenantId: user.tenantId,
        title: t.title.trim().slice(0, 200),
        kind: t.kind && t.kind in REMINDER_KINDS ? t.kind : null,
        dueAt: presetDate((PRESET_KEYS as string[]).includes(t.when) ? t.when : "tomorrow", user.timezone),
        customerId,
        ownerId: user.id,
        createdById: user.id,
        link: `/whatsapp?chat=${chat.id}`,
      },
    });
  }
  revalidatePath("/whatsapp", "layout");
  if (customerId) revalidatePath(`/customers/${customerId}`);
  return { ok: true, message: [text && "跟进记录已保存", todos.length && `${todos.length} 条待办已加到日程`].filter(Boolean).join("，") };
}

// ── 自动翻译 ──

const TR_BATCH = 20;

/**
 * 把对方发来的外文消息译成中文，存在 WaMessage.translation（中文 / 太短的存空串，不再重复判断）。
 * 打开会话时由前端触发，一次最多 20 条
 */
export async function translateWaAction(chatId: string, ids: string[]): Promise<ActionState & { count?: number }> {
  const user = await waUser();
  if (!user || !can(user, "ai.use") || !aiConfigured()) return denied();
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  const msgs = await prisma.waMessage.findMany({
    where: { id: { in: ids.slice(0, TR_BATCH) }, chatId: chat.id, fromMe: false, translation: null },
    select: { id: true, body: true },
  });
  const text = (b: string) => b.replace(/^\[(图片|视频|语音|表情|文件)\]\s*/, "").trim();
  const foreign = msgs.filter((m) => looksForeign(text(m.body), 2));
  const skip = msgs.filter((m) => !foreign.includes(m));
  if (skip.length) await prisma.waMessage.updateMany({ where: { id: { in: skip.map((m) => m.id) } }, data: { translation: "" } });
  if (!foreign.length) return { ok: true, count: 0 };
  try {
    const r = await aiJson<{ t?: unknown }>({
      system: "你是外贸业务员的翻译助手，把客户发来的 WhatsApp 消息译成自然的简体中文。只输出一个 JSON 对象。",
      messages: [
        {
          role: "user",
          content: `把下面 ${foreign.length} 条消息逐条译成简体中文，产品型号、数字、单位、人名保持原样。输出 {"t": ["译文1", "译文2", ...]}，数量和顺序必须与原文一致。

${foreign.map((m, i) => `${i + 1}. ${clip(text(m.body), 1200).replace(/\n/g, " ")}`).join("\n")}`,
        },
      ],
      maxTokens: 3000,
      timeoutMs: 45_000,
    });
    const out = Array.isArray(r.t) ? r.t : [];
    await prisma.$transaction(
      foreign.map((m, i) => prisma.waMessage.update({ where: { id: m.id }, data: { translation: String(out[i] ?? "").slice(0, 4000) || "" } })),
    );
    return { ok: true, count: foreign.length };
  } catch (e) {
    return denied((e as Error).message);
  }
}

/** 中文写的回复按客户用的语言译好（只翻译，不发送；业务员看过再发） */
export async function translateWaOutAction(chatId: string, draft: string): Promise<ActionState & { text?: string; lang?: string }> {
  const user = await waUser();
  if (!user || !can(user, "ai.use") || !aiConfigured()) return denied();
  const chat = await ownChat(user, chatId);
  if (!chat) return denied("会话不存在");
  if (!draft.trim()) return denied("先写点内容");
  const recent = await prisma.waMessage.findMany({
    where: { chatId: chat.id, fromMe: false, hiddenAt: null, type: "text" },
    orderBy: { timestamp: "desc" },
    take: 8,
    select: { body: true },
  });
  const samples = recent.map((m) => m.body).filter((b) => b && !looksChinese(b));
  try {
    const r = await aiJson<{ lang?: string; text?: string }>({
      system: "你是外贸业务员的翻译助手。只输出一个 JSON 对象。",
      messages: [
        {
          role: "user",
          content: `${
            samples.length
              ? `客户最近发来的消息：\n${samples.map((b) => `- ${clip(b, 300).replace(/\n/g, " ")}`).join("\n")}\n\n判断客户用的是什么语言，`
              : "客户还没发过外文消息，用英语，"
          }把我写的中文译成这种语言的 WhatsApp 消息：口语、简洁、礼貌；数字、型号、价格、单位原样保留；不要添加原文没有的内容，不要加称呼和签名。
输出 {"lang": "语言名（用该语言自己的写法，如 English、Español）", "text": "译文"}

我写的：
${clip(draft, 3000)}`,
        },
      ],
      maxTokens: 2000,
      timeoutMs: 45_000,
    });
    const text = String(r.text ?? "").trim();
    if (!text) return denied("没译出来，请重试");
    return { ok: true, text, lang: String(r.lang ?? "").slice(0, 30) || "外文" };
  } catch (e) {
    return denied((e as Error).message);
  }
}
