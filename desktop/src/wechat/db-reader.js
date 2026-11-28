// 纯 Node.js 微信 3.x / 4.x 本地只读 SQLCipher 解密与全量历史消息读取引擎
// 特性：零原生编译依赖、零修改微信原文件、支持 SQLCipher 4 -wal 实时帧合并、stat 缓存避免重复全量解密
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const PAGE_SIZE = 4096;

// 内存级解密缓存：同一数据库主文件 + WAL 文件均未变化时直接复用已解密临时库
const decryptCache = new Map();

function verifyPageHmac(pageBuf, pgno, macKey, hmacAlg, reserveSize, hmacLen) {
  if (!pageBuf || pageBuf.length < PAGE_SIZE) return false;
  const dataStart = pgno === 1 ? 16 : 0;
  const encryptedEnd = PAGE_SIZE - reserveSize + 16; // 含 16B IV
  const expectedMac = pageBuf.subarray(encryptedEnd, encryptedEnd + hmacLen);
  const hmac = crypto.createHmac(hmacAlg, macKey);
  hmac.update(pageBuf.subarray(dataStart, encryptedEnd));
  const pageNo = Buffer.allocUnsafe(4);
  pageNo.writeUInt32LE(pgno, 0);
  hmac.update(pageNo);
  const actual = hmac.digest();
  return actual.equals(expectedMac);
}

/**
 * 极速校验 32 字节 SQLCipher 4 Raw Encryption Key 与数据库第 1 页的 HMAC-SHA512（仅 2 次 PBKDF2，< 0.2ms）
 */
export function verifyRawEncKey(encKeyBuf, page1) {
  if (!encKeyBuf || encKeyBuf.length !== 32 || !page1 || page1.length < PAGE_SIZE) return false;
  if (page1.subarray(0, 16).equals(SQLITE_HEADER)) return false;
  const salt = page1.subarray(0, 16);
  const macSalt = Buffer.allocUnsafe(16);
  for (let i = 0; i < 16; i++) macSalt[i] = salt[i] ^ 0x3a;
  const macKey = crypto.pbkdf2Sync(encKeyBuf, macSalt, 2, 32, "sha512");
  return verifyPageHmac(page1, 1, macKey, "sha512", 80, 64);
}

/**
 * 验证某个 64 位 Hex Key 能否解密给定的微信数据库文件第 1 页，并自动识别加密规格：
 * - v4-raw:    SQLCipher 4 Raw Key（微信 4.0 / 4.1+ 内存提取的 32B enc_key，reserve=80, HMAC-SHA512）
 * - v4-kdf:    SQLCipher 4 Passphrase Key（PBKDF2-HMAC-SHA512, 256000 次, reserve=80）
 * - v3-kdf:    SQLCipher 3（微信 3.x：PBKDF2-HMAC-SHA1, 64000 次, reserve=48）
 * - v4-sha256: SQLCipher 4 变体（PBKDF2-HMAC-SHA256, 256000 次, reserve=48）
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

  if (page1.subarray(0, 16).equals(SQLITE_HEADER)) {
    return { mode: "plain" };
  }

  const salt = page1.subarray(0, 16);
  const macSalt = Buffer.allocUnsafe(16);
  for (let i = 0; i < 16; i++) macSalt[i] = salt[i] ^ 0x3a;

  // 1) 微信 4.x Raw Key（最快：只需 2 次 HMAC 迭代派生 macKey）
  try {
    const macKey = crypto.pbkdf2Sync(keyBuf, macSalt, 2, 32, "sha512");
    if (verifyPageHmac(page1, 1, macKey, "sha512", 80, 64)) {
      return { mode: "cipher", encKey: keyBuf, macKey, reserve: 80, hmacAlg: "sha512", hmacLen: 64, version: 4 };
    }
  } catch {
    /* continue */
  }

  // 2) 微信 4.x SQLCipher 4 Passphrase (PBKDF2-SHA512 256000)
  try {
    const encKey = crypto.pbkdf2Sync(keyBuf, salt, 256000, 32, "sha512");
    const macKey = crypto.pbkdf2Sync(encKey, macSalt, 2, 32, "sha512");
    if (verifyPageHmac(page1, 1, macKey, "sha512", 80, 64)) {
      return { mode: "cipher", encKey, macKey, reserve: 80, hmacAlg: "sha512", hmacLen: 64, version: 4 };
    }
  } catch {
    /* continue */
  }

  // 3) 微信 3.x SQLCipher 3 (PBKDF2-SHA1 64000)
  try {
    const encKey = crypto.pbkdf2Sync(keyBuf, salt, 64000, 32, "sha1");
    const macKey = crypto.pbkdf2Sync(encKey, macSalt, 2, 32, "sha1");
    if (verifyPageHmac(page1, 1, macKey, "sha1", 48, 20)) {
      return { mode: "cipher", encKey, macKey, reserve: 48, hmacAlg: "sha1", hmacLen: 20, version: 3 };
    }
  } catch {
    /* continue */
  }

  // 4) 备选：SQLCipher 4 SHA256 变体
  try {
    const encKey = crypto.pbkdf2Sync(keyBuf, salt, 256000, 32, "sha256");
    const macKey = crypto.pbkdf2Sync(encKey, macSalt, 2, 32, "sha256");
    if (verifyPageHmac(page1, 1, macKey, "sha256", 48, 32)) {
      return { mode: "cipher", encKey, macKey, reserve: 48, hmacAlg: "sha256", hmacLen: 32, version: 4 };
    }
  } catch {
    /* continue */
  }

  return null;
}

