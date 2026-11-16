// 网页里能拿到的桌面版信息（只读）。配对、运行器都在主进程里做，网页碰不到令牌。
const { contextBridge, ipcRenderer } = require("electron");

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").slice(k.length + 3);

contextBridge.exposeInMainWorld("chechedesktop", {
  version: arg("cheche-version"),
  platform: process.platform,
  /** 运行器状态：{ paired, state, detail, device } */
  status: () => ipcRenderer.invoke("desktop:status"),
});
