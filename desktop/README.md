# 车车 CRM 桌面版（Mac）

主窗口就是 CRM 网页；登录后自动配对这台电脑，内置的环境运行器（`scripts/matrix-runner.mts` 打包而成）在后台子进程里跑，
归属这台电脑的社媒账号的登录、打开环境、检测、收发私信都在本机执行。关窗口只隐藏，菜单栏里的「车车」可以重新打开或退出。

## 开发

```bash
cd desktop
npm install
npm run dev      # 连本地 http://localhost:3000
npm start        # 连线上 https://crm.caraicrm.com（或 CRM_URL=... npm start）
```

- 第一次启动会下载 Camoufox 浏览器内核（压缩包 1 GB 多，放在 `~/Library/Caches/camoufox`），菜单栏里能看到进度。
- 运行器日志：菜单栏 →「查看运行器日志」（`~/Library/Application Support/车车 CRM/logs/runner.log`）。
- 浏览器环境目录：`~/Library/Application Support/车车 CRM/matrix/<账号 id>`。

## 工作方式

1. 主窗口登录 CRM 后，主进程用这个登录会话调 `POST /api/desktop/pair`，拿到设备令牌 `md_…`（用钥匙串加密存在本机），
   服务器同时给会话写上 `cc_device` Cookie，网页据此知道「当前在哪台电脑上」。
2. 运行器用设备令牌领任务，只领归属这台电脑的账号的任务；在桌面版里登录 / 打开没有归属的账号时，账号自动归到这台电脑。
3. 在「设置 → 社媒运行」里移除这台电脑后，令牌立即失效，运行器退出（退出码 3），桌面版回到未配对状态。

## 打包和发布

```bash
cd desktop
npm run icons    # 改了图标才需要：build/icon-source.svg → icon.icns、菜单栏 trayTemplate*.png
npm run dmg-bg   # 改了 DMG 说明文字才需要：scripts/make-dmg-bg.mjs → build/background.tiff
npm run dist     # 出 release/ 下的 DMG + ZIP（arm64、x64）和 latest-mac.yml
cd .. && pnpm desktop:publish   # 传到 OSS 的 desktop/ 目录（需要服务器同样的 OSS_* 环境变量）
```

- **签名和公证**：有证书和 Apple 账号时自动进行。没有 `CSC_LINK` 时做 ad-hoc 签名并关掉 hardened runtime：
  不签名的话 Electron 自带签名被打包改坏，macOS 会直接报「已损坏」且没有放行按钮。ad-hoc 签名后用户在
  「系统设置 → 隐私与安全性」点「仍要打开」即可；DMG 里的背景图和「打不开请看我.txt」写了操作步骤。
  - `CSC_LINK`（Developer ID Application 证书 .p12 的路径或 base64）、`CSC_KEY_PASSWORD`
  - `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`（公证）
- **自动更新**：启动 15 秒后检查一次，之后每 4 小时一次；下载完在菜单栏提示「重启并安装」，退出时也会自动装上。
  更新源 `https://crm.caraicrm.com/api/desktop/update`。Mac 只有签过名的版本能自动更新。
- **下载地址**：`https://crm.caraicrm.com/api/desktop/download?arch=arm64`（Intel 用 `arch=x64`），设置 →「社媒运行」里有链接。
- `node_modules` 全部解包到 asar 外（运行器子进程从外面加载 camoufox 及其依赖）；`scripts/ensure-native.mjs` 补齐两个架构的 impit 原生模块。
- 发新版：先改 `package.json` 的 `version`，再 `dist` + `publish`。运行器代码跟着软件版本走。

## 常驻监听和迁移

- 归属这台电脑、已登录、开了收私信的 TikTok 账号会一直挂在无界面浏览器里，几秒看一眼私信列表，新消息几秒内到收件箱。
  菜单栏图标旁边的数字就是正在实时收私信的账号数。默认最多 5 个（环境变量 `MATRIX_MAX_WATCH`）。
- 「迁到这台电脑」：已登录的账号会把原来位置（云端或另一台电脑）的浏览器环境加密打包，经 OSS 迁过来，不用重新登录。
  迁移期间原来的位置需要在线。
