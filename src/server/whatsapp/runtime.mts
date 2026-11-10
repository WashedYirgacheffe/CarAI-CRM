import "server-only";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Contact, WAMessage, WASocket } from "baileys";

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
import { getObject, putObject } from "@/server/storage";
import { matchContactByPhone } from "@/server/whatsapp/match";
import { touchCustomer } from "@/server/pool";

/**
 * WhatsApp 会话管理（只在 worker 进程里运行）。
 * 网页端只读写数据库：WaAccount.enabled / logoutRequested 控制连接，WaMessage(QUEUED) 是待发队列，
 * worker 每隔几秒对账一次，把二维码、连接状态、收到的消息写回数据库。
 */
const AUTH_DIR = path.resolve(process.env.WA_AUTH_DIR || "storage/whatsapp");
const logger = pino({ level: "silent" });

type Session = { sock: WASocket; open: boolean; qrCount: number; pairRequested: boolean };
const sessions = new Map<string, Session>();
/** 断线重连退避：accountId → 最早可重连时间 */
const retryAt = new Map<string, number>();
const failures = new Map<string, number>();
/** 每个账号的事件串行队列：历史同步和实时消息不能并发写同一个会话 */
const queues = new Map<string, Promise<void>>();
function enqueue(accountId: string, fn: () => Promise<void>) {
  const next = (queues.get(accountId) ?? Promise.resolve()).then(fn).catch((e) => log(accountId, "queue error", (e as Error).message));
  queues.set(accountId, next);
  return next;
}
/** 通讯录名字缓存：accountId → (jid / lid / 手机号 jid) → 名字 */
const contactNames = new Map<string, Map<string, string>>();
/** 历史同步：最近一次收到历史分片的时间、是否已收到「完成」信号 */
const lastHistoryAt = new Map<string, number>();
const historyComplete = new Set<string>();
/** 桌面版身份被 WhatsApp 拒绝过的账号，改用浏览器身份关联 */
const desktopRejected = new Set<string>();
const tenantOf = new Map<string, { tenantId: string; userId: string }>();
let version: [number, number, number] | undefined;
let versionAt = 0;

const authDir = (id: string) => path.join(AUTH_DIR, id);
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[wa]", ...a);

