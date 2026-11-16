// 自动更新：electron-updater，更新源是 CRM 的 /api/desktop/update（文件放在 OSS 的 desktop/ 目录）。
// 启动后检查一次，之后每 4 小时一次；下载完在菜单栏提示「重启并安装」，退出时也会自动装上。
// 注意：Mac 上只有签过名的安装包才能自动更新（未签名的开发版检查会报错，忽略即可）。
import { app } from "electron";
import updaterPkg from "electron-updater";

const { autoUpdater } = updaterPkg;
const EVERY_MS = 4 * 60 * 60_000;

export function startUpdater(onChange) {
  const state = { status: "idle", version: "", error: "" };
  const set = (patch) => {
    Object.assign(state, patch);
    onChange?.({ ...state });
  };
  if (!app.isPackaged) return { state, install: () => {}, check: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on("checking-for-update", () => set({ status: "checking", error: "" }));
  autoUpdater.on("update-available", (i) => set({ status: "downloading", version: i.version }));
  autoUpdater.on("update-not-available", () => set({ status: "idle" }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", error: "", progress: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => set({ status: "ready", version: i.version }));
  autoUpdater.on("error", (e) => set({ status: "error", error: String(e?.message ?? e).split("\n")[0].slice(0, 120) }));
  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15_000);
  setInterval(check, EVERY_MS).unref();
  return {
    state,
    check,
    install: () => autoUpdater.quitAndInstall(false, true),
  };
}
