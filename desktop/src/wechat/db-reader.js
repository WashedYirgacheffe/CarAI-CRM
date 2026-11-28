// 纯 Node.js 微信 3.x / 4.x 本地只读 SQLCipher 解密与全量历史消息读取引擎（零原生编译依赖、零修改微信原文件）
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const PAGE_SIZE = 4096;

/**
 * 验证某个 64 位 Hex Key 能否解密给定的微信数据库文件第 1 页，并自动识别加密规格：
 * - v4-raw:   SQLCipher 4 Raw Key（微信 4.x 内存直接缓存的 32B enc_key，reserve=80, HMAC-SHA512）
 * - v4-kdf:   SQLCipher 4 Passphrase Key（PBKDF2-HMAC-SHA512, 256000 次, reserve=80）
 * - v4-sha256: SQLCipher 4 变体（PBKDF2-HMAC-SHA256, 256000 次, reserve=48）
 * - v3-kdf:   SQLCipher 3（微信 3.x：PBKDF2-HMAC-SHA1, 64000 次, reserve=48）
 */
export function detectCipherSpec(dbPath, hexKey) {
  const cleanHex = String(hexKey || "").trim().replace(/^x'|'$/gi, "").replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(cleanHex)) return null;
  const keyBuf = Buffer.from(cleanHex, "hex");

  const fd = fs.openSync(dbPath, "r");
  const page1 = Buffer.alloc(PAGE_SIZE);
  try {
    const n = fs.readSync(fd, page1, 0, PAGE_SIZE, 0);
    if (n < PAGE_SIZE) return null;
  } finally {
    fs.closeSync(fd);
  }

  // 如果文件本身已是明文 SQLite
  if (page1.subarray(0, 16).equals(SQLITE_HEADER)) {
    return { mode: "plain" };
  }

  const salt = page1.subarray(0, 16);
  const macSalt = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) macSalt[i] = salt[i] ^ 0x3a;

  const verifyHmac = (macKey, hmacAlg, reserveSize, hmacLen) => {
    const encryptedEnd = PAGE_SIZE - reserveSize + 16; // 含 16B IV
    const expectedMac = page1.subarray(encryptedEnd, encryptedEnd + hmacLen);
    const hmac = crypto.createHmac(hmacAlg, macKey);
    hmac.update(page1.subarray(16, encryptedEnd));
    const pageNo = Buffer.alloc(4);
    pageNo.writeUInt32LE(1, 0);
    hmac.update(pageNo);
    const actual = hmac.digest();
    return actual.equals(expectedMac);
  };

  // 1) 微信 4.x Raw Key（最快：只需 2 次 HMAC 迭代派生 macKey）
  try {
    const macKey = crypto.pbkdf2Sync(keyBuf, macSalt, 2, 32, "sha512");
    if (verifyHmac(macKey, "sha512", 80, 64)) {
      return { mode: "cipher", encKey: keyBuf, reserve: 80, hmacAlg: "sha512", version: 4 };
    }
  } catch {
    /* continue */
  }

  // 2) 微信 4.x SQLCipher 4 (PBKDF2-SHA512 256000)
  try {
    const encKey = crypto.pbkdf2Sync(keyBuf, salt, 256000, 32, "sha512");
    const macKey = crypto.pbkdf2Sync(encKey, macSalt, 2, 32, "sha512");
    if (verifyHmac(macKey, "sha512", 80, 64)) {
      return { mode: "cipher", encKey, reserve: 80, hmacAlg: "sha512", version: 4 };
    }
  } catch {
    /* continue */
  }

  // 3) 微信 3.x SQLCipher 3 (PBKDF2-SHA1 64000)
  try {
    const encKey = crypto.pbkdf2Sync(keyBuf, salt, 64000, 32, "sha1");
    const macKey = crypto.pbkdf2Sync(encKey, macSalt, 2, 32, "sha1");
    if (verifyHmac(macKey, "sha1", 48, 20)) {
      return { mode: "cipher", encKey, reserve: 48, hmacAlg: "sha1", version: 3 };
    }
  } catch {
    /* continue */
  }

  // 4) 备选：SQLCipher 4 SHA256 变体
  try {
    const encKey = crypto.pbkdf2Sync(keyBuf, salt, 256000, 32, "sha256");
    const macKey = crypto.pbkdf2Sync(encKey, macSalt, 2, 32, "sha256");
    if (verifyHmac(macKey, "sha256", 48, 32)) {
      return { mode: "cipher", encKey, reserve: 48, hmacAlg: "sha256", version: 4 };
    }
  } catch {
    /* continue */
  }

  return null;
}

