# 社媒矩阵（多账号托管）方案

> 状态：**P1 开发中（试点）**。最后更新：2026-11-14

## 0. 已确认的决定

| 事项 | 决定 |
|---|---|
| 代理 IP | 在 CRM 里**手填**（协议、地址、端口、账号密码），保存后自动检测出口 IP、国家、时区 |
| 平台 | LinkedIn、Facebook、Instagram、TikTok、YouTube |
| 登录 | 人工登录（扫码或输入账号密码），系统打开登录窗口后通知负责人 |
| 日常操作 | **不用打开环境**：私信、发视频都在 CRM 里完成，后台的「环境运行器」代为执行 |
| 自动化边界 | 托管 + 人工发起的操作 + 只读同步；不做群发、自动加好友、自动点赞 |
| 浏览器内核 | **Camoufox**（开源，MPL-2.0，Firefox 内核，指纹在 C++ 层修改） |

### 为什么内核从 fingerprint-chromium 改成 Camoufox

- fingerprint-chromium 只有 Windows / Linux 版本，**没有 macOS 版**。试点要在 Mac 上跑。
- Camoufox 提供 macOS（arm64 / x64）、Linux、Windows 版本，并且有官方的 Node 启动包（`camoufox` + `playwright-core`）。
- **原生支持带账号密码的代理**，不用在本机再起中转代理。
- 指纹可以固定：建环境时生成一份指纹存进 CRM，之后每次启动都用这一份。时区、语言、地理位置、WebRTC IP 自动跟随代理出口。
- 本来就是为服务器上的无人值守自动化设计的，支持无界面运行，和「不打开环境也能操作」的要求一致。

## 1. 架构

```
┌──────────────── CRM（Next.js + PostgreSQL） ────────────────┐
│ 代理 IP · 矩阵账号（指纹、绑定代理、负责人）· 任务队列 · 审计   │
│ 私信收件箱 · 发布中心（视频 / 文案 / 定时 / 多账号）            │
└───────────────┬──────────────────────────────────────────────┘
                │ 任务队列（matrix_job 表：login / open / check / inbox / reply / publish）
┌───────────────▼──────────────────────────────────────────────┐
│ 环境运行器（scripts/matrix-runner.mts，常驻进程）              │
│ 领取任务 → 用该账号固定的指纹 + 代理 + 独立数据目录启动 Camoufox │
│ → 用 Playwright 执行 → 结果写回 CRM                            │
│ 同一账号同一时刻只跑一个任务；不同账号可以并行                   │
└──────────────────────────────────────────────────────────────┘
```

- **运行器在哪台机器上跑都可以**：试点在你的 Mac 上跑（登录窗口直接弹在桌面上）。正式环境放到云服务器（Linux，无界面运行），登录改成在 CRM 网页里看实时画面、远程点击和扫码（P2）。
- 每个账号的浏览器数据目录放在运行器机器上（`MATRIX_PROFILE_DIR`，默认 `~/.cheche-crm/matrix`），之后会加密备份到 CRM 的存储，换机器、员工离职时登录状态都不会丢。
- 要求「代理不通就不启动」：启动前先检测代理，失败直接报错，绝不退回直连。
- 启动前运行器会通过代理查一次出口 IP，把浏览器的时区、地理位置、WebRTC IP 和语言（按国家）都设成跟这个 IP 一致。指纹在第一次启动时抽一个真实设备的配置，存回 CRM，以后一直用它。

### 试点怎么跑运行器（P1 已上线）

1. CRM「社媒矩阵 → 运行器」里生成令牌（只显示一次）。
2. 第一次先下载浏览器（约 1.3 GB）：`PATH=/opt/homebrew/bin:$PATH npx camoufox fetch`
3. 在项目目录里启动（需要 Node 22.15+）：
   `PATH=/opt/homebrew/bin:$PATH CRM_URL=https://crm.caraicrm.com MATRIX_RUNNER_TOKEN=mr_… pnpm matrix-runner`
   两个变量也可以写进项目根目录的 `.env.runner`。`MATRIX_MAX_JOBS` 控制同时开几个环境（默认 3）。
4. CRM 里点「登录」，Mac 右上角会弹通知并打开该账号的浏览器窗口，扫码或输入密码即可；Ctrl+C 退出运行器会关闭所有窗口。

## 2. 登录

1. 在 CRM 里点「登录」→ 生成一个 login 任务。
2. 运行器用该账号的环境**弹出可见窗口**，打开平台登录页，任务状态变为「等你登录」，CRM 页面上提示负责人。
3. 人工扫码或输入账号密码，包括二次验证。
4. 运行器每 2 秒检查一次登录 Cookie，检测到就标记为「已登录」并关闭窗口；10 分钟内没登录上，任务结束并标记为「未登录」。

| 平台 | 判断已登录的 Cookie |
|---|---|
| LinkedIn | `li_at`（linkedin.com） |
| Facebook | `c_user`（facebook.com） |
| Instagram | `sessionid`（instagram.com） |
| TikTok | `sessionid`（tiktok.com） |
| YouTube | `LOGIN_INFO`（youtube.com），或 Google 的 `SID` |

之后运行器会定时用无界面方式检查登录是否还有效；掉线了就提醒负责人重新登录。

## 3. 私信回流（把环境里的私信「反代」到 CRM）

### 3.1 两条通道

