// 跨平台微信本地桥接核心（v0.2.7）：内置纯 Node SQLCipher 只读解密 + 密钥扫描 + chatlog 兼容 + 零串框半自动上屏
import fs from "node:fs";
import path from "node:path";
import { app, Notification, safeStorage } from "electron";
import * as winAdapter from "./win.js";
import * as macAdapter from "./mac.js";
import { detectCipherSpec, readLocalWechatHistory } from "./db-reader.js";
import { scanWechatKeys } from "./key-scanner.js";

const DEFAULT_CHATLOG_URL = "http://127.0.0.1:5030";
const SYNC_INTERVAL_MS = 20_000;

function adapter() {
  if (process.platform === "win32") return winAdapter;
  if (process.platform === "darwin") return macAdapter;
  return {
    detectWechat: async () => ({ platform: process.platform, wechatInstalled: false, wechatRunning: false, dataDir: null, dbRoot: null, wxVersion: null }),
    stageSend: async () => ({ ok: false, error: `暂不支持当前系统 (${process.platform})` }),
  };
}

function configFile() {
  return path.join(app.getPath("userData"), "wechat.json");
}

function cacheDir() {
  return path.join(app.getPath("userData"), "wechat-cache");
}

function encStr(plain) {
  if (!plain) return null;
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString("base64");
  }
  return `plain:${plain}`;
}

function decStr(stored) {
  if (!stored || typeof stored !== "string") return null;
  if (stored.startsWith("plain:")) return stored.slice(6);
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored, "base64"));
    } catch {
      return null;
    }
  }
  return null;
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    const dbKey = decStr(raw.dbKeyEnc);
    const keyMapJson = decStr(raw.keyMapEnc);
    let keyMap = null;
    if (keyMapJson) {
      try {
        keyMap = JSON.parse(keyMapJson);
      } catch {
        keyMap = null;
      }
    }
    return {
      chatlogUrl: typeof raw.chatlogUrl === "string" && raw.chatlogUrl.trim() ? raw.chatlogUrl.trim().replace(/\/+$/, "") : DEFAULT_CHATLOG_URL,
      autoSync: raw.autoSync !== false,
      dataDir: typeof raw.dataDir === "string" ? raw.dataDir : null,
      decryptedDir: typeof raw.decryptedDir === "string" && raw.decryptedDir.trim() ? raw.decryptedDir.trim() : null,
      dbKey,
      keyMap,
    };
  } catch {
    return { chatlogUrl: DEFAULT_CHATLOG_URL, autoSync: true, dataDir: null, decryptedDir: null, dbKey: null, keyMap: null };
  }
}

function saveLocalConfig(patch) {
  const cur = loadConfig();
  const nextDbKey = patch.dbKey !== undefined ? (String(patch.dbKey || "").trim() || null) : cur.dbKey;
  const nextKeyMap = patch.keyMap !== undefined ? patch.keyMap : cur.keyMap;
  const next = {
    chatlogUrl: typeof patch.chatlogUrl === "string" ? patch.chatlogUrl.trim().replace(/\/+$/, "") || DEFAULT_CHATLOG_URL : cur.chatlogUrl,
    autoSync: typeof patch.autoSync === "boolean" ? patch.autoSync : cur.autoSync,
    dataDir: patch.dataDir !== undefined ? (String(patch.dataDir || "").trim() || null) : cur.dataDir,
    decryptedDir: patch.decryptedDir !== undefined ? (String(patch.decryptedDir || "").trim() || null) : cur.decryptedDir,
    dbKeyEnc: encStr(nextDbKey),
    keyMapEnc: nextKeyMap && Object.keys(nextKeyMap).length ? encStr(JSON.stringify(nextKeyMap)) : null,
  };
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return loadConfig();
}

function matchesWhitelist(session, cfg) {
  if (cfg.syncMode === "all") return true;
  const wxKey = String(session.userName || session.talker || session.wxid || "").trim();
  const remark = String(session.remark || session.conRemark || "").trim();
  const nick = String(session.nickName || session.name || "").trim();
  const alias = String(session.alias || session.wechatNo || "").trim();

  if (cfg.remarkPrefix && remark && remark.startsWith(cfg.remarkPrefix)) return true;
  const wl = cfg.whitelist || { wxKeys: [], wechatNos: [], remarks: [] };
  if (wxKey && wl.wxKeys.includes(wxKey)) return true;
  if (alias && wl.wechatNos.some((v) => v.toLowerCase() === alias.toLowerCase())) return true;
  if (remark && wl.remarks.some((v) => v.toLowerCase() === remark.toLowerCase())) return true;
  if (nick && wl.remarks.some((v) => v.toLowerCase() === nick.toLowerCase())) return true;
  return false;
}

export class WechatBridge {
  constructor({ crmUrl, onChange }) {
    this.crmUrl = crmUrl;
    this.onChange = onChange || (() => {});
    this.token = null;
    this.timer = null;
    this.syncing = false;
    this.lastSyncAt = null;
    this.lastError = null;
    this.syncSource = "none";
  }

