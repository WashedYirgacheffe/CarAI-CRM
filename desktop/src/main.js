// 车车 CRM 桌面版主进程：主窗口加载 CRM；登录后用当前会话配对本机、拿设备令牌；
// 在子进程里跑环境运行器，归属这台电脑的社媒账号都在这里执行。关窗口只隐藏，留在菜单栏继续挂着。
import { execFileSync } from "node:child_process";
import os from "node:os";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, session, shell, Tray } from "electron";
import path from "node:path";
import { clearToken, loadDevice, saveDevice } from "./store.js";
import { ensureBrowser, killHelpers, Runner, runnerLogPath, setBrowserState } from "./runner.js";
import { startUpdater } from "./updater.js";
import { WechatBridge } from "./wechat/bridge.js";

const CRM_URL = (process.env.CRM_URL || "https://crm.caraicrm.com").replace(/\/+$/, "");
const ORIGIN = new URL(CRM_URL).origin;
const VERSION = app.getVersion();

if (!app.requestSingleInstanceLock()) app.quit();
// Windows：任务栏分组和系统通知用的应用 id，要和安装包的 appId 一致
if (process.platform === "win32") app.setAppUserModelId("com.caraicrm.desktop");

let win = null;
let tray = null;
let trayIconMissing = false;
let quitting = false;
/** 这次启动里有没有用当前登录会话配对过（退出登录后重置） */
let pairedThisSession = false;
let pairing = null;
let browserReady = null;
const status = { state: "stopped", detail: "", device: "" };
/** 正在实时收私信的账号 */
let watching = [];
let updater = null;
let update = { status: "idle", version: "", error: "" };

function deviceName() {
  try {
    const n = execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim();
    if (n) return n;
  } catch {
    /* 不是 Mac 或取不到 */
  }
  return os.hostname().replace(/\.local$/, "");
}

function osLabel() {
  const v = process.getSystemVersion?.() || os.release();
  if (process.platform === "darwin") return `macOS ${v} · ${process.arch}`;
  if (process.platform === "win32") return `Windows ${os.release()} · ${process.arch}`;
  return `${process.platform} ${v}`;
}

const STATE_TEXT = {
  stopped: "未连接（请在主窗口登录）",
  running: "在线，社媒账号在这台电脑上运行",
  restarting: "运行器重启中…",
  crashed: "运行器异常退出",
  unauthorized: "这台电脑已被移除，请重新登录",
  preparing: "准备中…",
};

const runner = new Runner({
  crmUrl: CRM_URL,
  onState: (state, detail) => {
    status.state = state;
    status.detail = detail || "";
    if (state === "unauthorized") {
      clearToken();
      pairedThisSession = false;
      void pair();
    }
    refreshTray();
  },
  onWatch: (names) => {
    watching = names;
    refreshTray();
  },
});

const wechatBridge = new WechatBridge({
  crmUrl: CRM_URL,
  onChange: () => refreshTray(),
});

function refreshTray() {
  if (!tray) return;
  const line = status.detail || STATE_TEXT[status.state] || status.state;
  tray.setToolTip(`车车 CRM · ${line}${watching.length ? ` · ${watching.length} 个账号实时收私信` : ""}`);
  // 菜单栏图标旁边显示几个账号在实时收私信
  tray.setTitle(watching.length ? String(watching.length) : trayIconMissing ? "车车" : "");
  const updateItems =
    update.status === "ready"
      ? [{ label: `重启并安装新版本 ${update.version}`, click: () => ((quitting = true), updater?.install()) }]
      : update.status === "downloading"
        ? [{ label: `正在下载新版本 ${update.version}${update.progress ? ` ${update.progress}%` : ""}…`, enabled: false }]
        : [{ label: `检查更新（当前 ${VERSION}）`, click: () => updater?.check(), enabled: app.isPackaged }];
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status.device ? `${status.device} · ${line}` : line, enabled: false },
      ...(watching.length
        ? [{ label: `实时收私信：${watching.slice(0, 5).join("、")}${watching.length > 5 ? ` 等 ${watching.length} 个` : ""}`, enabled: false }]
        : []),
      { type: "separator" },
      { label: "打开车车 CRM", click: showWindow },
      { label: "查看运行器日志", click: () => shell.openPath(runnerLogPath()) },
      { label: "重新连接", click: () => ((pairedThisSession = false), void pair()) },
      { type: "separator" },
      {
        label: "开机自动启动",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, openAsHidden: true }),
      },
      { type: "separator" },
      ...updateItems,
      { label: "退出车车 CRM", accelerator: "CmdOrCtrl+Q", click: () => ((quitting = true), app.quit()) },
    ]),
  );
}

/**
 * 第一次用的时候下载浏览器内核；之后每次启动只检查一下。
 * 进度写进状态文件，运行器照常连 CRM 报在线和进度，内核好了才开始领任务。
 */
function prepareBrowser() {
  if (!browserReady) setBrowserState(false, "正在检查浏览器内核…");
  browserReady ??= ensureBrowser((msg) => {
    status.detail = msg;
    setBrowserState(false, msg);
    refreshTray();
  }).then((ok) => {
    status.detail = ok ? "" : "浏览器内核下载失败，点「重新连接」重试";
    setBrowserState(ok, ok ? "" : "浏览器内核下载失败，在菜单栏点「重新连接」重试");
    if (!ok) browserReady = null;
    refreshTray();
    return ok;
  });
  return browserReady;
}