async function start(accountId: string) {
  const loadAuthState = B.useMultiFileAuthState; // 不是 React Hook，只是名字以 use 开头
  let { state, saveCreds } = await loadAuthState(authDir(accountId));
  // 还没关联成功（没有 account 签名）的半截凭据会让下次走「登录」而不是「注册」，导致配对失败：清掉重来
  if (!state.creds.account) {
    await rm(authDir(accountId), { recursive: true, force: true });
    ({ state, saveCreds } = await loadAuthState(authDir(accountId)));
  }
  // 用 WhatsApp 网页版当前的版本号（6 小时刷新一次）；过旧的版本号会被拒绝关联
  if (!version || Date.now() - versionAt > 6 * 3600_000) {
    const r = await B.fetchLatestWaWebVersion({}).catch(() => null);
    if (r?.isLatest) {
      version = r.version as [number, number, number];
      versionAt = Date.now();
    }
  }
  const client = await clientKind(accountId, !!state.creds.registered);
  const sock = B.makeWASocket({
    auth: state,
    version,
    logger,
    // 扫码登录伪装成桌面版：WhatsApp 只给桌面版推送完整聊天记录。
    // 必须用 Linux 桌面版：macOS / Windows 桌面版加上完整历史会带系统子平台标记，现在会被直接断开（428）。
    // 手机号配对码只能用浏览器（Chrome）：桌面版的配对码会被拒绝，手机上提示「无法关联设备」
    browser: client === "desktop" ? B.Browsers.ubuntu("Desktop") : B.Browsers.macOS("Chrome"),
    markOnlineOnConnect: false,
    // 关联时向手机申请完整历史，并且收下 FULL 类型的历史分片（库默认会丢掉）
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
    generateHighQualityLinkPreview: false,
  });
  const session: Session = { sock, open: false, qrCount: 0, pairRequested: false };
  sessions.set(accountId, session);
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    try {
      if (u.qr) {
        session.qrCount++;
        const account = await prisma.waAccount.findUnique({ where: { id: accountId }, select: { pairPhone: true } });
        const pairPhone = account?.pairPhone;
        // 二维码大约 20 秒刷新一次，5 次（约 2 分钟）没扫 / 没输入配对码就停下，等用户重新获取
        if (session.qrCount > 5) {
          await prisma.waAccount.update({
            where: { id: accountId },
            data: { enabled: false, status: "DISCONNECTED", qr: null, pairCode: null, lastError: pairPhone ? "配对码已过期，请重新获取" : "二维码已过期，请重新获取" },
          });
          sock.end(undefined);
          return;
        }
        if (pairPhone) {
          // 手机号配对码登录：连接就绪（出现二维码事件）后申请一次 8 位配对码，在手机上输入即可
          if (!session.pairRequested && !sock.authState.creds.registered) {
            session.pairRequested = true;
            try {
              const code = await sock.requestPairingCode(pairPhone);
              await prisma.waAccount.update({ where: { id: accountId }, data: { status: "CONNECTING", qr: null, pairCode: code, qrAt: new Date(), lastError: null } });
              log(accountId, "pairing code issued");
            } catch (e) {
              log(accountId, "pairing code failed", (e as Error).message);
              await prisma.waAccount.update({
                where: { id: accountId },
                data: { enabled: false, status: "DISCONNECTED", pairCode: null, lastError: "获取配对码失败，请检查手机号（需带国家码）后重试，或改用扫码登录" },
              });
              sock.end(undefined);
            }
          }
        } else {
          await prisma.waAccount.update({ where: { id: accountId }, data: { status: "CONNECTING", qr: u.qr, qrAt: new Date(), lastError: null } });
        }
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
            pairCode: null,
            lastError: null,
            connectedAt: new Date(),
            phone: me?.id ? B.jidNormalizedUser(me.id).split("@")[0] : undefined,
            name: me?.name ?? me?.notify ?? undefined,
          },
        });
        // 第一次连上（刚关联）：开始记录历史同步进度
        const acc = await prisma.waAccount.findUnique({ where: { id: accountId }, select: { syncStatus: true } });
        if (!acc?.syncStatus) {
          historyComplete.delete(accountId);
          lastHistoryAt.set(accountId, Date.now());
          await prisma.waAccount.update({
            where: { id: accountId },
            data: { syncStatus: "syncing", syncProgress: null, syncMessages: 0, syncStartedAt: new Date(), syncDoneAt: null },
          });
        }
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
            data: { status: "DISCONNECTED", enabled: false, qr: null, pairCode: null, phone: null, lastError: "已在手机上退出登录，请重新登录", syncStatus: null, syncProgress: null, syncMessages: 0, syncStartedAt: null, syncDoneAt: null, avatarKey: null, avatarAt: null },
          });
          return;
        }
        if (code === B.DisconnectReason.restartRequired) return; // 扫码成功后的正常重启，立即重连
        // 还没关联就被 WhatsApp 断开：桌面版身份被拒了，改回浏览器身份，保证还能拿到二维码
        if (code === B.DisconnectReason.connectionClosed && client === "desktop" && !sock.authState.creds.registered && !session.qrCount) {
          desktopRejected.add(accountId);
          log(accountId, "desktop identity rejected, falling back to browser");
        }
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

  sock.ev.on("messages.upsert", ({ messages, type }) =>
    enqueue(accountId, async () => {
      for (const msg of messages) {
        try {
          await storeIncoming(sock, accountId, msg, type === "notify");
        } catch (e) {
          log(accountId, "store error", (e as Error).message);
        }
      }
    }),
  );

  // 关联后 WhatsApp 会分批推送最近的聊天记录、会话和通讯录
  sock.ev.on("messaging-history.set", ({ chats, contacts, messages, progress, syncType }) => {
    lastHistoryAt.set(accountId, Date.now());
    return enqueue(accountId, async () => {
      lastHistoryAt.set(accountId, Date.now());
      await rememberContacts(accountId, contacts);
      const sorted = [...messages].sort((a, b) => Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0));
      let stored = 0;
      for (const msg of sorted) {
        try {
          if (await storeIncoming(sock, accountId, msg, false)) stored++;
        } catch (e) {
          log(accountId, "history store error", (e as Error).message);
        }
      }
      // 未读数以手机上的为准
      for (const c of chats) {
        if (!c.id || !isDirect(c.id)) continue;
        const unread = Math.max(0, Number(c.unreadCount ?? 0));
        await prisma.waChat.updateMany({ where: { accountId, jid: c.id }, data: { unread } });
        if (c.name) await nameChat(accountId, [c.id], c.name, true);
      }
      lastHistoryAt.set(accountId, Date.now());
      await prisma.waAccount.update({
        where: { id: accountId },
        data: {
          syncMessages: { increment: stored },
          ...(progress != null ? { syncProgress: Math.min(100, Math.round(progress)) } : {}),
        },
      });
      log(accountId, "history", syncType, `chunk messages=${messages.length} stored=${stored} chats=${chats.length} contacts=${contacts.length} progress=${progress ?? "-"}`);
    });
  });
  sock.ev.on("messaging-history.status", ({ syncType, status }) => {
    log(accountId, "history status", syncType, status);
    if (status === "complete") historyComplete.add(accountId);
  });
  sock.ev.on("contacts.upsert", (cs) => enqueue(accountId, () => rememberContacts(accountId, cs)));
  sock.ev.on("contacts.update", (cs) =>
    enqueue(accountId, async () => {
      await rememberContacts(accountId, cs as Contact[]);
      // 对方换了头像：下一轮重新拉
      const changed = cs.filter((c) => c.id && c.imgUrl !== undefined).map((c) => c.id!);
      if (changed.length) await prisma.waChat.updateMany({ where: { accountId, jid: { in: changed } }, data: { avatarAt: null } });
    }),
  );
}

