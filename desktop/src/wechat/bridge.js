// 跨平台微信本地桥接核心：统一封装 Win/Mac 适配器 + 白名单只读增量同步（兼容微信 4.0 chatlog 只读服务）
import fs from "node:fs";
import path from "node:path";
import { app, Notification } from "electron";
import * as winAdapter from "./win.js";
import * as macAdapter from "./mac.js";

const DEFAULT_CHATLOG_URL = "http://127.0.0.1:5030";
const SYNC_INTERVAL_MS = 20_000;

function adapter() {
  if (process.platform === "win32") return winAdapter;
  if (process.platform === "darwin") return macAdapter;
  return {
    detectWechat: async () => ({ platform: process.platform, wechatInstalled: false, wechatRunning: false, dataDir: null }),
    stageSend: async () => ({ ok: false, error: `暂不支持当前系统 (${process.platform})` }),
  };
}

function configFile() {
  return path.join(app.getPath("userData"), "wechat.json");
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    return {
      chatlogUrl: typeof raw.chatlogUrl === "string" && raw.chatlogUrl.trim() ? raw.chatlogUrl.trim().replace(/\/+$/, "") : DEFAULT_CHATLOG_URL,
      autoSync: raw.autoSync !== false,
      dataDir: typeof raw.dataDir === "string" ? raw.dataDir : null,
    };
  } catch {
    return { chatlogUrl: DEFAULT_CHATLOG_URL, autoSync: true, dataDir: null };
  }
}

function saveLocalConfig(patch) {
  const cur = loadConfig();
  const next = {
    chatlogUrl: typeof patch.chatlogUrl === "string" ? patch.chatlogUrl.trim().replace(/\/+$/, "") || DEFAULT_CHATLOG_URL : cur.chatlogUrl,
    autoSync: typeof patch.autoSync === "boolean" ? patch.autoSync : cur.autoSync,
    dataDir: patch.dataDir !== undefined ? patch.dataDir : cur.dataDir,
  };
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

/** 判断一个微信会话是否命中业务员的白名单隐私策略 */
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
      // 启动 5 秒后首次心跳/同步，之后每 20 秒轮询一次
      this.timer = setInterval(() => void this.syncNow({ silent: true }), SYNC_INTERVAL_MS);
      setTimeout(() => void this.syncNow({ silent: true }), 5_000);
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
    const chatlogAlive = await this.probeChatlog(cfg.chatlogUrl);
    this.syncSource = chatlogAlive ? "chatlog" : "none";
    return {
      platform: det.platform,
      wechatInstalled: det.wechatInstalled,
      wechatRunning: det.wechatRunning,
      dataDir: cfg.dataDir || det.dataDir,
      syncSource: this.syncSource,
      chatlogUrl: cfg.chatlogUrl,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      autoSync: cfg.autoSync,
    };
  }

  saveConfig(patch) {
    const next = saveLocalConfig(patch);
    if (this.token) {
      this.stopTimer();
      if (next.autoSync) {
        this.timer = setInterval(() => void this.syncNow({ silent: true }), SYNC_INTERVAL_MS);
      }
    }
    return { ok: true, config: next };
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
      const res = await fetch(`${baseUrl}/api/v1/session?format=json&limit=1`, { signal: AbortSignal.timeout(1500) });
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

      // 1) 从 CRM 拉取白名单配置
      const cfgRes = await fetch(`${this.crmUrl}/api/wechat/config`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!cfgRes.ok) throw new Error(`拉取同步配置失败 (HTTP ${cfgRes.status})`);
      const remoteCfg = await cfgRes.json();

      // 2) 探测本机 chatlog 只读服务（兼容微信 4.0 Win/Mac）
      const chatlogAlive = await this.probeChatlog(localCfg.chatlogUrl);
      this.syncSource = chatlogAlive ? "chatlog" : "none";

      const threads = [];
      if (chatlogAlive) {
        const sessRes = await fetch(`${localCfg.chatlogUrl}/api/v1/session?format=json&limit=100`, {
          signal: AbortSignal.timeout(5000),
        });
        if (sessRes.ok) {
          const rawSessions = await sessRes.json();
          const list = Array.isArray(rawSessions) ? rawSessions : Array.isArray(rawSessions?.items) ? rawSessions.items : [];
          const matched = list.filter((s) => matchesWhitelist(s, remoteCfg)).slice(0, 40);

          for (const s of matched) {
            const talker = String(s.userName || s.talker || s.wxid || "").trim();
            if (!talker) continue;
            const msgRes = await fetch(
              `${localCfg.chatlogUrl}/api/v1/chatlog?talker=${encodeURIComponent(talker)}&format=json&limit=50`,
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

      // 3) 上报心跳与增量消息给 CRM
      const ingestRes = await fetch(`${this.crmUrl}/api/wechat/ingest`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          account: {
            platform: det.platform,
            status: det.wechatRunning ? (chatlogAlive ? "SYNCING" : "READY") : "READY",
            lastError: null,
          },
          threads,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!ingestRes.ok) throw new Error(`上报同步失败 (HTTP ${ingestRes.status})`);
      const out = await ingestRes.json();

      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      this.onChange();

      if (!silent && !chatlogAlive) {
        return {
          ok: true,
          inserted: 0,
          confirmed: 0,
          hint: "已同步桌面端状态。如需自动拉取本地历史消息，可启动本机 chatlog 只读服务（端口 5030）。",
        };
      }
      return { ok: true, inserted: out.inserted ?? 0, confirmed: out.confirmed ?? 0 };
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