/** 只读解密单个 SQLCipher 数据库文件到目标临时路径（不修改原文件） */
export function decryptDatabaseFile(srcPath, destPath, hexKey) {
  if (!fs.existsSync(srcPath)) return false;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const raw = fs.readFileSync(srcPath);
  if (raw.length < PAGE_SIZE) return false;

  if (raw.subarray(0, 16).equals(SQLITE_HEADER)) {
    fs.writeFileSync(destPath, raw);
    return true;
  }

  const spec = detectCipherSpec(srcPath, hexKey);
  if (!spec || spec.mode !== "cipher") return false;

  const { encKey, reserve } = spec;
  const totalPages = Math.floor(raw.length / PAGE_SIZE);
  const out = Buffer.alloc(totalPages * PAGE_SIZE);

  for (let p = 0; p < totalPages; p++) {
    const offset = p * PAGE_SIZE;
    const page = raw.subarray(offset, offset + PAGE_SIZE);
    const dataStart = p === 0 ? 16 : 0;
    const dataEnd = PAGE_SIZE - reserve;
    const iv = page.subarray(dataEnd, dataEnd + 16);
    const cipherData = page.subarray(dataStart, dataEnd);

    const decipher = crypto.createDecipheriv("aes-256-cbc", encKey, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(cipherData), decipher.final()]);

    if (p === 0) {
      SQLITE_HEADER.copy(out, offset);
      decrypted.copy(out, offset + 16);
    } else {
      decrypted.copy(out, offset);
    }
    // 尾部保留 0 填充（标准 SQLite 页尾）
  }

  fs.writeFileSync(destPath, out);
  return true;
}

function decodeContent(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  let buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (buf.length >= 4 && buf.subarray(0, 4).equals(ZSTD_MAGIC) && typeof zlib.zstdDecompressSync === "function") {
    try {
      buf = zlib.zstdDecompressSync(buf);
    } catch {
      /* 解压失败按原始字节处理 */
    }
  }
  return buf.toString("utf8").replace(/\0/g, "").trim();
}

function formatMsgByType(localType, content) {
  const t = Number(localType || 1);
  if (t === 1) return { type: "text", text: content };
  if (t === 3) return { type: "image", text: "[图片]" };
  if (t === 34) return { type: "audio", text: "[语音]" };
  if (t === 43) return { type: "video", text: "[视频]" };
  if (t === 47) return { type: "image", text: "[表情]" };
  if (t === 49) {
    const titleMatch = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(content);
    const title = titleMatch?.[1]?.trim();
    return { type: "document", text: title ? `[文件/链接] ${title}` : "[富媒体/文件]" };
  }
  if (t === 10000) return null; // 系统通知忽略
  return content ? { type: "other", text: content.slice(0, 300) } : null;
}

function md5Hex(str) {
  return crypto.createHash("md5").update(String(str)).digest("hex");
}

function shouldKeepSession(s, remoteCfg) {
  const wxKey = s.wxKey;
  if (!wxKey || /^(gh_|weixin|filehelper$|fmessage|medianote|floatbottle|newsapp|qmessage|qqmail|tmessage|weibo|brandsessionholder)/i.test(wxKey)) {
    // 文件传输助手仅在显式加入白名单时保留，否则过滤系统号/公众号
    if (wxKey !== "filehelper") return false;
  }
  if (remoteCfg.syncMode === "all") return true;
  const remark = s.remark || "";
  const nick = s.name || "";
  const alias = s.wechatNo || "";
  if (remoteCfg.remarkPrefix && remark && remark.startsWith(remoteCfg.remarkPrefix)) return true;
  const wl = remoteCfg.whitelist || { wxKeys: [], wechatNos: [], remarks: [] };
  if (wl.wxKeys.includes(wxKey)) return true;
  if (alias && wl.wechatNos.some((v) => v.toLowerCase() === alias.toLowerCase())) return true;
  if (remark && wl.remarks.some((v) => v.toLowerCase() === remark.toLowerCase())) return true;
  if (nick && wl.remarks.some((v) => v.toLowerCase() === nick.toLowerCase())) return true;
  return false;
}

/**
 * 读取本地微信 4.x 或 3.x 数据库（支持：加密库 + dbKey/keyMap，或已解密明文目录），返回标准 WechatIngestPayload.threads
 */
