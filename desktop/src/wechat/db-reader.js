// 纯 Node.js 微信 3.x / 4.x 本地只读 SQLCipher 解密与全量历史消息读取引擎
// 特性：零原生编译依赖、零修改微信原文件、支持 SQLCipher 4 -wal 实时帧合并、stat 缓存、
// 完整解析引用回复(type=57)/图片md5/文件元数据/头像URL/免打扰状态/真实未读数
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const PAGE_SIZE = 4096;

const decryptCache = new Map();

function verifyPageHmac(pageBuf, pgno, macKey, hmacAlg, reserveSize, hmacLen) {
  if (!pageBuf || pageBuf.length < PAGE_SIZE) return false;
  const dataStart = pgno === 1 ? 16 : 0;
  const encryptedEnd = PAGE_SIZE - reserveSize + 16;
  const expectedMac = pageBuf.subarray(encryptedEnd, encryptedEnd + hmacLen);
  const hmac = crypto.createHmac(hmacAlg, macKey);
  hmac.update(pageBuf.subarray(dataStart, encryptedEnd));
  const pageNo = Buffer.allocUnsafe(4);
  pageNo.writeUInt32LE(pgno, 0);
  hmac.update(pageNo);
  const actual = hmac.digest();
  return actual.equals(expectedMac);
}

export function verifyRawEncKey(encKeyBuf, page1) {
  if (!encKeyBuf || encKeyBuf.length !== 32 || !page1 || page1.length < PAGE_SIZE) return false;
  if (page1.subarray(0, 16).equals(SQLITE_HEADER)) return false;
  const salt = page1.subarray(0, 16);
  const macSalt = Buffer.allocUnsafe(16);
  for (let i = 0; i < 16; i++) macSalt[i] = salt[i] ^ 0x3a;
  const macKey = crypto.pbkdf2Sync(encKeyBuf, macSalt, 2, 32, "sha512");
  return verifyPageHmac(page1, 1, macKey, "sha512", 80, 64);
}

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

  if (page1.subarray(0, 16).equals(SQLITE_HEADER)) return { mode: "plain" };

  const salt = page1.subarray(0, 16);
  const macSalt = Buffer.allocUnsafe(16);
  for (let i = 0; i < 16; i++) macSalt[i] = salt[i] ^ 0x3a;

  try {
    const macKey = crypto.pbkdf2Sync(keyBuf, macSalt, 2, 32, "sha512");
    if (verifyPageHmac(page1, 1, macKey, "sha512", 80, 64)) {
      return { mode: "cipher", encKey: keyBuf, macKey, reserve: 80, hmacAlg: "sha512", hmacLen: 64, version: 4 };
    }
  } catch { /* continue */ }

  try {
    const encKey = crypto.pbkdf2Sync(keyBuf, salt, 256000, 32, "sha512");
    const macKey = crypto.pbkdf2Sync(encKey, macSalt, 2, 32, "sha512");
    if (verifyPageHmac(page1, 1, macKey, "sha512", 80, 64)) {
      return { mode: "cipher", encKey, macKey, reserve: 80, hmacAlg: "sha512", hmacLen: 64, version: 4 };
    }
  } catch { /* continue */ }

  try {
    const encKey = crypto.pbkdf2Sync(keyBuf, salt, 64000, 32, "sha1");
    const macKey = crypto.pbkdf2Sync(encKey, macSalt, 2, 32, "sha1");
    if (verifyPageHmac(page1, 1, macKey, "sha1", 48, 20)) {
      return { mode: "cipher", encKey, macKey, reserve: 48, hmacAlg: "sha1", hmacLen: 20, version: 3 };
    }
  } catch { /* continue */ }

  try {
    const encKey = crypto.pbkdf2Sync(keyBuf, salt, 256000, 32, "sha256");
    const macKey = crypto.pbkdf2Sync(encKey, macSalt, 2, 32, "sha256");
    if (verifyPageHmac(page1, 1, macKey, "sha256", 48, 32)) {
      return { mode: "cipher", encKey, macKey, reserve: 48, hmacAlg: "sha256", hmacLen: 32, version: 4 };
    }
  } catch { /* continue */ }

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
  if (wal.readUInt32BE(8) !== PAGE_SIZE) return baseTotalPages;

  const hdrSalt1 = wal.readUInt32BE(16);
  const hdrSalt2 = wal.readUInt32BE(20);
  const frameSize = 24 + PAGE_SIZE;

  let txPending = [];
  let maxPages = baseTotalPages;

  for (let off = 32; off + frameSize <= wal.length; off += frameSize) {
    const pgno = wal.readUInt32BE(off);
    const dbSize = wal.readUInt32BE(off + 4);
    const salt1 = wal.readUInt32BE(off + 8);
    const salt2 = wal.readUInt32BE(off + 12);
    if (salt1 !== hdrSalt1 || salt2 !== hdrSalt2 || pgno === 0) break;

    const framePage = wal.subarray(off + 24, off + 24 + PAGE_SIZE);
    if (!verifyPageHmac(framePage, pgno, spec.macKey, spec.hmacAlg, spec.reserve, spec.hmacLen)) break;

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
      decryptSinglePage(raw.subarray(offset, offset + PAGE_SIZE), pgno, encKey, reserve).copy(out, offset);
    }
  }

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
    } catch { /* fallback */ }
  }
  return buf.toString("utf8").replace(/\0/g, "").trim();
}