/**
 * 这个账号用哪种客户端身份连接。关联时按登录方式决定（扫码 → 桌面版，配对码 → 浏览器），
 * 写进凭据目录，之后每次重连保持一致。老账号没有记录，沿用当时的浏览器身份。
 */
async function clientKind(accountId: string, registered: boolean): Promise<"desktop" | "browser"> {
  const file = path.join(authDir(accountId), "client.txt");
  const saved = (await readFile(file, "utf8").catch(() => "")).trim();
  if (saved === "desktop" || saved === "browser") return saved;
  if (registered) return "browser";
  // 未关联的凭据目录每次重连都会清掉，所以「桌面版被拒」记在内存里
  if (desktopRejected.has(accountId)) return "browser";
  const account = await prisma.waAccount.findUnique({ where: { id: accountId }, select: { pairPhone: true } });
  const kind = account?.pairPhone ? "browser" : "desktop";
  await writeFile(file, kind).catch(() => {});
  return kind;
}

const isDirect = (jid: string) => jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");

/** 记住通讯录名字，并更新已有会话的显示名（手机里存的名字优先于对方自己设的昵称） */
async function rememberContacts(accountId: string, contacts: Partial<Contact>[]) {
  const names = contactNames.get(accountId) ?? new Map<string, string>();
  contactNames.set(accountId, names);
  for (const c of contacts) {
    const name = c.name || c.notify || c.verifiedName;
    const ids = [c.id, c.lid, c.phoneNumber].filter((x): x is string => !!x && isDirect(x));
    if (!name || !ids.length) continue;
    for (const id of ids) if (c.name || !names.has(id)) names.set(id, name);
    await nameChat(accountId, ids, name, !!c.name);
  }
}

async function nameChat(accountId: string, jids: string[], name: string, saved: boolean) {
  const phones = jids.filter((j) => j.endsWith("@s.whatsapp.net")).map((j) => j.split("@")[0].split(":")[0]);
  await prisma.waChat.updateMany({
    where: { accountId, OR: [{ jid: { in: jids } }, ...(phones.length ? [{ phone: { in: phones } }] : [])], ...(saved ? {} : { name: null }) },
    data: { name: name.slice(0, 100) },
  });
}

type Media = { mime: string; name: string | null; size: number | null };
type Content = { type: string; body: string; media?: Media };

const media = (m: { mimetype?: string | null; fileLength?: unknown; fileName?: string | null } | null | undefined, fallback: string): Media => ({
  mime: (m?.mimetype || fallback).split(";")[0].trim(),
  name: m?.fileName ?? null,
  size: m?.fileLength != null ? Number(m.fileLength) : null,
});

