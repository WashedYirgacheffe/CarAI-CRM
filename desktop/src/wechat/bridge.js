// 跨平台微信本地桥接核心（v0.3.1）：
// 可调同步频率（默认 8s）+ 发送后 30s 密集回执拉取 + 同会话免重复搜索 + 图片/视频/文件/头像 IPC + 实时推送刷新
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Notification, safeStorage, shell } from "electron";
import * as winAdapter from "./win.js";
import * as macAdapter from "./mac.js";
import { detectCipherSpec, prepareDecryptedDb, readLocalWechatHistory } from "./db-reader.js";
import { scanWechatKeys } from "./key-scanner.js";
import {
  decodeWechatDatBuffer,
  detectAccountXorKey,
  findLocalFilePath,
  findLocalImageCandidates,
  findLocalVideoMedia,
  readLocalHeadImageDataUrl,
  scanWechatImageAesKey,
} from "./media-reader.js";

const DEFAULT_CHATLOG_URL = "http://127.0.0.1:5030";
const DEFAULT_SYNC_INTERVAL_SEC = 8;

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

function clampIntervalSec(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SYNC_INTERVAL_SEC;
  return Math.max(5, Math.min(60, Math.round(n)));
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    const dbKey = decStr(raw.dbKeyEnc);
    const imgAesKey = decStr(raw.imgAesKeyEnc);
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
      syncIntervalSec: clampIntervalSec(raw.syncIntervalSec),
      dataDir: typeof raw.dataDir === "string" ? raw.dataDir : null,
      decryptedDir: typeof raw.decryptedDir === "string" && raw.decryptedDir.trim() ? raw.decryptedDir.trim() : null,
      dbKey,
      imgAesKey,
      keyMap,
    };
  } catch {
    return {
      chatlogUrl: DEFAULT_CHATLOG_URL,
      autoSync: true,
      syncIntervalSec: DEFAULT_SYNC_INTERVAL_SEC,
      dataDir: null,
      decryptedDir: null,
      dbKey: null,
      imgAesKey: null,
      keyMap: null,
    };
  }
}