export async function readLocalWechatHistory({
  dbRoot,
  wxVersion,
  dbKey,
  keyMap,
  decryptedDir,
  cacheDir,
  remoteCfg,
  myWxid,
  maxSessions = 60,
  maxMessagesPerSession = 80,
}) {
  const { DatabaseSync } = await import("node:sqlite");
  const workDir = decryptedDir && fs.existsSync(decryptedDir) ? decryptedDir : path.join(cacheDir, "decrypted");
  const usePlainDir = !!(decryptedDir && fs.existsSync(decryptedDir));

  if (!usePlainDir && (!dbRoot || !fs.existsSync(dbRoot))) {
    throw new Error("未找到本机微信数据库目录");
  }

  const getKeyFor = (relPath) => {
    const norm = relPath.replace(/\\/g, "/").toLowerCase();
    if (keyMap && typeof keyMap === "object") {
      for (const [k, v] of Object.entries(keyMap)) {
        if (k.replace(/\\/g, "/").toLowerCase().endsWith(norm) || norm.endsWith(k.replace(/\\/g, "/").toLowerCase())) {
          return v;
        }
      }
    }
    return dbKey || null;
  };

  const prepareDb = (relCandidates) => {
    for (const rel of relCandidates) {
      if (usePlainDir) {
        const p = path.join(workDir, rel);
        if (fs.existsSync(p)) return p;
        const flat = path.join(workDir, path.basename(rel));
        if (fs.existsSync(flat)) return flat;
      } else {
        const src = path.join(dbRoot, rel);
        if (!fs.existsSync(src)) continue;
        const key = getKeyFor(rel);
        const dest = path.join(workDir, rel);
        if (!key) {
          // 检测是否明文
          const head = Buffer.alloc(16);
          const fd = fs.openSync(src, "r");
          fs.readSync(fd, head, 0, 16, 0);
          fs.closeSync(fd);
          if (head.equals(SQLITE_HEADER)) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
            return dest;
          }
          continue;
        }
        if (decryptDatabaseFile(src, dest, key)) return dest;
      }
    }
    return null;
  };

  // 自动判断 v4 还是 v3
  const isV4 = wxVersion === 4 || fs.existsSync(path.join(usePlainDir ? workDir : dbRoot, "contact", "contact.db"));

  if (isV4) {
    return readV4Databases({ DatabaseSync, prepareDb, dbRoot: usePlainDir ? workDir : dbRoot, remoteCfg, myWxid, maxSessions, maxMessagesPerSession });
  }
  return readV3Databases({ DatabaseSync, prepareDb, dbRoot: usePlainDir ? workDir : dbRoot, remoteCfg, maxSessions, maxMessagesPerSession });
}

