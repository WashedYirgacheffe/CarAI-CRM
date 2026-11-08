# 车车外贸 CRM 升级报告

对照日期：2026-11-08
对标对象：OKKI（小满科技）实地走查，详见 [okki-sitemap.md](./okki-sitemap.md)

---

## 一、当前进度

### 已合并到 main

| 阶段 | 内容 | 提交 |
|---|---|---|
| P0 | 多租户认证、组织设置、管理后台骨架 | `96779de` |
| P1 | 客户、联系人、公海、线索、商机、日程跟进 | `d6703eb` |
| P2 | 产品库、多币种报价单 / PI、订单与收款 | `0f63edf` |

### 进行中：`deploy-caddy-https` 分支（未提交）

- Caddy 反向代理 + Let's Encrypt 自动签发续期，应用不再直接暴露 3000 端口
- 修复 Dockerfile：`postinstall` 要执行 `prisma generate`，需先把 `prisma/` 拷入镜像
- `deploy/backup.sh` 每日备份数据库与上传文件，保留 14 天
- `deploy/crontab` 定时备份 + 每小时公海回收
- README 补全部署流程（swap、防火墙、sslip.io 临时域名）

**状态：代码写完，未在服务器实跑验证。**

### 现有数据模型（prisma/schema.prisma）

```
Tenant User Session Department Role
CustomerStatus CustomerGroup Customer Contact
Lead Stage Opportunity Activity Task
ProductCategory Product ExchangeRate
Quotation QuotationItem Order OrderItem OrderPayment
```

### 现有页面

```
dashboard customers leads opportunities schedule
products quotations orders reports
mail(占位) whatsapp(占位) settings
```

---

## 二、与 OKKI 的差距

### A. 信息架构

| 问题 | 现状 | OKKI 做法 |
|---|---|---|
| 一级菜单过散 | 产品 / 报价单 / 订单 各占一级 | 合并为「交易」，下挂 8 个二级 |
| 缺少协同域 | 日程单独一级，无审批 / 任务 / 云盘 / 通讯录 | 合并为「协同」，5 个二级 |
| 缺少数据域 | reports 单页 | 「团队数据」下分目标数据 / AI 洞察 / 工作动态 |
| 无二级菜单机制 | 全部平铺 | 12 个一级 + 分组二级，层级清晰 |
| 无未读角标 | 无 | 线索、消息、团队数据均带角标 |
| 全局搜索 | 无 | 顶栏带类型下拉的全局搜索 |

### B. 客户模型字段缺口

我们的 `Customer` 有 26 个字段，OKKI 有 50+。缺的主要是**系统自动维护的行为时间戳**，而这些正是公海回收、客户分级、流失预警的计算基础。

**建议补充**：

```prisma
// 公司其他信息
paymentDays      Int?       // 客户账期
paymentPlanId    String?    // 默认付款计划
purchaseIntent   String?    // 采购意向
scale            String?    // 规模
timezone         String?    // 时区 —— 驱动客户当地时间显示
fax              String?
logoUrl          String?
shortName        String?    // 简称
code             String?    // 客户编号（租户内自增，业务员用来口头指代）
phone            String?    // 座机

// 跟进信息（系统维护，不可手改）
lastFollowAt       DateTime?  // 最近跟进（≠ 最近联系）
nextPoolAt         DateTime?  // 下次移入公海日期 —— 预计算，便于"即将移入公海"筛选
lastPrivateAt      DateTime?  // 最近进入私海时间
lastPoolAt         DateTime?  // 最近进入公海时间
poolCount          Int @default(0)  // 进入公海次数 —— 识别反复流转的难啃客户
lastDealAt         DateTime?  // 最近成交日期
lastMailSentAt     DateTime?
lastMailRecvAt     DateTime?
lastEdmAt          DateTime?
lastWhatsappAt     DateTime?
nextScheduleAt     DateTime?  // 下次日程时间

// 系统信息
prevOwnerId        String?    // 原跟进人
createMethod       String?    // 创建方式（手工/邮件自动/导入/同步）
sourceLeadId       String?    // 来源线索
sourceDetail       String?    // 来源详情
ownerChangedAt     DateTime?
profileUpdatedAt   DateTime?
```

**关键设计点**：OKKI 把「最近联系」和「最近跟进」分开 —— 前者是任意双向互动（收发邮件、聊天），后者是业务员主动写的跟进记录。公海规则可以配置**哪些事件算"联系过"**（最近联系日期参照事件 / 最近成交日期参照事件）。我们现在只有 `lastContactAt` 一个字段，做不出这种区分。