function contentOf(msg: WAMessage): Content | null {
  const content = B.normalizeMessageContent(msg.message);
  const kind = B.getContentType(content);
  if (!content || !kind) return null;
  switch (kind) {
    case "conversation":
      return { type: "text", body: content.conversation ?? "" };
    case "extendedTextMessage":
      return { type: "text", body: content.extendedTextMessage?.text ?? "" };
    case "imageMessage":
      return { type: "image", body: `[图片] ${content.imageMessage?.caption ?? ""}`.trim(), media: media(content.imageMessage, "image/jpeg") };
    case "videoMessage":
      return { type: "video", body: `[视频] ${content.videoMessage?.caption ?? ""}`.trim(), media: media(content.videoMessage, "video/mp4") };
    case "audioMessage":
      return { type: "audio", body: "[语音]", media: media(content.audioMessage, "audio/ogg") };
    case "documentMessage":
      return { type: "document", body: `[文件] ${content.documentMessage?.fileName ?? ""}`.trim(), media: media(content.documentMessage, "application/octet-stream") };
    case "documentWithCaptionMessage": {
      const d = content.documentWithCaptionMessage?.message?.documentMessage;
      return { type: "document", body: `[文件] ${d?.fileName ?? ""}`.trim(), media: media(d, "application/octet-stream") };
    }
    case "stickerMessage":
      return { type: "sticker", body: "[表情]", media: media(content.stickerMessage, "image/webp") };
    case "locationMessage":
      return { type: "other", body: "[位置]" };
    case "contactMessage":
      return { type: "other", body: `[名片] ${content.contactMessage?.displayName ?? ""}`.trim() };
    default:
      return null; // 回执、撤回、表态等不入库
  }
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "application/pdf": "pdf",
};
/** 单个媒体文件最大 64MB；超过 7 天的历史消息不下载 */
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const MEDIA_MAX_AGE = 7 * 24 * 3600_000;

/** 下载图片 / 视频 / 语音 / 文件，存到 <tenantId>/wa/<messageId>.<ext> */
async function saveMedia(sock: WASocket, msg: WAMessage, row: { id: string; tenantId: string; timestamp: Date }, m: Media) {
  if (m.size && m.size > MAX_MEDIA_BYTES) return;
  if (Date.now() - row.timestamp.getTime() > MEDIA_MAX_AGE) return;
  const buf = await B.downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
  if (buf.length > MAX_MEDIA_BYTES) return;
  const ext = EXT[m.mime] ?? (/\.([a-z0-9]{1,8})$/i.exec(m.name ?? "")?.[1]?.toLowerCase() || "bin");
  const key = `${row.tenantId}/wa/${row.id}.${ext}`;
  await putObject(key, buf, { contentType: m.mime });
  await prisma.waMessage.update({
    where: { id: row.id },
    data: { mediaKey: key, mediaMime: m.mime, mediaName: m.name?.slice(0, 200) ?? null, mediaSize: buf.length },
  });
}

/** 消息里引用（回复）的那条消息的 WhatsApp id */
function quotedStanzaId(msg: WAMessage): string | null {
  const content = B.normalizeMessageContent(msg.message);
  const kind = content && B.getContentType(content);
  if (!content || !kind) return null;
  const inner = content[kind] as { contextInfo?: { stanzaId?: string | null } | null } | null | undefined;
  return (inner && typeof inner === "object" && inner.contextInfo?.stanzaId) || null;
}

