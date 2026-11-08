import "server-only";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { WAMessage, WASocket } from "baileys";

/**
 * baileys 及其依赖只提供 ESM 导出，而 tsx 会把本文件编译成 CommonJS，
 * 静态 import 会走 require 解析失败，所以运行时用动态 import 加载。
 */
type Baileys = typeof import("baileys");
let B!: Baileys;
async function loadBaileys() {
  B ??= await import("baileys");
}
import pino from "pino";
import { prisma } from "@/server/db";
import { matchContactByPhone } from "@/server/whatsapp/match";

/**
 * WhatsApp 会话管理（只在 worker 进程里运行）。
 * 网页端只读写数据库：WaAccount.enabled / logoutRequested 控制连接，WaMessage(QUEUED) 是待发队列，
 * worker 每隔几秒对账一次，把二维码、连接状态、收到的消息写回数据库。
 */
const AUTH_DIR = path.resolve(process.env.WA_AUTH_DIR || "storage/whatsapp");
const logger = pino({ level: "silent" });

type Session = { sock: WASocket; open: boolean; qrCount: number };
const sessions = new Map<string, Session>();
/** 断线重连退避：accountId → 最早可重连时间 */
const retryAt = new Map<string, number>();
const failures = new Map<string, number>();
let version: [number, number, number] | undefined;

const authDir = (id: string) => path.join(AUTH_DIR, id);
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[wa]", ...a);

async function start(accountId: string) {
  const loadAuthState = B.useMultiFileAuthState; // 不是 React Hook，只是名字以 use 开头
  const { state, saveCreds } = await loadAuthState(authDir(accountId));
  if (!version) version = await B.fetchLatestBaileysVersion().then((r) => r.version).catch(() => undefined);
  const sock = B.makeWASocket({
    auth: state,
    version,
    logger,
    browser: B.Browsers.macOS("Desktop"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });
  const session: Session = { sock, open: false, qrCount: 0 };
  sessions.set(accountId, session);
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    try {
      if (u.qr) {
        session.qrCount++;
        // 二维码大约 20 秒刷新一次，5 次（约 2 分钟）没扫就停下，等用户重新点「获取二维码」
        if (session.qrCount > 5) {
          await prisma.waAccount.update({ where: { id: accountId }, data: { enabled: false, status: "DISCONNECTED", qr: null, lastError: "二维码已过期，请重新获取" } });
          sock.end(undefined);
          return;
        }
        await prisma.waAccount.update({ where: { id: accountId }, data: { status: "CONNECTING", qr: u.qr, qrAt: new Date(), lastError: null } });
      }
      if (u.connection === "open") {
        session.open = true;
        failures.delete(accountId);
        const me = sock.user;
        await prisma.waAccount.update({
          where: { id: accountId },
          data: {
            status: "CONNECTED",
            qr: null,
            lastError: null,
            connectedAt: new Date(),
            phone: me?.id ? B.jidNormalizedUser(me.id).split("@")[0] : undefined,
            name: me?.name ?? me?.notify ?? undefined,
          },
        });
        log(accountId, "connected");
      }
      if (u.connection === "close") {
        sessions.delete(accountId);
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        log(accountId, "closed", code);
        if (code === B.DisconnectReason.loggedOut) {
          await rm(authDir(accountId), { recursive: true, force: true });
          await prisma.waAccount.update({
            where: { id: accountId },
            data: { status: "DISCONNECTED", enabled: false, qr: null, phone: null, lastError: "已在手机上退出登录，请重新扫码" },
          });
          return;
        }
        if (code === B.DisconnectReason.restartRequired) return; // 扫码成功后的正常重启，立即重连
        const n = (failures.get(accountId) ?? 0) + 1;
        failures.set(accountId, n);
        retryAt.set(accountId, Date.now() + Math.min(5 * 60_000, 2000 * 2 ** n));
        await prisma.waAccount.updateMany({
          where: { id: accountId, status: { not: "DISCONNECTED" } },
          data: { status: "CONNECTING", lastError: n > 2 ? "连接中断，正在重连…" : null },
        });
      }
    } catch (e) {
      log(accountId, "connection.update error", (e as Error).message);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const msg of messages) {
      try {
        await storeIncoming(accountId, msg, type === "notify");
      } catch (e) {
        log(accountId, "store error", (e as Error).message);
      }
    }
  });
}