  start(token) {
    this.token = token;
    this.stopTimer();
    const cfg = loadConfig();
    if (cfg.autoSync) {
      this.timer = setInterval(() => void this.syncNow({ silent: true }), SYNC_INTERVAL_MS);
      setTimeout(() => void this.syncNow({ silent: true }), 4_000);
    }
  }

  stop() {
    this.token = null;
    this.stopTimer();
  }

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getStatus() {
    const det = await adapter().detectWechat();
    const cfg = loadConfig();
    const hasLocalKey = !!(cfg.dbKey || (cfg.keyMap && Object.keys(cfg.keyMap).length > 0));
    const hasDecryptedDir = !!(cfg.decryptedDir && fs.existsSync(cfg.decryptedDir));
    const chatlogAlive = await this.probeChatlog(cfg.chatlogUrl);

    if (hasLocalKey || hasDecryptedDir) this.syncSource = "native-db";
    else if (chatlogAlive) this.syncSource = "chatlog";
    else this.syncSource = "none";

    return {
      platform: det.platform,
      wechatInstalled: det.wechatInstalled,
      wechatRunning: det.wechatRunning,
      wxVersion: det.wxVersion ?? null,
      wxid: det.wxid ?? null,
      dataDir: cfg.dataDir || det.dataDir,
      dbRoot: det.dbRoot ?? null,
      decryptedDir: cfg.decryptedDir || "",
      hasDbKey: hasLocalKey,
      keyCount: cfg.keyMap ? Object.keys(cfg.keyMap).length : cfg.dbKey ? 1 : 0,
      syncSource: this.syncSource,
      chatlogUrl: cfg.chatlogUrl,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      autoSync: cfg.autoSync,
    };
  }

  async extractKey() {
    if (process.platform !== "win32") {
      return {
        ok: false,
        error: "macOS 受系统 SIP 保护不支持直接扫描内存，请填入已获取的 64 位密钥、已解密目录或启动本机 chatlog 服务。",
      };
    }
    const det = await adapter().detectWechat();
    const res = await scanWechatKeys(det);
    if (res.ok) {
      saveLocalConfig({ dbKey: res.dbKey, keyMap: res.keyMap });
      this.lastError = null;
      this.onChange();
      // 提取成功后立刻执行一次全量历史同步！
      const synced = await this.syncNow({ silent: true });
      return {
        ok: true,
        matchedCount: res.matchedCount,
        totalCount: res.totalCount,
        inserted: synced.ok ? synced.inserted : 0,
      };
    }
    return res;
  }

  async saveConfig(patch) {
    // 如果用户手动填了 64 位 dbKey，先校验合法性（若能检测到本地库则顺带测试是否可解密）
    if (patch.dbKey && String(patch.dbKey).trim()) {
      const clean = String(patch.dbKey).trim().replace(/^x'|'$/gi, "").replace(/^0x/i, "");
      if (!/^[0-9a-f]{64}$/i.test(clean)) {
        return { ok: false, error: "数据库密钥格式不正确：应为 64 位十六进制字符串（0-9, a-f）" };
      }
      patch.dbKey = clean.toLowerCase();
      const det = await adapter().detectWechat();
      if (det.dbRoot) {
        const probeFiles = [
          path.join(det.dbRoot, "contact", "contact.db"),
          path.join(det.dbRoot, "session", "session.db"),
          path.join(det.dbRoot, "MicroMsg.db"),
        ].filter((p) => fs.existsSync(p));
        if (probeFiles.length > 0 && !probeFiles.some((p) => detectCipherSpec(p, patch.dbKey))) {
          return { ok: false, error: "该 64 位密钥无法解密当前本机微信数据库，请检查是否与当前登录的微信账号匹配。" };
        }
      }
    }

    const next = saveLocalConfig(patch);
    if (this.token) {
      this.stopTimer();
      if (next.autoSync) {
        this.timer = setInterval(() => void this.syncNow({ silent: true }), SYNC_INTERVAL_MS);
      }
    }
    return { ok: true };
  }

  async stageSend(opts) {
    const res = await adapter().stageSend(opts);
    if (res.ok && res.hint && Notification.isSupported()) {
      try {
        new Notification({ title: "车车 CRM · 微信一键上屏", body: res.hint }).show();
      } catch {
        /* 忽略系统通知权限未开 */
      }
    }
    return res;
  }

