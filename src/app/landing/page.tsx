import type { Metadata } from "next";
import {
  ArrowDown,
  BarChart3,
  Bot,
  Building2,
  FileText,
  Globe,
  Laptop,
  Mail,
  MessageCircle,
  MessagesSquare,
  Monitor,
  Package,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Brand, BrandMark } from "@/components/brand";
import { AgentAvatar } from "@/components/agentes/agent-avatar";
import { LandingHeader } from "@/components/landing/landing-header";
import { HeroBeamCanvas, HeroCtaRow } from "@/components/landing/hero-beam-canvas";
import { AppWindowPreview } from "@/components/landing/app-window-preview";
import { NetworkCanvasSection } from "@/components/landing/network-canvas";
import { BentoFeaturesSection } from "@/components/landing/bento-features";
import { TeamsStackSection } from "@/components/landing/teams-stack";
import { ChromaticShowcase } from "@/components/landing/chromatic-showcase";
import { DownloadSection } from "@/components/landing/download-section";
import { FaqAndPostCta } from "@/components/landing/faq-and-cta";
import { getDesktopReleases } from "@/server/desktop-releases";
import "./landing.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CarAI · 车车外贸 CRM — 在一台 AI 驱动的工作台里运转你的外贸业务",
  description:
    "将个人微信零封号工作台、WhatsApp、外贸邮件、TikTok/IG/LinkedIn 社媒矩阵、AI 10 种外贸单据、客户公海、订单物流与应收回款融为一体。",
  openGraph: {
    title: "CarAI · 车车外贸 CRM",
    description: "面向外贸与汽车出口团队的下一代 AI 多渠道 CRM：微信零封号桥接 · WhatsApp · 邮件 · 社媒矩阵 · AI 单据。",
    url: "https://caraicrm.com",
    siteName: "CarAI CRM",
    type: "website",
  },
};

const CRM_APP_URL = "https://crm.caraicrm.com";

const MODULE_GROUPS = [
  {
    title: "多渠道沟通与收件箱",
    color: "#12804a",
    bg: "#dcf7e6",
    icon: MessagesSquare,
    items: [
      "个人微信独立 Tab（白名单只读同步 + 半自动一键上屏 + 回执闭环）",
      "WhatsApp 手机号配对码 / 扫码直连、双向收发与直发报价单文件",
      "IMAP / SMTP 企业邮箱全量同步、按公司域名自动归档客户",
      "TikTok / Instagram / Facebook / LinkedIn / X 统一社媒收件箱",
      "阿语 / 俄语 / 西语 / 英语等 25+ 语种外文消息自动秒译中文",
      "快捷回复变量模板（自动替换客户名、联系人、公司名）",
    ],
  },
  {
    title: "车车 AI 副驾驶与自动化",
    color: "#0063d1",
    bg: "#e3eefd",
    icon: Bot,
    items: [
      "AI 对话全量执行：直接查客户、改字段、建商机、建提醒任务",
      "AI 客户长期记忆自动提炼（背景速览、产品偏好、下次跟进建议）",
      "联网客户背调（自动穿透官网、社媒与企业背景）",
      "AI 外贸单据工作台（/doc）：按公司样本出 PI / CI / PL 等 10 种单据",
      "邮件 AI 意图识别、摘要与高意向优先级自动标注",
      "客户文件多模态解读（扫描 PDF 裁白边按页识别 + Word/Excel 预览）",
    ],
  },
  {
    title: "海外获客、社媒矩阵与营销",
    color: "#7c4dff",
    bg: "#efe7ff",
    icon: Globe,
    items: [
      "内置「车车浏览器」（Camoufox 独立指纹 + 代理 IP 隔离防关联）",
      "桌面端常驻后台静默监听社媒私信，账号封面快照实时可见",
      "社媒浏览器环境加密打包迁移（本机与云端无缝切换免重登）",
      "邮件自动化营销序列（Sequences）与打开 / 点击 / 退订全量追踪",
      "销售专属对外聚合主页（Link-in-Bio）与访客访问记录追踪",
      "陌生来信 / 询盘自动建档建议与大客户星级社媒动态跟踪",
    ],
  },
  {
    title: "客户公海、商机与交易闭环",
    color: "#00a896",
    bg: "#d8f5f0",
    icon: Package,
    items: [
      "客户 360° 档案、多维查重防撞单、客群自定义分层筛选",
      "公海自动回收规则（支持按客群独立天数、每日领取与私海上限）",
      "商机阶段拖拽看板、多币种产品库（支持图片与视频展示）",
      "多币种报价单（锁定汇率快照、换币种自动折算）一键转订单",
      "出运物流单证追踪、分期收款计划、应收账龄与逾期自动催款",
      "自定义工作台画布、世界时钟、实时汇率换算与每日待办中心",
    ],
  },
  {
    title: "团队权限、审批与安全审计",
    color: "#b25e00",
    bg: "#ffefd2",
    icon: ShieldCheck,
    items: [
      "多租户架构隔离 + 树形组织部门架构与灵活角色权限点",
      "本人 / 本部门（含下级） / 全公司三级精细化数据可见范围",
      "超折扣报价、退回公海、删除或转移客户多级审批流",
      "社媒私信联系方式与主页链接脱敏权限，严防私下飞单",
      "全链路操作审计日志（AuditLog），关键业务变动有据可查",
      "团队业绩统计、询盘来源转化漏斗与跟进沟通量数据报表",
    ],
  },
  {
    title: "多终端与企业级部署体验",
    color: "#e5487a",
    bg: "#fde4ee",
    icon: BarChart3,
    items: [
      "Windows 桌面版（主力推荐，支持托盘一键检测自动更新）",
      "macOS 桌面版（Apple Silicon M1–M4 原生 + Intel x64 兼容）",
      "手机移动端 PWA 适配（外出展会随时跟单、回消息、批审批）",
      "阿里云 OSS 私有签名存储与 PDF / Office 全宽原样在线预览",
      "A4 规范报价单 / PI 打印页，直接导出高清晰 PDF 发客户",
      "支持自有服务器 Docker Compose 独立部署与每日自动定时备份",
    ],
  },
];