/** 存一条消息，返回是否新入库 */
async function storeIncoming(sock: WASocket, accountId: string, msg: WAMessage, live: boolean): Promise<boolean> {
  const jid = msg.key.remoteJid;
  if (!jid || !msg.key.id || !isDirect(jid)) return false; // 群聊、状态、频道、广播不入库
  const c = contentOf(msg);
  if (!c) return false;

  const account = tenantOf.get(accountId) ?? (await prisma.waAccount.findUnique({ where: { id: accountId }, select: { tenantId: true, userId: true } }));
  if (!account) return false;
  tenantOf.set(accountId, account);
  const exists = await prisma.waMessage.findUnique({ where: { accountId_waId: { accountId, waId: msg.key.id } }, select: { id: true } });
  if (exists) return false;

  const alt = msg.key.remoteJidAlt;
  let pn = jid.endsWith("@s.whatsapp.net") ? jid : alt?.endsWith("@s.whatsapp.net") ? alt : null;
  // 只有 LID 时，用 WhatsApp 下发的 LID ↔ 手机号映射还原号码
  if (!pn && jid.endsWith("@lid")) pn = await sock.signalRepository.lidMapping.getPNForLID(jid).catch(() => null);
  const phone = pn ? pn.split("@")[0].split(":")[0] : null;
  const fromMe = !!msg.key.fromMe;
  const ts = new Date(Number(msg.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000);
  const names = contactNames.get(accountId);
  const savedName = names?.get(jid) ?? (pn ? names?.get(`${phone}@s.whatsapp.net`) : undefined);

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
        name: savedName ?? (fromMe ? null : msg.pushName || null),
        customerId: match?.customerId ?? null,
        contactId: match?.id ?? null,
      },
    });
  } else if (!chat.customerId && phone) {
    const match = await matchContactByPhone(account.tenantId, phone);
    if (match) chat = await prisma.waChat.update({ where: { id: chat.id }, data: { customerId: match.customerId, contactId: match.id } });
  }

  // 对方 / 自己在手机上「回复」某条消息：记下被引用的那条
  const quotedWaId = quotedStanzaId(msg);
  const quoted = quotedWaId
    ? await prisma.waMessage.findUnique({ where: { accountId_waId: { accountId, waId: quotedWaId } }, select: { id: true } })
    : null;

  let row;
  try {
    row = await prisma.waMessage.create({
      data: {
        tenantId: account.tenantId,
        accountId,
        chatId: chat.id,
        waId: msg.key.id,
        fromMe,
        type: c.type,
        body: c.body.slice(0, 20_000),
        status: fromMe ? "SENT" : "RECEIVED",
        quotedId: quoted?.id ?? null,
        timestamp: ts,
      },
    });
  } catch {
    return false; // 并发重复
  }
  const newer = !chat.lastMessageAt || chat.lastMessageAt <= ts;
  await prisma.waChat.update({
    where: { id: chat.id },
    data: {
      ...(newer ? { lastMessageAt: ts, lastText: c.body.slice(0, 200), lastFromMe: fromMe } : {}),
      ...(!fromMe && live ? { unread: { increment: 1 } } : {}),
      ...(!chat.name && (savedName || (!fromMe && msg.pushName)) ? { name: savedName || msg.pushName } : {}),
      ...(phone && !chat.phone ? { phone } : {}),
    },
  });
  if (fromMe && chat.customerId) await logOutgoing(account.tenantId, chat.customerId, account.userId, c.body, ts);
  else if (chat.customerId) await touchCustomer(account.tenantId, chat.customerId, ts, ["lastWaAt"]);
  if (c.media) {
    await saveMedia(sock, msg, row, c.media).catch((e) => log(accountId, "media download failed", (e as Error).message));
  }
  return true;
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
  await touchCustomer(tenantId, customerId, at, ["lastWaAt"]);
}

/** 待发消息转成 WhatsApp 消息内容：文字，或带说明的图片 / 视频 / 文件 */
async function outgoingContent(m: { type: string; body: string; mediaKey: string | null; mediaMime: string | null; mediaName: string | null }) {
  if (!m.mediaKey) return { text: m.body };
  const buf = await getObject(m.mediaKey);
  const caption = m.body || undefined;
  if (m.type === "image") return { image: buf, caption, mimetype: m.mediaMime ?? undefined };
  if (m.type === "video") return { video: buf, caption, mimetype: m.mediaMime ?? undefined };
  if (m.type === "audio") return { audio: buf, mimetype: m.mediaMime ?? "audio/ogg" };
  return { document: buf, caption, mimetype: m.mediaMime ?? "application/octet-stream", fileName: m.mediaName ?? "file" };
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
      const q = m.quotedId ? await prisma.waMessage.findUnique({ where: { id: m.quotedId } }) : null;
      // 回复：带上被引用消息的 key，对方手机上会显示引用条
      const quoted = q?.waId
        ? ({ key: { remoteJid: m.chat.jid, id: q.waId, fromMe: q.fromMe }, message: { conversation: q.body.slice(0, 500) } } as WAMessage)
        : undefined;
      await s.sock.sendMessage(m.chat.jid, await outgoingContent(m), { messageId: waId, quoted });
      await prisma.waMessage.update({ where: { id: m.id }, data: { status: "SENT", timestamp: new Date() } });
      const label = m.mediaKey ? `${{ image: "[图片]", video: "[视频]", audio: "[语音]" }[m.type] ?? `[文件] ${m.mediaName ?? ""}`} ${m.body}`.trim() : m.body;
      if (m.chat.customerId) await logOutgoing(m.tenantId, m.chat.customerId, m.sentById ?? m.account.userId, label, new Date());
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
        data: { logoutRequested: false, enabled: false, status: "DISCONNECTED", qr: null, pairCode: null, phone: null, name: null, lastError: null, syncStatus: null, syncProgress: null, syncMessages: 0, syncStartedAt: null, syncDoneAt: null, avatarKey: null, avatarAt: null },
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
      await prisma.waAccount.update({ where: { id: a.id }, data: { status: "DISCONNECTED", qr: null, pairCode: null } });
    } else if (!a.enabled && a.status !== "DISCONNECTED") {
      await prisma.waAccount.update({ where: { id: a.id }, data: { status: "DISCONNECTED", qr: null, pairCode: null } });
    }
  }
  // 账号被删掉了
  for (const [id, s] of sessions) {
    if (!accounts.some((a) => a.id === id)) {
      s.sock.end(undefined);
      sessions.delete(id);
    }
  }
  await finishSyncs(accounts);
  await sendQueued();
}