function decryptSinglePage(pageBuf, pgno, encKey, reserve) {
  const dataStart = pgno === 1 ? 16 : 0;
  const dataEnd = PAGE_SIZE - reserve;
  const iv = pageBuf.subarray(dataEnd, dataEnd + 16);
  const cipherData = pageBuf.subarray(dataStart, dataEnd);
  const decipher = crypto.createDecipheriv("aes-256-cbc", encKey, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(cipherData), decipher.final()]);
  const out = Buffer.alloc(PAGE_SIZE);
  if (pgno === 1) {
    SQLITE_HEADER.copy(out, 0);
    decrypted.copy(out, 16);
  } else {
    decrypted.copy(out, 0);
  }
  return out;
}

/**
 * 读取并合并 SQLCipher -wal 文件中通过 HMAC 校验的最新提交帧（支持实时读取微信刚收发、尚未 checkpoint 的新消息）
 */
function applyEncryptedWal(walPath, pagesMap, baseTotalPages, spec) {
  if (!fs.existsSync(walPath)) return baseTotalPages;
  let wal;
  try {
    wal = fs.readFileSync(walPath);
  } catch {
    return baseTotalPages;
  }
  if (wal.length < 32 + 24 + PAGE_SIZE) return baseTotalPages;

  const magic = wal.readUInt32BE(0);
  if (magic !== 0x377f0682 && magic !== 0x377f0683) return baseTotalPages;
  const walPageSize = wal.readUInt32BE(8);
  if (walPageSize !== PAGE_SIZE) return baseTotalPages;

  const hdrSalt1 = wal.readUInt32BE(16);
  const hdrSalt2 = wal.readUInt32BE(20);
  const frameSize = 24 + PAGE_SIZE;

  // 逐个事务收集帧，仅在遇到 dbSize > 0（事务提交标记）且全部帧通过 HMAC 校验时原子应用
  let txPending = [];
  let maxPages = baseTotalPages;

  for (let off = 32; off + frameSize <= wal.length; off += frameSize) {
    const pgno = wal.readUInt32BE(off);
    const dbSize = wal.readUInt32BE(off + 4);
    const salt1 = wal.readUInt32BE(off + 8);
    const salt2 = wal.readUInt32BE(off + 12);
    if (salt1 !== hdrSalt1 || salt2 !== hdrSalt2 || pgno === 0) break;

    const framePage = wal.subarray(off + 24, off + 24 + PAGE_SIZE);
    if (!verifyPageHmac(framePage, pgno, spec.macKey, spec.hmacAlg, spec.reserve, spec.hmacLen)) {
      // 碰到半写入/未完整刷盘的帧即停止，保护主库一致性
      break;
    }

    txPending.push({ pgno, framePage });
    if (dbSize > 0) {
      for (const item of txPending) {
        pagesMap.set(item.pgno, decryptSinglePage(item.framePage, item.pgno, spec.encKey, spec.reserve));
        if (item.pgno > maxPages) maxPages = item.pgno;
      }
      if (dbSize > maxPages) maxPages = dbSize;
      txPending = [];
    }
  }
  return maxPages;
}