### C. 缺失的核心能力

| # | 能力 | OKKI 实现 | 我们 |
|---|---|---|---|
| 1 | **客群（保存的筛选条件）** | 可嵌套、带实时计数、可作为公海规则/报表的作用域 | 无 |
| 2 | **公海规则按客群配置** | 每条规则：名称 + N 天未联系 + 生效时间 + 生效客群；提前 7 天邮件提醒 | 单一全局规则 |
| 3 | **任务规则引擎** | 管理者配规则（如「1 星客户 60 天至少跟进 1 次」），系统自动生成任务，按即将超时/已超时统计 | Task 表有，无规则引擎 |
| 4 | **目标管理** | 结果目标 / 过程目标，5 类指标，每指标三张报表（完成情况/变化情况/详情） | 无 |
| 5 | **SLA 考核** | 「客户邮件 24h 内回复率」「阿里询盘 24h 回复率」，分及时/超时/未完成 | 无 |
| 6 | **自定义字段 + 布局设置** | 产品已有「字段设置」「布局设置」 | 无 |
| 7 | **审批流** | 订单有「审批状态」列，独立审批中心 | 无 |
| 8 | **客户动态自动归集** | 订单变更、邮件收发、聊天自动写入客户时间轴，888 条/客户 | Activity 表有，自动写入不全 |
| 9 | **建档建议** | 从邮件/聊天发现未建档往来对象，提示建档（496 条待处理） | 无 |
| 10 | **客户查重 / 合并** | 独立查重页 + 详情页「合并客户」 | 有 nameKey 防撞单，无合并 |
| 11 | **节日日历** | 日程内置各国节日 + 跨境大促 | 无 |
| 12 | **时区时钟 / 汇率计算器** | 工作台头部 | 无（汇率数据已有） |
| 13 | **可配置工作台** | 业务组件 4 个 + 报表组件 40+，自由挂载 | 固定页面 |
| 14 | **AI 问数** | 自然语言查询，60+ 预置问题 | 无 |
| 15 | **报表中心** | 9 大模块，每指标三视图，可下钻 | reports 单页 |
| 16 | **邮件真集成** | 多邮箱 IMAP/SMTP，邮件与客户自动关联 | 占位页 |

### D. 状态机对照

已核对 `prisma/schema.prisma`，差距如下：

**线索** —— 我们 4 态，OKKI 5 态且更细
| OKKI | 我们 `LeadStatus` |
|---|---|
| 待处理 | `NEW` |
| 完善信息 | 缺 |
| 初步触达 | `CONTACTED` |
| 联系互动 | 缺（与"初步触达"区分首次触达和已有来回） |
| 已完成线索 | `CONVERTED` |
| — | `INVALID`（OKKI 用"无效理由"维度，报表里有「不同无效理由的线索数占比」） |

建议补 `QUALIFYING`（完善信息）与 `ENGAGED`（联系互动），并把 `INVALID` 拆出 `invalidReason` 字段。

**报价单** —— 我们是"客户视角"，OKKI 是"流程视角"
| OKKI | 我们 `QuotationStatus` |
|---|---|
| 草稿 | `DRAFT` |
| 已报价 | `SENT` |
| 已批准 | 缺（内部审批通过） |
| 已下单 / 已转订单 | 缺（我们用 `ACCEPTED` 近似） |
| 已作废 | 近似 `EXPIRED`（但 OKKI 是人工作废，我们是到期失效） |
| — | `REJECTED` |

关键差异：OKKI 有**内部审批**（已批准）和**转订单**（已转订单）两个流程节点，我们没有。

**订单** —— 我们缺收款与售后段
| OKKI | 我们 `OrderStatus` |
|---|---|
| 草稿 | 缺 |
| 已下单 | `CONFIRMED` |
| 待收款 | 缺（OKKI 该状态占 43 单，是主力状态） |
| 待发货 | 近似 `PRODUCING` |
| 已发货 | `SHIPPED` |
| 已完成 | `COMPLETED` |
| 售后 | 缺 |
| 已作废 | `CANCELLED` |

OKKI 订单还有 **ERP 状态**、**审批状态** 两个独立维度，与主状态正交。我们只有单一状态列。

**商机** —— `StageKind` 只有 OPEN/WON/LOST 三类，`Stage` 表可配阶段，方向对。
但需确认是否支持**多套销售流程**（OKKI 显示"默认销售流程"，暗示可建多套，例如新客 vs 返单走不同阶段）。

---