  async probeChatlog(baseUrl) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/session?format=json&limit=1`, { signal: AbortSignal.timeout(1200) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async syncNow({ silent = false } = {}) {
    if (!this.token) return { ok: false, error: "桌面端尚未配对登录" };
    if (this.syncing) return { ok: true, inserted: 0, confirmed: 0 };
    this.syncing = true;
    try {
      const det = await adapter().detectWechat();
      const localCfg = loadConfig();

      const cfgRes = await fetch(`${this.crmUrl}/api/wechat/config`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!cfgRes.ok) throw new Error(`拉取同步配置失败 (HTTP ${cfgRes.status})`);
      const remoteCfg = await cfgRes.json();

      const hasLocalKey = !!(localCfg.dbKey || (localCfg.keyMap && Object.keys(localCfg.keyMap).length > 0));
      const hasDecryptedDir = !!(localCfg.decryptedDir && fs.existsSync(localCfg.decryptedDir));

      let threads = [];
      let activeSource = "none";

      // 优先路线 1：内置纯 Node.js 原生 SQLCipher 只读解密读取全量对话与历史记录
      if (hasLocalKey || hasDecryptedDir) {
        activeSource = "native-db";
        threads = await readLocalWechatHistory({
          dbRoot: det.dbRoot,
          wxVersion: det.wxVersion,
          dbKey: localCfg.dbKey,
          keyMap: localCfg.keyMap,
          decryptedDir: localCfg.decryptedDir,
          cacheDir: cacheDir(),
          remoteCfg,
          myWxid: det.wxid,
        });
      } else {
        // 路线 2：兼容本机运行的 chatlog / WeFlow HTTP 只读服务
        const chatlogAlive = await this.probeChatlog(localCfg.chatlogUrl);
        if (chatlogAlive) {
          activeSource = "chatlog";
          const sessRes = await fetch(`${localCfg.chatlogUrl}/api/v1/session?format=json&limit=100`, {
            signal: AbortSignal.timeout(5000),
          });
          if (sessRes.ok) {
            const rawSessions = await sessRes.json();
            const list = Array.isArray(rawSessions) ? rawSessions : Array.isArray(rawSessions?.items) ? rawSessions.items : [];
            const matched = list.filter((s) => matchesWhitelist(s, remoteCfg)).slice(0, 50);

            for (const s of matched) {
              const talker = String(s.userName || s.talker || s.wxid || "").trim();
              if (!talker) continue;
              const msgRes = await fetch(
                `${localCfg.chatlogUrl}/api/v1/chatlog?talker=${encodeURIComponent(talker)}&format=json&limit=80`,
                { signal: AbortSignal.timeout(5000) },
              ).catch(() => null);
              if (!msgRes || !msgRes.ok) continue;
              const rawMsgs = await msgRes.json().catch(() => []);
              const arr = Array.isArray(rawMsgs) ? rawMsgs : Array.isArray(rawMsgs?.items) ? rawMsgs.items : [];
              const messages = arr
                .map((m) => {
                  const text = String(m.content ?? m.text ?? m.strContent ?? "").trim();
                  if (!text) return null;
                  const ts = Number(m.time ?? m.createTime ?? m.timestamp ?? 0);
                  return {
                    wxMsgId: m.seq ? String(m.seq) : m.id ? String(m.id) : undefined,
                    fromMe: Boolean(m.isSelf ?? m.isSender ?? m.fromMe),
                    senderName: m.senderName ? String(m.senderName) : undefined,
                    type: "text",
                    text,
                    at: ts > 0 ? ts : undefined,
                  };
                })
                .filter(Boolean);

              if (messages.length > 0) {
                threads.push({
                  wxKey: talker,
                  wechatNo: s.alias ? String(s.alias) : undefined,
                  remark: s.remark ? String(s.remark) : s.conRemark ? String(s.conRemark) : undefined,
                  name: s.nickName ? String(s.nickName) : s.name ? String(s.name) : undefined,
                  isGroup: talker.endsWith("@chatroom"),
                  messages,
                });
              }
            }
          }
        }
      }

      this.syncSource = activeSource;

      // 分批上报（避免单次 JSON 过大）
      let totalInserted = 0;
      let totalConfirmed = 0;
      const chunkSize = 25;
      const chunks = threads.length > 0 ? Array.from({ length: Math.ceil(threads.length / chunkSize) }, (_, i) => threads.slice(i * chunkSize, (i + 1) * chunkSize)) : [[]];

      for (const chunk of chunks) {
        const ingestRes = await fetch(`${this.crmUrl}/api/wechat/ingest`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            account: {
              wxid: det.wxid || undefined,
              platform: det.platform,
              status: activeSource !== "none" ? "SYNCING" : "READY",
              lastError: null,
            },
            threads: chunk,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!ingestRes.ok) throw new Error(`上报同步失败 (HTTP ${ingestRes.status})`);
        const out = await ingestRes.json();
        totalInserted += out.inserted ?? 0;
        totalConfirmed += out.confirmed ?? 0;
      }

      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      this.onChange();

      if (!silent && activeSource === "none") {
        return {
          ok: false,
          error: "尚未配置本机微信解密密钥：请点击右上角「设置」→ 点「一键扫描本机微信密钥」或填入 64 位密钥/已解密目录，即可自动读取本机全部历史对话。",
        };
      }
      return { ok: true, threads: threads.length, inserted: totalInserted, confirmed: totalConfirmed };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.lastError = msg;
      this.onChange();
      return { ok: false, error: msg };
    } finally {
      this.syncing = false;
    }
  }
}
