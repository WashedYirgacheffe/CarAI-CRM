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
```

## 部署（阿里云 / 腾讯云）

```bash
echo "POSTGRES_PASSWORD=请改成强密码" > .env
docker compose run --rm migrate   # 执行数据库迁移
docker compose up -d web
```

### 定时任务

| 命令 | 频率 | 说明 |
|---|---|---|
| `pnpm job:pool-recycle` | 每小时 | 按「公海规则」把超期未跟进的私海客户回收到公海（打开公海页时也会顺带执行） |
| `pnpm job:ensure-defaults` | 升级后跑一次 | 给老企业补齐默认客户状态、商机阶段、客户分组 |

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
| `src/components/crm/` | 客户、商机、日程的共用组件 |
| `src/app/(auth)` | 登录、注册 |
| `src/app/(app)` | 后台页面；`settings/` 为组织与权限设置 |

## 阶段

- **P0 骨架（已完成）**：注册即建企业（主账号）、登录会话、部门树、成员子账号、角色与数据范围、后台布局与菜单
- **P1 客户与销售（已完成）**：客户列表与详情（查重防撞单、星级、标签、分组）、联系人、跟进动态与下次跟进、公海（自动回收、每日领取上限、私海上限、分配）、线索（分配、无效、转客户并入老客户）、商机看板（拖拽换阶段）、日程、业务规则设置、工作台
- P2 单据：产品、多币种报价单 / PI、订单
- P3 邮件：IMAP/SMTP 绑定、收发同步、自动建档