/**
 * 历史同步收尾：收到「完成」信号且 15 秒没有新分片，或 5 分钟没有任何分片，就算同步完成。
 * （完整历史分片之间可能隔得比较久；worker 重启后分片不会续传，靠 5 分钟兜底收尾）
 */
async function finishSyncs(accounts: { id: string; syncStatus: string | null; syncStartedAt: Date | null }[]) {
  for (const a of accounts) {
    if (a.syncStatus !== "syncing") continue;
    const last = lastHistoryAt.get(a.id) ?? a.syncStartedAt?.getTime() ?? 0;
    const idle = Date.now() - last;
    if ((historyComplete.has(a.id) && idle > 15_000) || idle > 300_000) {
      historyComplete.delete(a.id);
      lastHistoryAt.delete(a.id);
      await prisma.waAccount.update({ where: { id: a.id }, data: { syncStatus: "done", syncProgress: 100, syncDoneAt: new Date() } });
      log(a.id, "history sync done");
    }
  }
}

/** 下载头像存到 <tenantId>/wa/avatars/<id>.jpg；对方没设头像或隐私不可见时返回 null */
async function fetchAvatar(sock: WASocket, jid: string, tenantId: string, id: string) {
  const url = await sock.profilePictureUrl(jid, "image", 10_000).catch(() => undefined);
  if (!url) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 5 * 1024 * 1024) return null;
  const key = `${tenantId}/wa/avatars/${id}.jpg`;
  await putObject(key, buf, { contentType: res.headers.get("content-type")?.split(";")[0] || "image/jpeg" });
  return key;
}

/** 头像：自己的 + 最近活跃的会话，每轮最多拉 6 个，3 天刷新一次 */
export async function refreshWaAvatars() {
  const stale = new Date(Date.now() - 3 * 24 * 3600_000);
  for (const [accountId, s] of sessions) {
    if (!s.open) continue;
    const account = await prisma.waAccount.findUnique({ where: { id: accountId }, select: { tenantId: true, avatarAt: true } });
    if (!account) continue;
    if (!account.avatarAt || account.avatarAt < stale) {
      const me = s.sock.user?.id ? B.jidNormalizedUser(s.sock.user.id) : null;
      const key = me ? await fetchAvatar(s.sock, me, account.tenantId, `me-${accountId}`).catch(() => null) : null;
      await prisma.waAccount.update({ where: { id: accountId }, data: { avatarKey: key, avatarAt: new Date() } });
    }
    const chats = await prisma.waChat.findMany({
      where: { accountId, lastMessageAt: { not: null }, OR: [{ avatarAt: null }, { avatarAt: { lt: stale } }] },
      orderBy: { lastMessageAt: "desc" },
      take: 6,
      select: { id: true, jid: true, phone: true },
    });
    for (const c of chats) {
      const key =
        (await fetchAvatar(s.sock, c.jid, account.tenantId, c.id).catch(() => null)) ??
        (c.phone && c.jid.endsWith("@lid") ? await fetchAvatar(s.sock, `${c.phone}@s.whatsapp.net`, account.tenantId, c.id).catch(() => null) : null);
      await prisma.waChat.update({ where: { id: c.id }, data: { avatarKey: key, avatarAt: new Date() } });
    }
  }
}

export function shutdownWhatsapp() {
  for (const s of sessions.values()) s.sock.end(undefined);
  sessions.clear();
}