function readV4Databases({ DatabaseSync, prepareDb, dbRoot, remoteCfg, myWxid, maxSessions, maxMessagesPerSession }) {
  const contactPath = prepareDb(["contact/contact.db", "contact.db"]);
  const sessionPath = prepareDb(["session/session.db", "session.db"]);

  if (!contactPath && !sessionPath) {
    throw new Error("未能解密微信 4.x 数据库，请先获取或填写有效的 64 位数据库密钥（或指定已解密目录）");
  }

  // 1) 加载联系人字典
  const contacts = new Map();
  if (contactPath) {
    const db = new DatabaseSync(contactPath, { open: true, readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      const tbl = tables.find((t) => /^contact$/i.test(t)) || tables.find((t) => /contact/i.test(t));
      if (tbl) {
        const cols = db.prepare(`PRAGMA table_info("${tbl}")`).all().map((c) => c.name);
        const colUser = cols.find((c) => /^(username|user_name)$/i.test(c));
        const colAlias = cols.find((c) => /^alias$/i.test(c));
        const colRemark = cols.find((c) => /^(remark|con_remark)$/i.test(c));
        const colNick = cols.find((c) => /^(nick_name|nickname)$/i.test(c));
        if (colUser) {
          const rows = db
            .prepare(`SELECT "${colUser}" AS u, ${colAlias ? `"${colAlias}"` : "''"} AS a, ${colRemark ? `"${colRemark}"` : "''"} AS r, ${colNick ? `"${colNick}"` : "''"} AS n FROM "${tbl}"`)
            .all();
          for (const r of rows) {
            if (!r.u) continue;
            contacts.set(String(r.u), {
              wechatNo: r.a ? String(r.a).trim() : "",
              remark: r.r ? String(r.r).trim() : "",
              name: r.n ? String(r.n).trim() : "",
            });
          }
        }
      }
    } finally {
      db.close();
    }
  }

  // 2) 加载近期会话顺序
  const sessions = [];
  if (sessionPath) {
    const db = new DatabaseSync(sessionPath, { open: true, readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      const tbl = tables.find((t) => /session/i.test(t));
      if (tbl) {
        const cols = db.prepare(`PRAGMA table_info("${tbl}")`).all().map((c) => c.name);
        const colUser = cols.find((c) => /^(username|user_name|session_id|strusrname)$/i.test(c));
        const colTime = cols.find((c) => /^(sort_timestamp|last_timestamp|chat_time|norder)$/i.test(c));
        if (colUser) {
          const sql = `SELECT "${colUser}" AS u${colTime ? `, "${colTime}" AS ts` : ""} FROM "${tbl}" ${colTime ? `ORDER BY "${colTime}" DESC` : ""} LIMIT 200`;
          for (const row of db.prepare(sql).all()) {
            const wxKey = String(row.u || "").trim();
            if (!wxKey) continue;
            const c = contacts.get(wxKey) || { wechatNo: "", remark: "", name: "" };
            const item = { wxKey, wechatNo: c.wechatNo, remark: c.remark, name: c.name, isGroup: wxKey.endsWith("@chatroom") };
            if (shouldKeepSession(item, remoteCfg)) sessions.push(item);
          }
        }
      }
    } finally {
      db.close();
    }
  }

  // 若 session.db 为空则退回到联系人表
  if (sessions.length === 0) {
    for (const [wxKey, c] of contacts.entries()) {
      const item = { wxKey, wechatNo: c.wechatNo, remark: c.remark, name: c.name, isGroup: wxKey.endsWith("@chatroom") };
      if (shouldKeepSession(item, remoteCfg)) sessions.push(item);
      if (sessions.length >= maxSessions) break;
    }
  }

  const targetSessions = sessions.slice(0, maxSessions);
  const md5ToSession = new Map(targetSessions.map((s) => [`msg_${md5Hex(s.wxKey)}`, s]));

  // 3) 扫描所有 message_*.db 分片库提取历史消息
  const msgDir = path.join(dbRoot, "message");
  const msgRelFiles = [];
  if (fs.existsSync(msgDir)) {
    for (const f of fs.readdirSync(msgDir)) {
      if (/^message_\d+\.db$/i.test(f)) msgRelFiles.push(`message/${f}`);
    }
  } else if (fs.existsSync(dbRoot)) {
    for (const f of fs.readdirSync(dbRoot)) {
      if (/^message_\d+\.db$/i.test(f)) msgRelFiles.push(f);
    }
  }

  const threadMessages = new Map();
  const cleanMyWxid = myWxid ? myWxid.replace(/_[a-z0-9]{4,}$/i, "") : "";

  for (const rel of msgRelFiles) {
    const decPath = prepareDb([rel]);
    if (!decPath) continue;
    const db = new DatabaseSync(decPath, { open: true, readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      // 加载 Name2Id 映射（用于区分我方发送还是对方发送）
      const idToUser = new Map();
      if (tables.includes("Name2Id")) {
        for (const row of db.prepare("SELECT rowid, user_name FROM Name2Id").all()) {
          idToUser.set(Number(row.rowid), String(row.user_name || ""));
        }
      }

      for (const tbl of tables) {
        const s = md5ToSession.get(tbl.toLowerCase());
        if (!s) continue;
        const cols = db.prepare(`PRAGMA table_info("${tbl}")`).all().map((c) => c.name);
        const colId = cols.find((c) => /^(server_id|local_id)$/i.test(c)) || "local_id";
        const colType = cols.find((c) => /^local_type$/i.test(c));
        const colSender = cols.find((c) => /^real_sender_id$/i.test(c));
        const colTime = cols.find((c) => /^create_time$/i.test(c));
        const colContent = cols.find((c) => /^message_content$/i.test(c));
        if (!colContent || !colTime) continue;

        const rows = db
          .prepare(
            `SELECT "${colId}" AS mid, ${colType ? `"${colType}"` : "1"} AS ltype, ${colSender ? `"${colSender}"` : "0"} AS sid, "${colTime}" AS ct, "${colContent}" AS body FROM "${tbl}" ORDER BY "${colTime}" DESC LIMIT ${maxMessagesPerSession}`,
          )
          .all()
          .reverse();

        const list = threadMessages.get(s.wxKey) || [];
        for (const r of rows) {
          const decoded = decodeContent(r.body);
          const formatted = formatMsgByType(r.ltype, decoded);
          if (!formatted || !formatted.text) continue;
          const senderUser = idToUser.get(Number(r.sid)) || "";
          let fromMe = false;
          if (cleanMyWxid && senderUser) {
            fromMe = senderUser.toLowerCase() === cleanMyWxid.toLowerCase();
          } else if (senderUser && !s.isGroup) {
            fromMe = senderUser !== s.wxKey;
          }
          const senderInfo = senderUser ? contacts.get(senderUser) : null;
          list.push({
            wxMsgId: r.mid ? `v4:${s.wxKey}:${r.mid}` : undefined,
            fromMe,
            senderName: !fromMe && s.isGroup ? senderInfo?.remark || senderInfo?.name || senderUser || undefined : undefined,
            type: formatted.type,
            text: formatted.text.slice(0, 8000),
            at: Number(r.ct) > 0 ? Number(r.ct) * 1000 : undefined,
          });
        }
        threadMessages.set(s.wxKey, list);
      }
    } finally {
      db.close();
    }
  }

  return targetSessions
    .map((s) => ({
      wxKey: s.wxKey,
      wechatNo: s.wechatNo || undefined,
      remark: s.remark || undefined,
      name: s.name || undefined,
      isGroup: s.isGroup,
      messages: (threadMessages.get(s.wxKey) || []).slice(-maxMessagesPerSession),
    }))
    .filter((t) => t.messages.length > 0);
}

function readV3Databases({ DatabaseSync, prepareDb, dbRoot, remoteCfg, maxSessions, maxMessagesPerSession }) {
  const microPath = prepareDb(["MicroMsg.db"]);
  if (!microPath) {
    throw new Error("未能解密微信 3.x MicroMsg.db，请检查 64 位数据库密钥");
  }

  const contacts = new Map();
  {
    const db = new DatabaseSync(microPath, { open: true, readOnly: true });
    try {
      const rows = db.prepare("SELECT UserName, Alias, Remark, NickName FROM Contact").all();
      for (const r of rows) {
        if (!r.UserName) continue;
        contacts.set(String(r.UserName), {
          wechatNo: r.Alias ? String(r.Alias).trim() : "",
          remark: r.Remark ? String(r.Remark).trim() : "",
          name: r.NickName ? String(r.NickName).trim() : "",
        });
      }
    } finally {
      db.close();
    }
  }

  const multiDir = path.join(dbRoot, "Multi");
  const msgFiles = [];
  if (fs.existsSync(multiDir)) {
    for (const f of fs.readdirSync(multiDir)) {
      if (/^MSG\d+\.db$/i.test(f)) msgFiles.push(`Multi/${f}`);
    }
  }
  msgFiles.sort().reverse(); // 最新的 MSG 分片优先

  const byTalker = new Map();
  for (const rel of msgFiles.slice(0, 4)) {
    const decPath = prepareDb([rel]);
    if (!decPath) continue;
    const db = new DatabaseSync(decPath, { open: true, readOnly: true });
    try {
      const rows = db
        .prepare("SELECT MsgSvrID, Type, IsSender, CreateTime, StrTalker, StrContent FROM MSG ORDER BY CreateTime DESC LIMIT 3000")
        .all();
      for (const r of rows) {
        const wxKey = String(r.StrTalker || "").trim();
        if (!wxKey) continue;
        const c = contacts.get(wxKey) || { wechatNo: "", remark: "", name: "" };
        const sessionObj = { wxKey, wechatNo: c.wechatNo, remark: c.remark, name: c.name, isGroup: wxKey.endsWith("@chatroom") };
        if (!shouldKeepSession(sessionObj, remoteCfg)) continue;
        const formatted = formatMsgByType(r.Type, decodeContent(r.StrContent));
        if (!formatted || !formatted.text) continue;
        const arr = byTalker.get(wxKey) || [];
        if (arr.length >= maxMessagesPerSession) continue;
        arr.push({
          wxMsgId: r.MsgSvrID ? `v3:${r.MsgSvrID}` : undefined,
          fromMe: Number(r.IsSender) === 1,
          type: formatted.type,
          text: formatted.text.slice(0, 8000),
          at: Number(r.CreateTime) > 0 ? Number(r.CreateTime) * 1000 : undefined,
        });
        byTalker.set(wxKey, arr);
      }
    } finally {
      db.close();
    }
  }

  return Array.from(byTalker.entries())
    .slice(0, maxSessions)
    .map(([wxKey, msgs]) => {
      const c = contacts.get(wxKey) || { wechatNo: "", remark: "", name: "" };
      return {
        wxKey,
        wechatNo: c.wechatNo || undefined,
        remark: c.remark || undefined,
        name: c.name || undefined,
        isGroup: wxKey.endsWith("@chatroom"),
        messages: msgs.reverse(),
      };
    });
}
