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

## 打包

`npm run dist` 出 DMG（arm64 + x64）。签名、公证、自动更新在 M3 做，见 `docs/desktop-app-plan.md`。
