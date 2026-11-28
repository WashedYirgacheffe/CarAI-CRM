// 网页里能拿到的桌面版信息（只读）。配对、运行器都在主进程里做，网页碰不到令牌。
const { contextBridge, ipcRenderer } = require("electron");

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").slice(k.length + 3);

contextBridge.exposeInMainWorld("chechedesktop", {
  version: arg("cheche-version"),
  platform: process.platform,
  /** 运行器状态：{ paired, state, detail, device } */
  status: () => ipcRenderer.invoke("desktop:status"),
  /** 个人微信本地桥接（零封号：只读增量同步 + 半自动一键上屏） */
  wechat: {
    getStatus: () => ipcRenderer.invoke("wechat:status"),
    stageSend: (opts) => ipcRenderer.invoke("wechat:stage-send", opts),
    saveConfig: (cfg) => ipcRenderer.invoke("wechat:save-config", cfg),
    extractKey: () => ipcRenderer.invoke("wechat:extract-key"),
    syncNow: () => ipcRenderer.invoke("wechat:sync-now"),
    loadMedia: (meta) => ipcRenderer.invoke("wechat:load-media", meta),
    openMedia: (meta, reveal) => ipcRenderer.invoke("wechat:open-media", meta, reveal),
    loadAvatar: (wxKey) => ipcRenderer.invoke("wechat:load-avatar", wxKey),
  },
});
