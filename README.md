# 车车外贸 CRM

面向中小外贸团队的多渠道客户跟进系统（多租户 SaaS）。

技术栈：Next.js 16 (App Router) · TypeScript · PostgreSQL · Prisma 7 · shadcn/ui · Tailwind 4

## 本地开发

```bash
brew install postgresql@17 && brew services start postgresql@17
createdb cheche_crm
cp .env.example .env          # 修改 DATABASE_URL
pnpm install                  # 会自动 prisma generate
pnpm db:migrate               # 建表
pnpm dev                      # http://localhost:3000 → 注册企业即可进入
pnpm worker                   # 另开终端：邮件同步、WhatsApp、AI 分析、公海回收
```

## 部署（阿里云 / 腾讯云）

服务器需安装 Docker；内存 2G 的机器建议加 4G swap（`next build` 比较吃内存）。控制台防火墙放行 80、443。

```bash
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_DOMAIN=crm.example.com        # 已解析到本机公网 IP 的域名
APP_SECRET=$(openssl rand -hex 32) # 加密邮箱密码，设定后不要再改
AI_API_KEY=sk-xxx                 # AI 服务密钥（可选，不填则 AI 功能不可用）
EOF
docker compose build web migrate worker
docker compose run --rm migrate          # 执行数据库迁移
docker compose up -d web worker caddy    # caddy 自动申请 HTTPS 证书
crontab deploy/crontab                   # 每日备份
```

- 应用不直接暴露 3000 端口，统一由 `caddy` 反向代理并自动申请、续期 Let's Encrypt 证书。换域名只需改 `APP_DOMAIN` 后 `docker compose up -d caddy`。
- 还没有域名时可临时用 `<IP 用横线连接>.sslip.io`（如 `47-82-101-128.sslip.io`），它会自动解析到该 IP。
- 登录 Cookie 在生产环境带 `Secure`，所以必须通过 HTTPS 访问。
- `deploy/backup.sh` 每天把数据库和上传文件备份到 `/opt/crm/backups`，保留 14 天。
- 更新版本：同步代码后执行 `docker compose build web migrate worker && docker compose run --rm migrate && docker compose up -d web worker`。

产品图片等上传文件保存在 `UPLOAD_DIR`（本地默认 `storage/uploads`，容器内为 `/data/uploads`，已挂载 `uploads` 卷），备份时一并备份该卷。

### 环境变量

| 变量 | 说明 |
|---|---|
| `APP_SECRET` | 加密邮箱密码（AES-256-GCM），生产环境必填，设定后不要再改 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | Anthropic Messages 兼容接口，用于 AI 写信、翻译、邮件摘要、客户速览与跟进建议 |
| `UPLOAD_DIR` | 上传文件和邮件附件目录 |
| `WA_AUTH_DIR` | WhatsApp 登录凭证目录（容器内 `/data/whatsapp`，挂载 `whatsapp` 卷） |

### Worker 与定时任务

`worker` 容器（`pnpm worker`）常驻运行：每个邮箱约 3 分钟同步一次收件箱和已发送，并自动归档到客户 / 线索；新来信做 AI 摘要和意图识别；维持 WhatsApp 连接并发送排队消息；每小时回收公海。网页和 worker 之间只通过数据库通信。

| 命令 | 频率 | 说明 |
|---|---|---|
| `pnpm worker` | 常驻 | 见上 |
| `pnpm job:pool-recycle` | 手动 | 立即执行一次公海回收（worker 已每小时执行） |
| `pnpm job:ensure-defaults` | 升级后跑一次 | 给老企业补齐默认客户状态、商机阶段、客户分组、默认汇率 |

任务脚本放在 `scripts/*.mts`，用 `tsx --conditions=react-server` 运行；不要在脚本里引用 `@/server/auth`（依赖 Next 运行时）。

## 目录约定

| 路径 | 说明 |
|---|---|
| `prisma/schema.prisma` | 数据模型；业务表一律带 `tenantId` |
| `src/server/db.ts` | `tenantDb(tenantId)` 自动按租户隔离；新业务表要登记到 `TENANT_MODELS` |
| `src/server/auth.ts` | 会话、当前用户、`requirePermission()` |
| `src/lib/permissions.ts` | 权限点目录和内置角色 |
| `src/lib/nav.ts` | 后台菜单（按权限过滤） |
| `src/lib/crm.ts` | 前后端共用的 CRM 常量与工具：国家表、查重规范化、时区日期 |
| `src/server/scope.ts` | 数据范围（本人 / 本部门及下级 / 全公司） |
| `src/server/customers.ts` | 客户访问权限、查重、动态记录 |
| `src/server/documents.ts` | 报价单 / 订单共用：单号生成、金额计算、汇率、数据范围 |
| `src/lib/docs.ts` | 单据常量（贸易术语、付款方式、状态）、金额计算与英文大写 |
| `src/components/crm/` | 客户、商机、日程、单据编辑器等共用组件 |
| `src/app/(print)` | 报价单 / PI 打印页（浏览器打印 → 另存为 PDF） |
| `src/app/(auth)` | 登录、注册 |
| `src/app/(app)` | 后台页面；`settings/` 为组织与权限设置 |

## 阶段

- **P0 骨架（已完成）**：注册即建企业（主账号）、登录会话、部门树、成员子账号、角色与数据范围、后台布局与菜单
- **P1 客户与销售（已完成）**：客户列表与详情（查重防撞单、星级、标签、分组）、联系人、跟进动态与下次跟进、公海（自动回收、每日领取上限、私海上限、分配）、线索（分配、无效、转客户并入老客户）、商机看板（拖拽换阶段）、日程、业务规则设置、工作台
- **P2 单据（已完成）**：产品库（分类、图片、停售）、多币种报价单（汇率快照、换币种自动折算、复制重报）、报价单转订单（自动标记已接受、商机赢单）、订单收款与待收统计、报价单 / PI 打印、单据抬头与汇率设置
- **P3 邮件（已完成）**：IMAP/SMTP 绑定（常见邮箱预设、保存前测试连接、密码加密）、收件箱 / 已发送同步、写信回复转发与附件、按联系人邮箱和公司域名自动归档到客户，陌生来信自动建线索、客户详情的往来邮件
- **P4 WhatsApp / AI / 统计（已完成）**：WhatsApp 扫码登录收发消息并关联客户；AI 写信、回复、润色、翻译，邮件摘要与意图识别，客户背景速览与跟进建议；统计报表（询盘来源转化、跟进方式、沟通量、团队业绩）

> WhatsApp 采用扫码登录（非官方接口，基于 Baileys），有被封号的风险：建议使用专门的业务号，不要群发营销消息。