function contentOf(msg: WAMessage): { type: string; body: string } | null {
  const content = B.normalizeMessageContent(msg.message);
  const kind = B.getContentType(content);
  if (!content || !kind) return null;
  switch (kind) {
    case "conversation":
      return { type: "text", body: content.conversation ?? "" };
    case "extendedTextMessage":
      return { type: "text", body: content.extendedTextMessage?.text ?? "" };
    case "imageMessage":
      return { type: "image", body: `[图片] ${content.imageMessage?.caption ?? ""}`.trim() };
    case "videoMessage":
      return { type: "video", body: `[视频] ${content.videoMessage?.caption ?? ""}`.trim() };
    case "audioMessage":
      return { type: "audio", body: "[语音]" };
    case "documentMessage":
      return { type: "document", body: `[文件] ${content.documentMessage?.fileName ?? ""}`.trim() };
    case "documentWithCaptionMessage":
      return { type: "document", body: `[文件] ${content.documentWithCaptionMessage?.message?.documentMessage?.fileName ?? ""}`.trim() };
    case "stickerMessage":
      return { type: "sticker", body: "[表情]" };
    case "locationMessage":
      return { type: "other", body: "[位置]" };
    case "contactMessage":
      return { type: "other", body: `[名片] ${content.contactMessage?.displayName ?? ""}`.trim() };
    default:
      return null; // 回执、撤回、表态等不入库
  }
}