| 平台 | 通道 | 说明 |
|---|---|---|
| Instagram（专业账号）、Facebook 主页 | **官方 API**（Meta Messenger / Instagram Messaging，Webhook 推送） | 最稳定，没有风控风险；需要 Meta 开发者应用并通过审核。放到 P5 |
| LinkedIn 个人号、Facebook 个人号、TikTok、试点期的 Instagram | **运行器读网页** | 平台没有给个人号开放私信 API，只能通过环境里已登录的网页来读 |
| YouTube | 没有私信，改为**评论回流** | 用官方 YouTube Data API 读取评论 |

### 3.2 运行器怎么读

- **定时同步**：每个账号每 5～10 分钟一次，带随机间隔，只在账号所在时区的工作时间段跑。无界面打开消息页。
- **优先截取网络数据**：平台网页自己会请求会话列表和消息的 JSON（LinkedIn 的 voyager messaging、Facebook / Instagram 的 GraphQL）。运行器用 Playwright 监听这些响应直接解析，比解析页面 DOM 更稳定，平台改版的影响也更小。解析失败时退回读 DOM。
- **增量同步**：每个会话记录最后一条消息的 id，只拉新消息。
- **写入 CRM**：新增 `SocialThread`（会话）和 `SocialMessage`（消息）表。会话按对方的主页链接匹配到已有的客户社媒（`CustomerSocial`），匹配上就写进客户跟进时间线，和邮件、WhatsApp 并列；没匹配上的进「未关联」收件箱，可以一键建线索。

### 3.3 回复

在 CRM 收件箱里输入回复 → 生成一个 reply 任务 → 运行器打开该会话，模拟人工输入（逐字输入、随机停顿）后发送 → 发送结果写回 CRM。失败（掉线、被限制）就提示，不自动重试。每个账号每天的发送量设上限。

## 4. 不打开环境发视频

### 4.1 CRM 里的「发布中心」

上传视频、封面、文案和话题 → 选择多个账号 → 立即发布或定时 → 每个账号生成一个 publish 任务 → 运行器在后台完成上传 → 回写帖子链接、状态，以及失败原因和截图。

### 4.2 两种执行方式

| 方式 | 适用 | 优缺点 |
|---|---|---|
| **运行器操作网页上传**（试点先用这个） | 五个平台都可以 | 账号已经在环境里登录，**不用申请任何平台审核**，马上能用；缺点是平台改版要维护各平台的上传脚本（参考开源项目 social-auto-upload 的做法） |
| **官方 API** | YouTube（Data API `videos.insert`）、Instagram / Facebook（Graph API 的 Reels 发布）、TikTok（Content Posting API，未过审只能私密发布）、LinkedIn（Posts API） | 最稳定；但每个平台都要申请开发者应用和审核，YouTube 默认配额一天大约只能传 6 个视频 |

**建议**：试点统一走运行器操作网页，等跑通、确定常用平台后，再把 YouTube 和 Meta 系的平台切到官方 API。

## 5. 数据模型

```
MatrixProxy    代理：协议、地址、端口、账号、加密密码、备注；检测结果（出口 IP、国家、时区、ISP、是否机房 IP、延迟、检测时间、错误）
MatrixAccount  矩阵账号：平台、名称、登录账号、加密密码、负责人、绑定代理、指纹（固定 JSON）、系统类型、状态、最近登录 / 检查时间
MatrixJob      任务队列：账号、类型（login / open / check / inbox / reply / publish）、参数、状态、结果、错误、发起人、开始 / 结束时间
MatrixEvent    审计：谁、对哪个账号、做了什么、从哪台运行器
（P2）SocialThread / SocialMessage   私信会话 / 消息
（P4）MatrixPost                     发布记录
```

## 6. 分期

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P1 试点** | 手填代理并检测；矩阵账号（5 个平台）；固定指纹；环境运行器；登录、打开环境、检查登录状态；审计 | 开发中 |
| P2 | 私信读取：LinkedIn、Facebook、Instagram、TikTok → CRM 收件箱，按客户归档；登录支持在网页里远程操作（为放到云服务器做准备） | |
| P3 | 在 CRM 里回复私信 | |
| P4 | 发布中心：视频多账号发布、定时（运行器操作网页） | |
| P5 | 官方 API：YouTube 上传和评论、Meta 私信 Webhook 和 Reels 发布 | |

## 7. 风险

- **平台条款**：多账号和自动化本身就在平台条款的灰色地带。LinkedIn 明确禁止自动化抓取。指纹和代理能降低账号被关联的风险，但不能保证不封号。所以只做人工发起的操作和低频的只读同步。
- **网页脚本要维护**：私信读取和网页上传都依赖平台网页结构，平台改版就要修。每个平台的逻辑单独成文件，出错时截图留证据。
- **内核**：Camoufox 还标着「开发中」。版本由运行器固定，不自动升级；新版本先在试点账号上验证，再推广。
- **代理**：机房 IP 很容易被识别。检测结果里会标出「机房 IP」，并提示换成住宅或 ISP 静态 IP。
- **凭据**：账号密码和代理密码用 `APP_SECRET` 加密（AES-256-GCM）保存，员工端不显示明文。

## 附：开源调研结论（2026-11）

- 指纹内核：fingerprint-chromium（BSD，没有 Mac 版）、Camoufox（MPL，全平台）、BotBrowser（新版设备档案收费）。改内核是主流，只靠 JS 注入很容易被识别。
- 环境管理器：Donut（AGPL，只参考设计）、Ant-Browser、camoufox-profile-manager、Mirage。都是单机工具，没有团队分配和审计功能，这正是 CRM 要补的部分。
- 借鉴的设计：指纹固定、复制账号时生成新指纹、时区跟随代理出口、代理失败就不启动、代理密码加密保存。
- 发布：Postiz、Mixpost 走官方 OAuth；social-auto-upload 走浏览器自动化 + Cookie。