function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .trim();
}

function xmlTag(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = re.exec(xml);
  return m ? decodeXmlEntities(m[1]) : "";
}

function xmlAttr(xml, attr) {
  const re = new RegExp(`\\b${attr}=["']([^"']+)["']`, "i");
  const m = re.exec(xml);
  return m ? decodeXmlEntities(m[1]) : "";
}

function extractImageMd5(content, packedInfo) {
  const m1 = /\bmd5=["']([0-9a-f]{32})["']/i.exec(content || "");
  if (m1) return m1[1].toLowerCase();
  const m2 = /<md5>([0-9a-f]{32})<\/md5>/i.exec(content || "");
  if (m2) return m2[1].toLowerCase();
  if (packedInfo) {
    const buf = Buffer.isBuffer(packedInfo) ? packedInfo : Buffer.from(packedInfo);
    const ascii = buf.toString("latin1");
    const m3 = /([0-9a-f]{32})/i.exec(ascii);
    if (m3) return m3[1].toLowerCase();
  }
  return null;
}

function formatMonth(tsSec) {
  const d = tsSec > 0 ? new Date(tsSec * 1000) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function summarizeNestedReferContent(rawContent, referType) {
  const clean = decodeXmlEntities(rawContent);
  const rt = Number(referType || 1);
  if (rt === 3) return "[图片]";
  if (rt === 34) return "[语音]";
  if (rt === 43) return "[视频]";
  if (rt === 47) return "[表情]";
  if (clean.startsWith("<") || clean.includes("<appmsg")) {
    const innerTitle = xmlTag(clean, "title");
    if (innerTitle) return innerTitle;
    if (clean.includes("<img")) return "[图片]";
    if (clean.includes("<videomsg")) return "[视频]";
    return "[富媒体消息]";
  }
  // 群聊引用有时自带 "wxid_xxx:\n实际内容"
  const grp = /^[a-zA-Z0-9_-]{3,64}:\n([\s\S]+)$/.exec(clean);
  return (grp ? grp[1] : clean).slice(0, 300);
}

/**
 * 完整解析微信 4.x / 3.x 消息类型与 XML 结构（杜绝原始 XML 泄漏进气泡或被误翻译）
 */
export function parseWechatMessage(localType, content, { packedInfo, chatMd5, createTime } = {}) {
  let baseType = 1;
  let subType = 0;
  try {
    const bi = BigInt(localType ?? 1);
    baseType = Number(bi & 0xffffffffn);
    subType = Number((bi >> 32n) & 0xffffffffn);
  } catch {
    baseType = Number(localType || 1);
  }

  const month = formatMonth(Number(createTime || 0));

  if (baseType === 1) {
    return { type: "text", text: content };
  }
  if (baseType === 3) {
    const md5 = extractImageMd5(content, packedInfo);
    return {
      type: "image",
      text: "[图片]",
      mediaMeta: md5 ? { kind: "image", md5, chatMd5, month } : { kind: "image", chatMd5, month },
    };
  }
  if (baseType === 34) return { type: "audio", text: "[语音]" };
  if (baseType === 43) return { type: "video", text: "[视频]" };
  if (baseType === 47 || baseType === 11000) return { type: "image", text: "[表情]" };
  if (baseType === 48) {
    const label = xmlAttr(content, "label") || xmlAttr(content, "poiname");
    return { type: "other", text: label ? `[位置] ${label}` : "[位置]" };
  }
  if (baseType === 50) return { type: "other", text: "[音视频通话]" };
  if (baseType === 10000 || baseType === 10002) return null; // 系统提示/撤回等忽略

  // 49 = 复合应用消息（引用回复 57、文件 6、链接 5、合并转发 19、小程序 33/36、视频号 51、红包/转账等）
  const looksLikeAppMsg = baseType === 49 || content.includes("<appmsg") || content.includes("<refermsg");
  if (looksLikeAppMsg) {
    const appBlockMatch = /<appmsg[\s\S]*?<\/appmsg>/i.exec(content);
    const appXml = appBlockMatch ? appBlockMatch[0] : content;
    const xmlType = Number(xmlTag(appXml, "type") || subType || 0);
    const effectiveSub = subType || xmlType;

    // 1) 引用回复（subtype=57 或包含 <refermsg>）
    const referMatch = /<refermsg>([\s\S]*?)<\/refermsg>/i.exec(appXml);
    if (effectiveSub === 57 || referMatch) {
      const replyTitle = xmlTag(appXml.replace(/<refermsg>[\s\S]*?<\/refermsg>/i, ""), "title");
      const referXml = referMatch ? referMatch[1] : "";
      const quoteSender = xmlTag(referXml, "displayname") || undefined;
      const referContent = xmlTag(referXml, "content");
      const referType = xmlTag(referXml, "type");
      const quoteText = summarizeNestedReferContent(referContent, referType) || undefined;
      return {
        type: "text",
        text: replyTitle || "[引用回复]",
        quoteSender,
        quoteText,
      };
    }

    // 2) 文件消息（subtype=6）
    if (effectiveSub === 6) {
      const filename = xmlTag(appXml, "title") || "未命名文件";
      const totalLen = Number(xmlTag(appXml, "totallen") || 0) || undefined;
      const ext = xmlTag(appXml, "fileext") || path.extname(filename).replace(/^\./, "") || undefined;
      return {
        type: "document",
        text: `[文件] ${filename}`,
        mediaName: filename,
        mediaSize: totalLen,
        mediaMeta: { kind: "file", filename, ext, size: totalLen, month },
      };
    }

    // 3) 红包 / 转账
    if (content.includes("redenvelope") || effectiveSub === 2001) {
      const title = xmlTag(appXml, "sendertitle") || xmlTag(appXml, "title");
      return { type: "other", text: title ? `[微信红包] ${title}` : "[微信红包]" };
    }
    if (content.includes("wcpay") || effectiveSub === 2000) {
      const fee = xmlTag(appXml, "feedesc");
      return { type: "other", text: fee ? `[微信转账] ${fee}` : "[微信转账]" };
    }

    // 4) 合并转发聊天记录（subtype=19）
    if (effectiveSub === 19) {
      const title = xmlTag(appXml, "title");
      return { type: "other", text: title ? `[聊天记录] ${title}` : "[合并转发的聊天记录]" };
    }

    // 5) 小程序（33 / 36）
    if (effectiveSub === 33 || effectiveSub === 36) {
      const title = xmlTag(appXml, "title") || xmlTag(appXml, "sourcedisplayname");
      return { type: "other", text: title ? `[小程序] ${title}` : "[小程序]" };
    }

    // 6) 视频号（51）
    if (effectiveSub === 51) {
      const nick = xmlTag(appXml, "nickname");
      const desc = xmlTag(appXml, "desc");
      return { type: "other", text: `[视频号] ${[nick, desc].filter(Boolean).join(" · ") || "视频动态"}` };
    }

    // 7) 普通链接卡片 / 其他 appmsg
    const title = xmlTag(appXml, "title");
    const url = xmlTag(appXml, "url");
    if (title) {
      return {
        type: "other",
        text: url ? `[链接] ${title}\n${url}` : `[卡片] ${title}`,
      };
    }
    return { type: "other", text: "[富媒体消息]" };
  }

  // 防御：绝不让未识别的原始 XML 文本直接泄漏进对话气泡
  if (/^\s*(<\?xml|<msg\b|<sysmsg\b)/i.test(content)) {
    const title = xmlTag(content, "title");
    return title ? { type: "other", text: title } : { type: "other", text: "[富媒体消息]" };
  }
  return content ? { type: "other", text: content.slice(0, 300) } : null;
}

function md5Hex(str) {
  return crypto.createHash("md5").update(String(str)).digest("hex");
}

function normalizeAvatarUrl(url) {
  const s = String(url || "").trim();
  if (!s || !/^https?:\/\//i.test(s)) return undefined;
  return s.replace(/^http:\/\//i, "https://");
}

export function normalizeMyWxid(rawDirName) {
  const s = String(rawDirName || "").trim();
  if (!s) return "";
  const m = /^(.+)_[0-9a-f]{4}$/i.exec(s);
  if (m && m[1].toLowerCase() !== "wxid") return m[1];
  return s;
}

function shouldKeepSession(s, remoteCfg) {
  const wxKey = s.wxKey;
  if (!wxKey || /^(gh_|weixin|filehelper$|fmessage|medianote|floatbottle|newsapp|qmessage|qqmail|tmessage|weibo|brandsessionholder|brandservicesessionholder|notifymessage|notification_messages|opencustomerservicemsg)/i.test(wxKey)) {
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

export function getKeyForRel(relPath, keyMap, dbKey) {
  const norm = relPath.replace(/\\/g, "/").toLowerCase();
  if (keyMap && typeof keyMap === "object") {
    for (const [k, v] of Object.entries(keyMap)) {
      const kn = k.replace(/\\/g, "/").toLowerCase();
      if (kn === norm || kn.endsWith(`/${norm}`) || norm.endsWith(`/${kn}`)) return v;
    }
  }
  return dbKey || null;
}

export function prepareDecryptedDb({ rel, dbRoot, decryptedDir, cacheDir, dbKey, keyMap }) {
  const workDir = decryptedDir && fs.existsSync(decryptedDir) ? decryptedDir : path.join(cacheDir, "decrypted");
  const usePlainDir = !!(decryptedDir && fs.existsSync(decryptedDir));
  if (usePlainDir) {
    const p = path.join(workDir, rel);
    if (fs.existsSync(p)) return p;
    const flat = path.join(workDir, path.basename(rel));
    if (fs.existsSync(flat)) return flat;
    return null;
  }
  if (!dbRoot || !fs.existsSync(dbRoot)) return null;
  const src = path.join(dbRoot, rel);
  if (!fs.existsSync(src)) return null;
  const key = getKeyForRel(rel, keyMap, dbKey);
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
    return null;
  }
  return decryptDatabaseFile(src, dest, key) ? dest : null;
}

/**
 * 读取本地微信 4.x 或 3.x 数据库，返回 { accountAvatarUrl, threads }
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

  const prepareDb = (relCandidates) => {
    for (const rel of relCandidates) {
      const p = prepareDecryptedDb({ rel, dbRoot, decryptedDir, cacheDir, dbKey, keyMap });
      if (p) return p;
    }
    return null;
  };

  const isV4 = wxVersion === 4 || fs.existsSync(path.join(usePlainDir ? workDir : dbRoot, "contact", "contact.db"));
  if (isV4) {
    return readV4Databases({ DatabaseSync, prepareDb, dbRoot: usePlainDir ? workDir : dbRoot, remoteCfg, myWxid, maxSessions, maxMessagesPerSession });
  }
  const threads = readV3Databases({ DatabaseSync, prepareDb, dbRoot: usePlainDir ? workDir : dbRoot, remoteCfg, maxSessions, maxMessagesPerSession });
  return { accountAvatarUrl: undefined, threads };
}

function readV4Databases({ DatabaseSync, prepareDb, dbRoot, remoteCfg, myWxid, maxSessions, maxMessagesPerSession }) {
  const contactPath = prepareDb(["contact/contact.db", "contact.db"]);
  const sessionPath = prepareDb(["session/session.db", "session.db"]);

  if (!contactPath && !sessionPath) {
    throw new Error("未能解密微信 4.x 数据库，请先点击「一键扫描本机微信密钥」或填写有效的 64 位数据库密钥");
  }

  // 1) 加载联系人字典（含头像 URL 与免打扰标志位）
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
        const colSmallHead = cols.find((c) => /^small_head_url$/i.test(c));
        const colBigHead = cols.find((c) => /^big_head_url$/i.test(c));
        const colFlag = cols.find((c) => /^flag$/i.test(c));
        const colNotify = cols.find((c) => /^(chat_room_notify|chatroom_notify)$/i.test(c));
        if (colUser) {
          const rows = db
            .prepare(
              `SELECT "${colUser}" AS u,
                ${colAlias ? `"${colAlias}"` : "''"} AS a,
                ${colRemark ? `"${colRemark}"` : "''"} AS r,
                ${colNick ? `"${colNick}"` : "''"} AS n,
                ${colSmallHead ? `"${colSmallHead}"` : "''"} AS sh,
                ${colBigHead ? `"${colBigHead}"` : "''"} AS bh,
                ${colFlag ? `"${colFlag}"` : "0"} AS fl,
                ${colNotify ? `"${colNotify}"` : "-1"} AS nt
              FROM "${tbl}"`,
            )
            .all();
          for (const r of rows) {
            if (!r.u) continue;
            contacts.set(String(r.u), {
              wechatNo: r.a ? String(r.a).trim() : "",
              remark: r.r ? String(r.r).trim() : "",
              name: r.n ? String(r.n).trim() : "",
              avatarUrl: normalizeAvatarUrl(r.sh || r.bh),
              flag: Number(r.fl || 0),
              chatRoomNotify: Number(r.nt ?? -1),
            });
          }
        }
      }
    } finally {
      db.close();
    }
  }

  const cleanMyWxid = normalizeMyWxid(myWxid);
  const myInfo = cleanMyWxid ? contacts.get(cleanMyWxid) : null;

  // 2) 加载近期会话顺序 + 微信原生未读数 + 免打扰状态
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
        const colHidden = cols.find((c) => /^is_hidden$/i.test(c));
        const colUnread = cols.find((c) => /^unread_count$/i.test(c));
        const colStatus = cols.find((c) => /^status$/i.test(c));
        const colMuted = cols.find((c) => /^(is_muted|muted|is_notify)$/i.test(c));
        if (colUser) {
          const whereClause = colHidden ? `WHERE "${colHidden}" = 0` : "";
          const sql = `SELECT "${colUser}" AS u
            ${colTime ? `, "${colTime}" AS ts` : ""}
            ${colUnread ? `, "${colUnread}" AS uc` : ", 0 AS uc"}
            ${colStatus ? `, "${colStatus}" AS st` : ", 0 AS st"}
            ${colMuted ? `, "${colMuted}" AS mt` : ", -1 AS mt"}
            FROM "${tbl}" ${whereClause} ${colTime ? `ORDER BY "${colTime}" DESC` : ""} LIMIT 200`;
          for (const row of db.prepare(sql).all()) {
            const wxKey = String(row.u || "").trim();
            if (!wxKey) continue;
            const c = contacts.get(wxKey) || { wechatNo: "", remark: "", name: "", avatarUrl: undefined, flag: 0, chatRoomNotify: -1 };
            const isGroup = wxKey.endsWith("@chatroom");
            // 微信 4.x 免打扰判定：SessionTable.status === 1 或 contact.chat_room_notify === 0 或 contact.flag bit9(0x200)
            const stNum = Number(row.st || 0);
            const mtCol = Number(row.mt ?? -1);
            const muted =
              stNum === 1 ||
              (colMuted && colMuted.toLowerCase() === "is_notify" ? mtCol === 0 : mtCol === 1) ||
              (isGroup && c.chatRoomNotify === 0) ||
              (c.flag & 0x200) !== 0;

            const item = {
              wxKey,
              wechatNo: c.wechatNo,
              remark: c.remark,
              name: c.name,
              avatarUrl: c.avatarUrl,
              isGroup,
              muted,
              wxUnread: Math.max(0, Number(row.uc || 0)),
            };
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
      const isGroup = wxKey.endsWith("@chatroom");
      const item = {
        wxKey,
        wechatNo: c.wechatNo,
        remark: c.remark,
        name: c.name,
        avatarUrl: c.avatarUrl,
        isGroup,
        muted: (isGroup && c.chatRoomNotify === 0) || (c.flag & 0x200) !== 0,
        wxUnread: 0,
      };
      if (shouldKeepSession(item, remoteCfg)) sessions.push(item);
      if (sessions.length >= maxSessions) break;
    }
  }

  const targetSessions = sessions.slice(0, maxSessions);
  const md5ToSession = new Map(targetSessions.map((s) => [`msg_${md5Hex(s.wxKey)}`, { ...s, chatMd5: md5Hex(s.wxKey) }]));

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
        const colCompress = cols.find((c) => /^compress_content$/i.test(c));
        const colPacked = cols.find((c) => /^packed_info_data$/i.test(c));
        if (!colContent || !colTime) continue;

        const rows = db
          .prepare(
            `SELECT "${colId}" AS mid,
              ${colType ? `CAST("${colType}" AS TEXT)` : "'1'"} AS ltype,
              ${colSender ? `"${colSender}"` : "0"} AS sid,
              "${colTime}" AS ct,
              "${colContent}" AS body,
              ${colCompress ? `"${colCompress}"` : "NULL"} AS cbody,
              ${colPacked ? `"${colPacked}"` : "NULL"} AS pinfo
            FROM "${tbl}" ORDER BY "${colTime}" DESC LIMIT ${maxMessagesPerSession}`,
          )
          .all()
          .reverse();

        const list = threadMessages.get(s.wxKey) || [];
        for (const r of rows) {
          let decoded = decodeContent(r.body);
          if (!decoded && r.cbody) decoded = decodeContent(r.cbody);
          let senderUser = idToUser.get(Number(r.sid)) || "";

          if (s.isGroup) {
            const grpPrefix = /^([a-zA-Z0-9_-]{3,64}):\n([\s\S]+)$/.exec(decoded);
            if (grpPrefix) {
              if (!senderUser) senderUser = grpPrefix[1];
              decoded = grpPrefix[2].trim();
            }
          }

          const parsed = parseWechatMessage(r.ltype, decoded, {
            packedInfo: r.pinfo,
            chatMd5: s.chatMd5,
            createTime: r.ct,
          });
          if (!parsed || !parsed.text) continue;

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
            senderAvatar: !fromMe ? senderInfo?.avatarUrl || undefined : undefined,
            type: parsed.type,
            text: parsed.text.slice(0, 8000),
            quoteSender: parsed.quoteSender ? parsed.quoteSender.slice(0, 120) : undefined,
            quoteText: parsed.quoteText ? parsed.quoteText.slice(0, 500) : undefined,
            mediaName: parsed.mediaName ? parsed.mediaName.slice(0, 260) : undefined,
            mediaSize: parsed.mediaSize,
            mediaMeta: parsed.mediaMeta,
            at: Number(r.ct) > 0 ? Number(r.ct) * 1000 : undefined,
          });
        }
        threadMessages.set(s.wxKey, list);
      }
    } finally {
      db.close();
    }
  }

  const threads = targetSessions
    .map((s) => ({
      wxKey: s.wxKey,
      wechatNo: s.wechatNo || undefined,
      remark: s.remark || undefined,
      name: s.name || undefined,
      avatarUrl: s.avatarUrl || undefined,
      isGroup: s.isGroup,
      muted: s.muted,
      wxUnread: s.wxUnread,
      messages: (threadMessages.get(s.wxKey) || []).slice(-maxMessagesPerSession),
    }))
    .filter((t) => t.messages.length > 0);

  return {
    accountAvatarUrl: myInfo?.avatarUrl || undefined,
    threads,
  };
}

function readV3Databases({ DatabaseSync, prepareDb, dbRoot, remoteCfg, maxSessions, maxMessagesPerSession }) {
  const microPath = prepareDb(["MicroMsg.db"]);
  if (!microPath) throw new Error("未能解密微信 3.x MicroMsg.db，请检查 64 位数据库密钥");

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
        const parsed = parseWechatMessage(r.Type, decodeContent(r.StrContent), { createTime: r.CreateTime });
        if (!parsed || !parsed.text) continue;
        const arr = byTalker.get(wxKey) || [];
        if (arr.length >= maxMessagesPerSession) continue;
        arr.push({
          wxMsgId: r.MsgSvrID ? `v3:${r.MsgSvrID}` : undefined,
          fromMe: Number(r.IsSender) === 1,
          type: parsed.type,
          text: parsed.text.slice(0, 8000),
          quoteSender: parsed.quoteSender,
          quoteText: parsed.quoteText,
          mediaName: parsed.mediaName,
          mediaSize: parsed.mediaSize,
          mediaMeta: parsed.mediaMeta,
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