/** 只读解密单个 SQLCipher 数据库文件（自动合并最新 -wal 帧，并通过 stat 缓存跳过无变化文件） */
export function decryptDatabaseFile(srcPath, destPath, hexKey) {
  if (!fs.existsSync(srcPath)) return false;

  const walPath = `${srcPath}-wal`;
  let stat;
  let walStat = null;
  try {
    stat = fs.statSync(srcPath);
    if (fs.existsSync(walPath)) walStat = fs.statSync(walPath);
  } catch {
    return false;
  }

  const cacheSig = `${stat.mtimeMs}:${stat.size}:${walStat ? `${walStat.mtimeMs}:${walStat.size}` : "0"}:${hexKey}`;
  const cached = decryptCache.get(srcPath);
  if (cached && cached.sig === cacheSig && cached.destPath === destPath && fs.existsSync(destPath)) {
    return true;
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const raw = fs.readFileSync(srcPath);
  if (raw.length < PAGE_SIZE) return false;

  if (raw.subarray(0, 16).equals(SQLITE_HEADER)) {
    fs.writeFileSync(destPath, raw);
    decryptCache.set(srcPath, { sig: cacheSig, destPath });
    return true;
  }

  const spec = detectCipherSpec(srcPath, hexKey);
  if (!spec || spec.mode !== "cipher") return false;

  const { encKey, reserve } = spec;
  const baseTotalPages = Math.floor(raw.length / PAGE_SIZE);
  const walOverrides = new Map();
  const finalTotalPages = applyEncryptedWal(walPath, walOverrides, baseTotalPages, spec);

  const out = Buffer.alloc(finalTotalPages * PAGE_SIZE);
  for (let p = 0; p < finalTotalPages; p++) {
    const pgno = p + 1;
    const offset = p * PAGE_SIZE;
    const walPage = walOverrides.get(pgno);
    if (walPage) {
      walPage.copy(out, offset);
      continue;
    }
    if (p < baseTotalPages) {
      const page = raw.subarray(offset, offset + PAGE_SIZE);
      const dec = decryptSinglePage(page, pgno, encKey, reserve);
      dec.copy(out, offset);
    }
  }

  // 写临时文件后原子替换，避免并发读到半写文件
  const tmpPath = `${destPath}.tmp`;
  fs.writeFileSync(tmpPath, out);
  fs.renameSync(tmpPath, destPath);
  decryptCache.set(srcPath, { sig: cacheSig, destPath });
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

/** 规范化微信 4.x 账号目录名（如 wxid_xxx_a1b2 -> wxid_xxx，但不误伤无后缀的 wxid_xxx） */
export function normalizeMyWxid(rawDirName) {
  const s = String(rawDirName || "").trim();
  if (!s) return "";
  // 仅当末尾是 _ + 4位十六进制哈希，且去掉后缀后仍不是裸 "wxid" 时才剥离
  const m = /^(.+)_[0-9a-f]{4}$/i.exec(s);
  if (m && m[1].toLowerCase() !== "wxid") {
    return m[1];
  }
  return s;
}

function shouldKeepSession(s, remoteCfg) {
  const wxKey = s.wxKey;
  if (!wxKey || /^(gh_|weixin|filehelper$|fmessage|medianote|floatbottle|newsapp|qmessage|qqmail|tmessage|weibo|brandsessionholder)/i.test(wxKey)) {
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
        const kn = k.replace(/\\/g, "/").toLowerCase();
        if (kn === norm || kn.endsWith(`/${norm}`) || norm.endsWith(`/${kn}`)) {
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
    throw new Error("未能解密微信 4.x 数据库，请先点击「一键扫描本机微信密钥」或填写有效的 64 位数据库密钥");
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
  const cleanMyWxid = normalizeMyWxid(myWxid);

  for (const rel of msgRelFiles) {
    const decPath = prepareDb([rel]);
    if (!decPath) continue;
    const db = new DatabaseSync(decPath, { open: true, readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      const idToUser = new Map();
      const name2IdTbl = tables.find((t) => /^name2id$/i.test(t));
      if (name2IdTbl) {
        const nCols = db.prepare(`PRAGMA table_info("${name2IdTbl}")`).all().map((c) => c.name);
        const colName = nCols.find((c) => /^(user_name|username)$/i.test(c)) || nCols[0];
        if (colName) {
          for (const row of db.prepare(`SELECT rowid, "${colName}" AS u FROM "${name2IdTbl}"`).all()) {
            idToUser.set(Number(row.rowid), String(row.u || ""));
          }
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
          let decoded = decodeContent(r.body);
          let senderUser = idToUser.get(Number(r.sid)) || "";

          // 群聊文本首行常见 "wxid_xxx:\n实际内容" 前缀，剥离并还原真实发送者
          if (s.isGroup) {
            const grpPrefix = /^([a-zA-Z0-9_-]{3,64}):\n([\s\S]+)$/.exec(decoded);
            if (grpPrefix) {
              if (!senderUser) senderUser = grpPrefix[1];
              decoded = grpPrefix[2].trim();
            }
          }

          const formatted = formatMsgByType(r.ltype, decoded);
          if (!formatted || !formatted.text) continue;

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
  msgFiles.sort().reverse();

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