async function storeIncoming(accountId: string, msg: WAMessage, live: boolean) {
  const jid = msg.key.remoteJid;
  if (!jid || !msg.key.id || jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) return;
  const c = contentOf(msg);
  if (!c) return;

  const account = await prisma.waAccount.findUnique({ where: { id: accountId } });
  if (!account) return;
  const exists = await prisma.waMessage.findUnique({ where: { accountId_waId: { accountId, waId: msg.key.id } }, select: { id: true } });
  if (exists) return;

  const alt = msg.key.remoteJidAlt;
  const pn = jid.endsWith("@s.whatsapp.net") ? jid : alt?.endsWith("@s.whatsapp.net") ? alt : null;
  const phone = pn ? pn.split("@")[0].split(":")[0] : null;
  const fromMe = !!msg.key.fromMe;
  const ts = new Date(Number(msg.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000);

  let chat = await prisma.waChat.findUnique({ where: { accountId_jid: { accountId, jid } } });
  // 同一个人可能先以手机号、后以 LID 出现：按手机号合并
  if (!chat && phone) chat = await prisma.waChat.findFirst({ where: { accountId, phone } });
  if (!chat) {
    const match = await matchContactByPhone(account.tenantId, phone);
    chat = await prisma.waChat.create({
      data: {
        tenantId: account.tenantId,
        accountId,
        jid,
        phone,
        name: fromMe ? null : msg.pushName || null,
        customerId: match?.customerId ?? null,
        contactId: match?.id ?? null,
      },
    });
  } else if (!chat.customerId && phone) {
    const match = await matchContactByPhone(account.tenantId, phone);
    if (match) chat = await prisma.waChat.update({ where: { id: chat.id }, data: { customerId: match.customerId, contactId: match.id } });
  }

  try {
    await prisma.waMessage.create({
      data: {
        tenantId: account.tenantId,
        accountId,
        chatId: chat.id,
        waId: msg.key.id,
        fromMe,
        type: c.type,
        body: c.body.slice(0, 20_000),
        status: fromMe ? "SENT" : "RECEIVED",
        timestamp: ts,
      },
    });
  } catch {
    return; // 并发重复
  }
  const newer = !chat.lastMessageAt || chat.lastMessageAt <= ts;
  await prisma.waChat.update({
    where: { id: chat.id },
    data: {
      ...(newer ? { lastMessageAt: ts, lastText: c.body.slice(0, 200) } : {}),
      ...(!fromMe && live ? { unread: { increment: 1 } } : {}),
      ...(!fromMe && msg.pushName && !chat.name ? { name: msg.pushName } : {}),
      ...(phone && !chat.phone ? { phone } : {}),
    },
  });
  if (fromMe && chat.customerId) await logOutgoing(account.tenantId, chat.customerId, account.userId, c.body, ts);
}

/** 发给客户的 WhatsApp 记一条跟进（同一客户 6 小时内只记一次），并刷新最近跟进时间 */
export async function logOutgoing(tenantId: string, customerId: string, userId: string, body: string, at: Date) {
  const recent = await prisma.activity.findFirst({
    where: { tenantId, customerId, event: "wa_out", createdAt: { gt: new Date(at.getTime() - 6 * 3600_000) } },
    select: { id: true },
  });
  if (!recent) {
    await prisma.activity.create({
      data: { tenantId, customerId, type: "FOLLOW_UP", method: "WHATSAPP", event: "wa_out", content: `【WhatsApp】${body.slice(0, 300)}`, userId, createdAt: at },
    });
  }
  await prisma.customer.updateMany({
    where: { tenantId, id: customerId, OR: [{ lastContactAt: null }, { lastContactAt: { lt: at } }] },
    data: { lastContactAt: at },
  });
}

async function sendQueued() {
  const queued = await prisma.waMessage.findMany({
    where: { status: "QUEUED", accountId: { in: [...sessions.keys()] } },
    orderBy: { createdAt: "asc" },
    take: 20,
    include: { chat: true, account: { select: { userId: true } } },
  });
  for (const m of queued) {
    const s = sessions.get(m.accountId);
    if (!s?.open) continue;
    const waId = B.generateMessageIDV2(s.sock.user?.id);
    await prisma.waMessage.update({ where: { id: m.id }, data: { waId } });
    try {
      await s.sock.sendMessage(m.chat.jid, { text: m.body }, { messageId: waId });
      await prisma.waMessage.update({ where: { id: m.id }, data: { status: "SENT", timestamp: new Date() } });
      if (m.chat.customerId) await logOutgoing(m.tenantId, m.chat.customerId, m.sentById ?? m.account.userId, m.body, new Date());
    } catch (e) {
      await prisma.waMessage.update({ where: { id: m.id }, data: { status: "FAILED", error: (e as Error).message.slice(0, 300) } });
    }
  }
  // 账号没连上时，超过 10 分钟的待发消息标记失败
  await prisma.waMessage.updateMany({
    where: { status: "QUEUED", createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    data: { status: "FAILED", error: "WhatsApp 未连接，发送超时" },
  });
}

/** 对账一次：按数据库里的期望状态启动 / 停止会话，并发送待发消息 */
export async function reconcileWhatsapp() {
  await loadBaileys();
  const accounts = await prisma.waAccount.findMany();
  for (const a of accounts) {
    const s = sessions.get(a.id);
    if (a.logoutRequested) {
      if (s) {
        await s.sock.logout().catch(() => {});
        s.sock.end(undefined);
        sessions.delete(a.id);
      }
      await rm(authDir(a.id), { recursive: true, force: true });
      await prisma.waAccount.update({
        where: { id: a.id },
        data: { logoutRequested: false, enabled: false, status: "DISCONNECTED", qr: null, phone: null, name: null, lastError: null },
      });
      continue;
    }
    if (a.enabled && !s) {
      if ((retryAt.get(a.id) ?? 0) > Date.now()) continue;
      retryAt.delete(a.id);
      log(a.id, "starting");
      await start(a.id).catch(async (e) => {
        sessions.delete(a.id);
        retryAt.set(a.id, Date.now() + 30_000);
        await prisma.waAccount.update({ where: { id: a.id }, data: { lastError: `启动失败：${(e as Error).message}` } });
      });
    } else if (!a.enabled && s) {
      s.sock.end(undefined);
      sessions.delete(a.id);
      await prisma.waAccount.update({ where: { id: a.id }, data: { status: "DISCONNECTED", qr: null } });
    } else if (!a.enabled && a.status !== "DISCONNECTED") {
      await prisma.waAccount.update({ where: { id: a.id }, data: { status: "DISCONNECTED", qr: null } });
    }
  }
  // 账号被删掉了
  for (const [id, s] of sessions) {
    if (!accounts.some((a) => a.id === id)) {
      s.sock.end(undefined);
      sessions.delete(id);
    }
  }
  await sendQueued();
}

export function shutdownWhatsapp() {
  for (const s of sessions.values()) s.sock.end(undefined);
  sessions.clear();
}