## 三、升级路线

### P2.5 —— 先收尾（1～2 天）

1. 提交并合并 `deploy-caddy-https`
2. 在服务器实跑一次完整部署，验证 HTTPS、迁移、备份脚本
3. 按 D 节补齐状态机枚举：
   - `LeadStatus` 加 `QUALIFYING` / `ENGAGED`，`Lead` 加 `invalidReason`
   - `QuotationStatus` 加 `APPROVED`（内部批准）/ `CONVERTED`（已转订单）
   - `OrderStatus` 加 `DRAFT` / `PENDING_PAYMENT`（待收款）/ `AFTER_SALE`（售后）
   - `Order` 加 `approvalStatus`，与主状态正交

### P3 —— 信息架构重构 + 工作台（优先级最高）

**为什么先做这个**：后面所有功能都挂在这套骨架上。先做骨架，后续每个功能都是增量；反过来先做单功能，之后要重构两遍。

4. **导航重构**：12 个一级菜单 + 二级菜单机制
   - 交易 = 产品 / 报价单 / 销售订单 / 回款登记 / 回款单 / 物流
   - 协同 = 日程 / 审批 / 任务 / 通讯录 / 云盘
   - 团队数据 = 目标完成 / 统计报表 / 工作报告 / 跟进动态
   - 客户 = 客户列表 / 公海 / 建档建议 / 查重 / 客户设置
5. **可配置工作台**：卡片注册表 + 用户级布局（卡片 key、顺序、显隐）
6. 顶栏全局搜索（带类型下拉）、导航未读角标
7. 工作台头部：时区时钟 + 汇率计算器（复用已有 `ExchangeRate`）

### P4 —— 客户模型补强 + 客群

8. 补齐 B 节列出的客户字段，**所有行为时间戳由事件统一写入**（建一个 `touchCustomer(customerId, eventType, at)` 收口）
9. **客群**：`CustomerSegment` 表存筛选 DSL，带计数缓存，支持嵌套
10. **公海规则按客群配置**：规则 = 客群 + N 天未联系 + 生效时间；提前 7 天提醒
11. 客户详情页改版：当地时间、分位数价值分析、动态时间轴（全部/跟进记录/往来邮件/聊天/其它）
12. 客户合并、查重页

### P5 —— 节日日历 + 任务引擎

13. **节日日历**：国家 → 节日表，按客户所在国在日程显示；含宗教节日、国庆日、跨境大促（双十一/黑五/网一/斋月）
14. **任务规则引擎**：规则（目标客群 + 周期 + 动作）→ 定时生成任务 → 即将超时/已超时统计
15. **统一待办流**（工作台卡片）：待回复消息、待跟进客户、待审批、商机推进聚合，先做规则版

### P6 —— 邮件真集成（原定优先渠道）

16. 多邮箱 IMAP/SMTP 绑定，收发同步 worker
17. 邮件与客户/联系人自动关联（按域名和邮箱）
18. 邮件归档到客户动态，回填 `lastMailSentAt` / `lastMailRecvAt`
19. **建档建议**：从邮件往来中发现未建档对象
20. 邮件 SLA：24h 回复率统计

### P7 —— 目标与报表

21. 目标管理：目标规则（指标 + 周期 + 考核范围）+ 完成度
22. 报表中心：9 模块分组，每指标三视图（完成情况/变化情况/详情）
23. 优先做三张高性价比报表：销售漏斗、客户流失预警、工作量统计

### P8 —— 其余

24. 自定义字段 + 布局设置
25. 审批流
26. WhatsApp 集成
27. AI 问数、AI 客户分析

---

## 四、不建议抄的部分

- **OKKI Leads 获客模块**：依赖海关数据、展会数据、社媒数据等外部数据源采购，成本极高，且非 CRM 核心
- **阿里国际站深度集成**：阿里商品、阿里信保订单、阿里 TM —— 除非明确有阿里店铺客户，否则投入产出比低
- **云盘**：用对象存储 + 文档 Tab 即可，不必做独立网盘
- **钉钉审批**：国内集成，优先级低于基础审批流

---

## 五、立即可做的最小一步

**可配置工作台骨架**。理由：

- 改动集中在前端 + 一张 `DashboardLayout` 表，不碰业务逻辑
- 后续节日日历、待办流、目标卡片、报表全部是往这个骨架挂卡片，边际成本低
- 现有 `dashboard` 页可以直接拆成第一批卡片

次选是**节日日历** —— 纯静态数据 + 一个关联查询，但外贸特色立刻显现。