function startRunner(token) {
  void prepareBrowser();
  runner.start(token, status.device);
  wechatBridge.start(token);
}

/** 用主窗口的登录会话换设备令牌（服务器同时给这个会话写上 cc_device Cookie） */
function pair() {
  pairing ??= (async () => {
    const saved = loadDevice();
    const ses = session.defaultSession;
    try {
      const res = await ses.fetch(`${CRM_URL}/api/desktop/pair`, {
        method: "POST",
        credentials: "include",
        redirect: "manual",
        headers: { "content-type": "application/json", "x-cheche-desktop": "1" },
        body: JSON.stringify({ deviceId: saved.deviceId, name: status.device, os: osLabel(), appVersion: VERSION }),
      });
      // 还没登录（老版本服务器会跳登录页），登录后再配
      if (res.status === 401 || (res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") return false;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const firstTime = saved.deviceId !== d.deviceId;
      saveDevice({ deviceId: d.deviceId, token: d.token, userId: d.user?.id ?? null });
      // fetch 的 Set-Cookie 不一定落进会话，自己再写一遍
      await ses.cookies.set({
        url: CRM_URL,
        name: "cc_device",
        value: d.deviceId,
        httpOnly: true,
        secure: CRM_URL.startsWith("https:"),
        sameSite: "lax",
        expirationDate: Math.floor(Date.now() / 1000) + 400 * 86400,
      });
      pairedThisSession = true;
      // 当前页面是配对前渲染的，刷新一下才会显示「这台电脑」相关的操作
      if (firstTime && win && !win.isDestroyed()) win.webContents.reload();
      await startRunner(d.token);
      return true;
    } catch (e) {
      status.detail = `连不上 CRM：${e instanceof Error ? e.message : e}`;
      refreshTray();
      return false;
    } finally {
      pairing = null;
    }
  })();
  return pairing;
}

function onNavigate(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.origin !== ORIGIN) return;
  if (u.pathname.startsWith("/login") || u.pathname.startsWith("/register")) {
    // 退出登录了：换个人登录时要重新配对。运行器先停，免得用上一个人的身份继续跑
    if (pairedThisSession) {
      pairedThisSession = false;
      runner.stop();
      wechatBridge.stop();
      clearToken();
    }
    return;
  }
  if (!pairedThisSession) void pair();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: "车车 CRM",
    show: false,
    // Windows 上不显示 File/Edit 那一行菜单（按 Alt 才出来）
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [`--cheche-version=${VERSION}`],
    },
  });
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} CheCheCRMDesktop/${VERSION}`);
  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.webContents.on("did-navigate", (_e, url) => onNavigate(url));
  win.webContents.on("did-navigate-in-page", (_e, url, isMain) => isMain && onNavigate(url));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  void win.loadURL(CRM_URL);
}

function showWindow() {
  // 从 Finder 双击启动时，macOS 可能先发 activate 再 ready；没准备好就交给 whenReady 去建窗口
  if (!app.isReady()) return;
  if (!win || win.isDestroyed()) createWindow();
  else {
    win.show();
    win.focus();
  }
}

function createTray() {
  const mac = process.platform === "darwin";
  // Mac 用模板图标：系统按菜单栏深浅色自动反色（@2x 自动匹配）；Windows 托盘用彩色图标
  const icon = mac
    ? nativeImage.createFromPath(path.join(app.getAppPath(), "build", "trayTemplate.png"))
    : nativeImage.createFromPath(path.join(app.getAppPath(), "build", "icon.ico"));
  if (mac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  // Windows 习惯单击托盘图标打开主窗口，右键出菜单
  if (!mac) tray.on("click", showWindow);
  trayIconMissing = icon.isEmpty();
  refreshTray();
}

app.on("second-instance", showWindow);
app.on("activate", showWindow);
app.on("before-quit", () => {
  quitting = true;
  runner.stop();
  wechatBridge.stop();
  killHelpers();
});
// 窗口都关了也不退出：留在菜单栏
app.on("window-all-closed", () => {});

ipcMain.handle("desktop:status", () => ({ paired: !!loadDevice().token, state: status.state, detail: status.detail, device: status.device }));
ipcMain.handle("wechat:status", () => wechatBridge.getStatus());
ipcMain.handle("wechat:stage-send", (_e, opts) => wechatBridge.stageSend(opts || {}));
ipcMain.handle("wechat:save-config", (_e, cfg) => wechatBridge.saveConfig(cfg || {}));
ipcMain.handle("wechat:extract-key", () => wechatBridge.extractKey());
ipcMain.handle("wechat:sync-now", () => wechatBridge.syncNow({ silent: false }));
ipcMain.handle("wechat:load-media", (_e, meta) => wechatBridge.loadMedia(meta));
ipcMain.handle("wechat:open-media", (_e, meta, reveal) => wechatBridge.openMedia(meta, !!reveal));
ipcMain.handle("wechat:load-avatar", (_e, wxKey) => wechatBridge.loadAvatar(wxKey));

app.whenReady().then(() => {
  status.device = deviceName();
  createTray();
  updater = startUpdater((s) => {
    update = s;
    refreshTray();
  });
  if (!win || win.isDestroyed()) createWindow();
  // 之前配对过就直接开跑，不用等主窗口登录
  const saved = loadDevice();
  if (saved.token) {
    // 已经配对过：会话里的 cc_device Cookie 还在，不重新配对（换令牌会重启运行器、打断刚领到的任务）
    pairedThisSession = true;
    void startRunner(saved.token);
  } else void prepareBrowser();
});