function saveLocalConfig(patch) {
  const cur = loadConfig();
  const nextDbKey = patch.dbKey !== undefined ? (String(patch.dbKey || "").trim() || null) : cur.dbKey;
  const nextImgAesKey = patch.imgAesKey !== undefined ? (String(patch.imgAesKey || "").trim() || null) : cur.imgAesKey;
  const nextKeyMap = patch.keyMap !== undefined ? patch.keyMap : cur.keyMap;
  const next = {
    chatlogUrl: typeof patch.chatlogUrl === "string" ? patch.chatlogUrl.trim().replace(/\/+$/, "") || DEFAULT_CHATLOG_URL : cur.chatlogUrl,
    autoSync: typeof patch.autoSync === "boolean" ? patch.autoSync : cur.autoSync,
    syncIntervalSec: patch.syncIntervalSec !== undefined ? clampIntervalSec(patch.syncIntervalSec) : cur.syncIntervalSec,
    dataDir: patch.dataDir !== undefined ? (String(patch.dataDir || "").trim() || null) : cur.dataDir,
    decryptedDir: patch.decryptedDir !== undefined ? (String(patch.decryptedDir || "").trim() || null) : cur.decryptedDir,
    dbKeyEnc: encStr(nextDbKey),
    imgAesKeyEnc: encStr(nextImgAesKey),
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
  constructor({ crmUrl, onChange, onSynced }) {
    this.crmUrl = crmUrl;
    this.onChange = onChange || (() => {});
    this.onSynced = onSynced || (() => {});
    this.token = null;
    this.timer = null;
    this.burstTimer = null;
    this.burstTicks = 0;
    this.syncing = false;
    this.lastSyncAt = null;
    this.lastError = null;
    this.syncSource = "none";
    this.imgKeyPromise = null;
    this.detCache = null;
    this.accountXorKey = undefined;
    // 记录最近一次在微信里定位过的联系人，连续跟同一个人聊天时跳过重复搜索
    this.lastLocatedKey = null;
    this.lastLocatedAt = 0;
  }

  start(token) {
    this.token = token;
    this.restartTimer();
    setTimeout(() => void this.syncNow({ silent: true }), 3_000);
  }

  stop() {
    this.token = null;
    this.stopTimer();
    this.stopBurst();
  }

  restartTimer() {
    this.stopTimer();
    const cfg = loadConfig();
    if (this.token && cfg.autoSync) {
      this.timer = setInterval(() => void this.syncNow({ silent: true }), cfg.syncIntervalSec * 1000);
    }
  }

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  stopBurst() {
    if (this.burstTimer) {
      clearInterval(this.burstTimer);
      this.burstTimer = null;
    }
    this.burstTicks = 0;
  }

  /** 一键上屏后启动 30 秒密集拉取（每 2 秒一次），一旦捕获到已发出回执立即停止并通知界面刷新 */
  startPostSendBurst() {
    if (!this.token) return;
    this.stopBurst();
    this.burstTicks = 0;
    this.burstTimer = setInterval(async () => {
      this.burstTicks += 1;
      if (this.burstTicks > 15) {
        this.stopBurst();
        return;
      }
      const res = await this.syncNow({ silent: true });
      if (res.ok && (res.confirmed ?? 0) > 0) {
        this.stopBurst();
      }
    }, 2_000);
  }

  async detectCached(force = false) {
    if (!force && this.detCache && Date.now() - this.detCache.at < 15_000) {
      return this.detCache.data;
    }
    const data = await adapter().detectWechat();
    this.detCache = { at: Date.now(), data };
    return data;
  }

  getAccountXorKey(accountDir) {
    if (this.accountXorKey !== undefined) return this.accountXorKey;
    const k = detectAccountXorKey(accountDir);
    if (k !== null) this.accountXorKey = k;
    return k;
  }

  async getStatus() {
    const det = await this.detectCached(true);
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
      wxVersionString: det.wxVersionString ?? null,
      wxid: det.wxid ?? null,
      dataDir: cfg.dataDir || det.dataDir,
      dbRoot: det.dbRoot ?? null,
      decryptedDir: cfg.decryptedDir || "",
      hasDbKey: hasLocalKey,
      keyCount: cfg.keyMap ? Object.keys(cfg.keyMap).length : cfg.dbKey ? 1 : 0,
      syncSource: this.syncSource,
      syncIntervalSec: cfg.syncIntervalSec,
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
        error: "Mac 暂不支持自动连接，请在高级设置中配置。",
      };
    }
    const det = await this.detectCached(true);
    const res = await scanWechatKeys(det);
    if (res.ok) {
      saveLocalConfig({ dbKey: res.dbKey, keyMap: res.keyMap });
      this.lastError = null;
      this.onChange();
      const synced = await this.syncNow({ silent: true });
      return {
        ok: true,
        method: res.method,
        wxVersionString: res.wxVersionString,
        matchedCount: res.matchedCount,
        totalCount: res.totalCount,
        inserted: synced.ok ? synced.inserted : 0,
      };
    }
    return res;
  }

  async saveConfig(patch) {
    if (patch.dbKey && String(patch.dbKey).trim()) {
      const clean = String(patch.dbKey).trim().replace(/^x'|'$/gi, "").replace(/^0x/i, "");
      if (!/^[0-9a-f]{64}$/i.test(clean)) {
        return { ok: false, error: "密钥格式不正确，应为 64 位字符" };
      }
      patch.dbKey = clean.toLowerCase();
      const det = await this.detectCached(true);
      if (det.dbRoot) {
        const probeFiles = [
          path.join(det.dbRoot, "contact", "contact.db"),
          path.join(det.dbRoot, "session", "session.db"),
          path.join(det.dbRoot, "MicroMsg.db"),
        ].filter((p) => fs.existsSync(p));
        if (probeFiles.length > 0 && !probeFiles.some((p) => detectCipherSpec(p, patch.dbKey))) {
          return { ok: false, error: "该密钥与当前登录的微信账号不匹配" };
        }
      }
    }

    saveLocalConfig(patch);
    this.restartTimer();
    return { ok: true };
  }

  async stageSend(opts) {
    // 连续给同一个联系人发消息（90 秒内），自动跳过重复 Ctrl+F 搜索，减少不必要操作
    const reqKey = opts.autoLocate && opts.searchKey ? String(opts.searchKey).trim() : "";
    const sameRecent = reqKey && this.lastLocatedKey === reqKey && Date.now() - this.lastLocatedAt < 90_000;
    const effectiveOpts = sameRecent ? { ...opts, autoLocate: false, searchKey: undefined } : opts;

    if (process.platform === "win32") {
      try {
        const focused = BrowserWindow.getFocusedWindow();
        if (focused && !focused.isDestroyed()) focused.blur();
      } catch { /* ignore */ }
    }

    const res = await adapter().stageSend(effectiveOpts);
    if (res.ok) {
      if (reqKey) {
        this.lastLocatedKey = reqKey;
        this.lastLocatedAt = Date.now();
      }
      if (sameRecent && res.mode === "pasted") {
        res.hint = `已直接填入「${reqKey}」聊天框，请核对后按回车发送`;
      }
      // 发送后开启 30 秒密集拉取，发出后 2-3 秒自动确认「已发出」
      this.startPostSendBurst();
    }

    const focusedWechat = res.mode === "located_and_pasted" || res.mode === "pasted";
    if (res.ok && res.hint && !focusedWechat && Notification.isSupported()) {
      try {
        new Notification({ title: "车车 CRM · 微信", body: res.hint }).show();
      } catch { /* ignore */ }
    }
    return res;
  }

  /** 本机只读加载图片或视频封面（零上传） */
  async loadMedia(mediaMeta) {
    if (!mediaMeta) return { ok: false, reason: "no_meta" };
    const det = await this.detectCached();
    const cfg = loadConfig();
    const accountDir = cfg.dataDir || det.dataDir;
    if (!accountDir) return { ok: false, reason: "no_account_dir" };

    // 1) 视频消息：加载未加密的 .jpg 封面图并探测 .mp4 是否已在本地
    if (mediaMeta.kind === "video") {
      const { thumbPath, videoPath } = findLocalVideoMedia(accountDir, mediaMeta);
      let dataUrl = null;
      if (thumbPath) {
        try {
          const buf = fs.readFileSync(thumbPath);
          const mime = thumbPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
          dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
        } catch { /* ignore */ }
      }
      if (!dataUrl && !videoPath) return { ok: false, reason: "not_downloaded" };
      return { ok: true, dataUrl, filePath: videoPath || thumbPath, hasVideoFile: !!videoPath };
    }

    // 2) 图片消息
    if (mediaMeta.kind !== "image" || (!mediaMeta.md5 && !mediaMeta.thumbMd5)) {
      return { ok: false, reason: "no_md5" };
    }

    const mediaCacheDir = path.join(cacheDir(), "media");
    const cacheKey = String(mediaMeta.md5 || mediaMeta.thumbMd5).toLowerCase();
    for (const ext of ["jpg", "png", "gif", "webp"]) {
      const cached = path.join(mediaCacheDir, `${cacheKey}.${ext}`);
      if (fs.existsSync(cached)) {
        const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        const buf = fs.readFileSync(cached);
        return { ok: true, dataUrl: `data:${mime};base64,${buf.toString("base64")}`, filePath: cached };
      }
    }

    const candidates = findLocalImageCandidates(accountDir, mediaMeta);
    if (candidates.length === 0) return { ok: false, reason: "not_downloaded" };

    const xorKey = this.getAccountXorKey(accountDir);
    let currentAesKey = cfg.imgAesKey;

    for (const datPath of candidates) {
      let raw;
      try {
        raw = fs.readFileSync(datPath);
      } catch {
        continue;
      }
      let decoded = decodeWechatDatBuffer(raw, currentAesKey, xorKey);

      if (decoded?.needAesKey && decoded.probeBlock && process.platform === "win32" && det.pids?.length) {
        if (!this.imgKeyPromise) {
          this.imgKeyPromise = scanWechatImageAesKey({ pids: det.pids, probeBlock: decoded.probeBlock }).finally(() => {
            this.imgKeyPromise = null;
          });
        }
        const aesKey = await this.imgKeyPromise;
        if (aesKey) {
          currentAesKey = aesKey;
          saveLocalConfig({ imgAesKey: aesKey });
          decoded = decodeWechatDatBuffer(raw, aesKey, xorKey);
        }
      }

      if (decoded?.buf) {
        fs.mkdirSync(mediaCacheDir, { recursive: true });
        const outPath = path.join(mediaCacheDir, `${cacheKey}.${decoded.ext}`);
        fs.writeFileSync(outPath, decoded.buf);
        return {
          ok: true,
          dataUrl: `data:${decoded.mime};base64,${decoded.buf.toString("base64")}`,
          filePath: outPath,
        };
      }
    }

    return { ok: false, reason: "need_view_in_wechat" };
  }

  /** 用本机默认应用打开图片、视频或文件 */
  async openMedia(mediaMeta, reveal = false) {
    if (!mediaMeta) return { ok: false, error: "缺少媒体信息" };
    const det = await this.detectCached();
    const cfg = loadConfig();
    const accountDir = cfg.dataDir || det.dataDir;
    if (!accountDir) return { ok: false, error: "未找到本机微信目录" };

    if (mediaMeta.kind === "image") {
      const loaded = await this.loadMedia(mediaMeta);
      if (!loaded.ok || !loaded.filePath) {
        return { ok: false, error: "请先在微信里点开这张图片加载一次，然后再重试" };
      }
      if (reveal) {
        shell.showItemInFolder(loaded.filePath);
        return { ok: true };
      }
      const err = await shell.openPath(loaded.filePath);
      return err ? { ok: false, error: err } : { ok: true };
    }

    if (mediaMeta.kind === "video") {
      const { videoPath, thumbPath } = findLocalVideoMedia(accountDir, mediaMeta);
      const target = videoPath || thumbPath;
      if (!target) {
        return { ok: false, error: "该视频尚未在微信中下载，请先在微信点击播放一次" };
      }
      if (!videoPath) {
        return { ok: false, error: "视频尚未完整下载，请先在微信中点击播放一次" };
      }
      if (reveal) {
        shell.showItemInFolder(videoPath);
        return { ok: true };
      }
      const err = await shell.openPath(videoPath);
      return err ? { ok: false, error: err } : { ok: true };
    }

    if (mediaMeta.kind === "file") {
      const filePath = findLocalFilePath(accountDir, mediaMeta);
      if (!filePath) {
        return { ok: false, error: "该文件尚未在微信下载，请先在微信聊天中点击接收下载" };
      }
      if (reveal) {
        shell.showItemInFolder(filePath);
        return { ok: true, filePath };
      }
      const err = await shell.openPath(filePath);
      return err ? { ok: false, error: err } : { ok: true, filePath };
    }

    return { ok: false, error: "暂不支持打开该内容" };
  }

  async loadAvatar(wxKey) {
    if (!wxKey) return { ok: false };
    const det = await this.detectCached();
    const cfg = loadConfig();
    const headDb = prepareDecryptedDb({
      rel: "head_image/head_image.db",
      dbRoot: det.dbRoot,
      decryptedDir: cfg.decryptedDir,
      cacheDir: cacheDir(),
      dbKey: cfg.dbKey,
      keyMap: cfg.keyMap,
    });
    if (!headDb) return { ok: false };
    const dataUrl = await readLocalHeadImageDataUrl(headDb, wxKey);
    return dataUrl ? { ok: true, dataUrl } : { ok: false };
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
    if (!this.token) return { ok: false, error: "桌面端尚未登录" };
    if (this.syncing) return { ok: true, inserted: 0, confirmed: 0 };
    this.syncing = true;
    try {
      const det = await this.detectCached();
      const localCfg = loadConfig();

      const cfgRes = await fetch(`${this.crmUrl}/api/wechat/config`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!cfgRes.ok) throw new Error(`同步配置失败 (HTTP ${cfgRes.status})`);
      const remoteCfg = await cfgRes.json();

      const hasLocalKey = !!(localCfg.dbKey || (localCfg.keyMap && Object.keys(localCfg.keyMap).length > 0));
      const hasDecryptedDir = !!(localCfg.decryptedDir && fs.existsSync(localCfg.decryptedDir));

      let threads = [];
      let accountAvatarUrl;
      let activeSource = "none";

      if (hasLocalKey || hasDecryptedDir) {
        activeSource = "native-db";
        const readRes = await readLocalWechatHistory({
          dbRoot: det.dbRoot,
          wxVersion: det.wxVersion,
          dbKey: localCfg.dbKey,
          keyMap: localCfg.keyMap,
          decryptedDir: localCfg.decryptedDir,
          cacheDir: cacheDir(),
          remoteCfg,
          myWxid: det.wxid,
        });
        threads = readRes.threads || [];
        accountAvatarUrl = readRes.accountAvatarUrl;
      } else {
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
              avatarUrl: accountAvatarUrl,
              platform: det.platform,
              status: activeSource !== "none" ? "SYNCING" : "READY",
              lastError: null,
            },
            threads: chunk,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!ingestRes.ok) throw new Error(`消息同步失败 (HTTP ${ingestRes.status})`);
        const out = await ingestRes.json();
        totalInserted += out.inserted ?? 0;
        totalConfirmed += out.confirmed ?? 0;
      }

      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      this.onChange();

      // 有新消息或已自动确认发出时，主动推送给渲染页自动刷新
      if (totalInserted > 0 || totalConfirmed > 0) {
        this.onSynced({ inserted: totalInserted, confirmed: totalConfirmed });
      }

      if (!silent && activeSource === "none") {
        return {
          ok: false,
          error: "尚未连接本机微信，请点击右上角「设置」→「一键自动连接微信」。",
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