export default async function LandingPage() {
  const releases = await getDesktopReleases();
  const winVer = releases.win.version ? `v${releases.win.version}` : "最新版";

  return (
    <div className="relative min-h-svh overflow-x-clip bg-[#fbfbfa] text-[#151514] selection:bg-[#0063d1]/15">
      <LandingHeader crmUrl={CRM_APP_URL} />

      <main>
        {/* ── Section 0: Hero + 右侧高能流光束 + 1:1 真实车车 CRM 交互预览窗口 ── */}
        <section className="relative overflow-hidden pt-10 pb-16 sm:pt-16 sm:pb-24">
          {/* 网格 + 右侧动态粒子光柱 */}
          <div
            aria-hidden
            className="lp-grid-bg pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_85%_68%_at_50%_30%,black_30%,transparent_100%)]"
          />
          <HeroBeamCanvas />

          <div className="relative z-10 mx-auto max-w-[1200px] px-5 text-center">
            {/* 1:1 openbot.run 可用性平台胶囊 */}
            <a
              href="#download"
              className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-white/80 px-3.5 py-1.5 text-xs text-[#2a2a28] shadow-[0_2px_10px_-3px_rgba(21,21,20,0.08),0_0_0_1px_rgba(21,21,20,0.08)] backdrop-blur-xl transition-colors hover:bg-white"
            >
              <span className="rounded-full bg-[#0063d1] px-2 py-0.5 text-[10px] font-semibold text-white">新</span>
              <span className="font-medium text-[#5c5c58]">支持平台</span>
              <span className="inline-flex items-center gap-1 font-medium text-[#151514]">
                <Monitor className="size-3.5 text-[#0063d1]" /> Windows {winVer}
              </span>
              <span className="text-black/20">·</span>
              <span className="inline-flex items-center gap-1 font-medium text-[#151514]">
                <Laptop className="size-3.5" /> macOS
              </span>
              <span className="text-black/20">·</span>
              <span className="inline-flex items-center gap-1 font-medium text-[#151514]">
                <Globe className="size-3.5" /> Web
              </span>
              <span className="text-black/20">·</span>
              <span className="inline-flex items-center gap-1 font-medium text-[#151514]">
                <Smartphone className="size-3.5" /> 移动端
              </span>
            </a>

            {/* 1:1 openbot.run 超大 H1（正中间嵌入活的会眨眼 AgentAvatar！） */}
            <h1 className="mx-auto mt-7 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-brand text-[clamp(2.75rem,7.2vw,5.8rem)] leading-[1.02] font-semibold tracking-[-0.055em] text-[#151514]">
              <span>认识</span>
              <span className="inline-flex items-center justify-center rounded-[26%] bg-[#e3eefd] p-1.5 shadow-[0_8px_24px_-8px_rgba(0,99,209,0.35),0_0_0_1px_rgba(0,99,209,0.18)]">
                <AgentAvatar name="CarAI Hero" size="lg" state="idle" appearance={{ color: "sky", eyes: "dots" }} />
              </span>
              <span>车车外贸 CRM</span>
            </h1>

            {/* 带渠道行内高亮的清晰定位副标题 */}
            <p className="mx-auto mt-6 max-w-[740px] text-[15px] leading-[1.65] text-[#5c5c58] sm:text-[19px]">
              在一个 AI 驱动的外贸工作台里，打通{" "}
              <strong className="inline-flex items-center gap-1 font-semibold text-[#151514]">
                <MessagesSquare className="size-4 text-[#12804a]" /> 个人微信
              </strong>
              、
              <strong className="inline-flex items-center gap-1 font-semibold text-[#151514]">
                <MessageCircle className="size-4 text-[#16a34a]" /> WhatsApp
              </strong>
              、
              <strong className="inline-flex items-center gap-1 font-semibold text-[#151514]">
                <Mail className="size-4 text-[#4f46e5]" /> 外贸邮件
              </strong>
              、
              <strong className="inline-flex items-center gap-1 font-semibold text-[#151514]">
                <Globe className="size-4 text-[#7c4dff]" /> 海外社媒矩阵
              </strong>{" "}
              与{" "}
              <strong className="inline-flex items-center gap-1 font-semibold text-[#151514]">
                <FileText className="size-4 text-[#0063d1]" /> AI 制单审单
              </strong>
              。专为中小外贸与汽车出口团队打造，开箱即用。
            </p>

            {/* 1:1 分体式主下载胶囊 + 免费注册次按钮 */}
            <HeroCtaRow releases={releases} crmUrl={CRM_APP_URL} />

            {/* 1:1 真实车车 CRM 交互预览窗口 */}
            <AppWindowPreview />
          </div>
        </section>

        {/* ── Section 1: 全渠道 AI 协同路由网络 ── */}
        <NetworkCanvasSection />

        {/* ── Section 2: 12 列不对称 Bento 核心能力矩阵 ── */}
        <BentoFeaturesSection />

        {/* ── Section 3: 全站核心 + 分支功能全景能力墙 ── */}
        <section id="modules" className="mx-auto max-w-[1160px] scroll-mt-24 px-5 py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <p className="font-dot text-xs tracking-[0.2em] text-[#0063d1] uppercase">FULL FEATURE MATRIX</p>
            <h2 className="mt-3 font-brand text-3xl font-semibold tracking-[-0.03em] text-[#151514] sm:text-5xl">
              全站模块与分支亮点全景
            </h2>
            <p className="mt-3 text-sm text-[#5c5c58] sm:text-base">
              不止于沟通与客户管理，涵盖从营销获客、AI 单据、多模态审单到出运回款审批的 36 项真实落地能力。
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {MODULE_GROUPS.map((g) => {
              const Icon = g.icon;
              return (
                <div key={g.title} className="lp-bento-card flex flex-col p-6">
                  <div className="flex items-center gap-3">
                    <span
                      style={{ backgroundColor: g.bg, color: g.color }}
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                    >
                      <Icon className="size-5" />
                    </span>
                    <h3 className="font-brand text-lg font-semibold text-[#151514]">{g.title}</h3>
                  </div>
                  <ul className="mt-4 space-y-2.5 text-xs leading-relaxed text-[#5c5c58]">
                    {g.items.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Section 4: 4 张粘性堆叠彩色卡片（团队架构与优势） ── */}
        <TeamsStackSection crmUrl={CRM_APP_URL} />

        {/* ── Section 5: 金属流光超大字 + 光标折射玻璃球展示区 ── */}
        <ChromaticShowcase crmUrl={CRM_APP_URL} />

        {/* ── Section 6: 6 张实色柔和粉彩多平台下载中心 ── */}
        <DownloadSection releases={releases} crmUrl={CRM_APP_URL} />

        {/* ── Section 7 & 8: FAQ 手风琴 + 活体 AgentAvatar 群像矩阵 CTA ── */}
        <FaqAndPostCta crmUrl={CRM_APP_URL} />
      </main>

      {/* ── Section 9: 1:1 openbot.run 4 列目录页脚 ── */}
      <footer className="mt-10 border-t border-black/[0.08] bg-white px-5 py-16">
        <div className="mx-auto grid max-w-[1160px] gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          {/* 左侧品牌列 */}
          <div>
            <a href="#" className="inline-flex items-center gap-2.5">
              <BrandMark className="size-8 rounded-[24%]" />
              <Brand className="h-5" />
            </a>
            <p className="mt-4 max-w-xs text-xs leading-relaxed text-[#5c5c58]">
              面向中小外贸与汽车出口团队的 AI 多渠道客户跟进系统：把微信、WhatsApp、邮件、海外社媒与单据交易收进同一台高效工作台。
            </p>
            <a
              href="#download"
              className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0063d1] hover:underline"
            >
              <span>下载车车 CRM 桌面版</span>
              <ArrowDown className="size-3.5" />
            </a>
          </div>

          {/* 右侧 4 列目录 */}
          <div className="grid grid-cols-2 gap-8 text-xs sm:grid-cols-4">
            <div>
              <p className="font-semibold text-[#151514]">多渠道沟通</p>
              <ul className="mt-3 space-y-2 text-[#5c5c58]">
                <li><a href="#preview" className="hover:text-[#151514]">个人微信工作台</a></li>
                <li><a href="#preview" className="hover:text-[#151514]">WhatsApp 实时翻译</a></li>
                <li><a href="#modules" className="hover:text-[#151514]">外贸邮件追踪</a></li>
                <li><a href="#preview" className="hover:text-[#151514]">海外社媒矩阵</a></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-[#151514]">AI 与交易闭环</p>
              <ul className="mt-3 space-y-2 text-[#5c5c58]">
                <li><a href="#preview" className="hover:text-[#151514]">AI 外贸单据 (/doc)</a></li>
                <li><a href="#features" className="hover:text-[#151514]">AI 审单与客户记忆</a></li>
                <li><a href="#modules" className="hover:text-[#151514]">客户公海与防撞单</a></li>
                <li><a href="#modules" className="hover:text-[#151514]">出运物流与应收账龄</a></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-[#151514]">下载与部署</p>
              <ul className="mt-3 space-y-2 text-[#5c5c58]">
                <li><a href="/api/desktop/download?arch=win" className="hover:text-[#151514]">Windows 桌面版</a></li>
                <li><a href="/api/desktop/download?arch=arm64" className="hover:text-[#151514]">macOS Apple 芯片</a></li>
                <li><a href="/api/desktop/download?arch=x64" className="hover:text-[#151514]">macOS Intel 芯片</a></li>
                <li><a href="#download" className="hover:text-[#151514]">Docker 私有化部署</a></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-[#151514]">快速入口</p>
              <ul className="mt-3 space-y-2 text-[#5c5c58]">
                <li><a href={`${CRM_APP_URL}/login`} className="hover:text-[#151514]">登录 CRM 后台</a></li>
                <li><a href={`${CRM_APP_URL}/register`} className="hover:text-[#151514]">注册企业空间</a></li>
                <li><a href="#teams" className="hover:text-[#151514]">团队架构优势</a></li>
                <li><a href="#faq" className="hover:text-[#151514]">常见问题 FAQ</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-12 flex max-w-[1160px] flex-col items-center justify-between gap-3 border-t border-black/[0.06] pt-6 text-[11px] text-[#6f6f6a] sm:flex-row">
          <p>© {new Date().getFullYear()} CarAI · 车车外贸 CRM，保留所有权利。</p>
          <p className="inline-flex items-center gap-1.5">
            <Building2 className="size-3.5 text-[#0063d1]" />
            支持 Windows · macOS · Web · iOS/Android PWA
          </p>
        </div>
      </footer>
    </div>
  );
}
