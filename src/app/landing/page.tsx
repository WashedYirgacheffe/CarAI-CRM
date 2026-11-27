import type { Metadata } from "next";
import {
  ArrowRight,
  Bot,
  Building2,
  Download,
  FileText,
  Globe,
  Mail,
  MessageCircle,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Brand, BrandMark } from "@/components/brand";
import { LandingBackdrop } from "@/components/landing/landing-backdrop";
import { LandingShowcase } from "@/components/landing/landing-showcase";
import { DownloadSection } from "@/components/landing/download-section";
import { getDesktopReleases } from "@/server/desktop-releases";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CarAI · 车车外贸 CRM — AI 驱动的多渠道外贸指挥舱",
  description:
    "将邮件、WhatsApp、个人微信零封号工作台、海外社媒矩阵与 AI 外贸单据融为一体。专为汽车及外贸出口团队打造的新一代智能 CRM。",
  openGraph: {
    title: "CarAI · 车车外贸 CRM",
    description: "邮件 · WhatsApp · 微信零封号桥接 · 海外社媒矩阵 · AI 外贸单据，一站式外贸客户跟进与成交平台。",
    url: "https://caraicrm.com",
    siteName: "CarAI CRM",
    type: "website",
  },
};

const CRM_APP_URL = "https://crm.caraicrm.com";

export default async function LandingPage() {
  const releases = await getDesktopReleases();
  const winVer = releases.win.version ? `v${releases.win.version}` : "最新版";

  return (
    <div className="relative min-h-svh overflow-x-clip bg-[#050811] text-white selection:bg-sky-400/30 selection:text-white">
      <LandingBackdrop />

      {/* ── 顶部悬浮玻璃导航 ── */}
      <header className="sticky top-0 z-40 px-4 pt-4">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between rounded-2xl border border-white/10 bg-[#070d1c]/75 px-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl">
          <a href="#" className="flex items-center gap-2.5">
            <BrandMark className="size-8 rounded-lg" />
            <Brand onDark className="h-5" />
          </a>

          <nav className="hidden items-center gap-7 text-xs font-medium text-white/65 md:flex">
            <a href="#features" className="transition-colors hover:text-white">
              核心能力
            </a>
            <a href="#channels" className="transition-colors hover:text-white">
              多渠道工作台
            </a>
            <a href="#download" className="transition-colors hover:text-white">
              桌面版下载
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={`${CRM_APP_URL}/login`}
              className="rounded-xl px-3.5 py-2 text-xs font-medium text-white/75 transition-colors hover:bg-white/8 hover:text-white"
            >
              登录 CRM
            </a>
            <a
              href={`${CRM_APP_URL}/register`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-slate-950 transition-all hover:bg-sky-50"
            >
              免费开始
              <ArrowRight className="size-3.5" />
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero 首屏 ── */}
      <main>
        <section className="mx-auto max-w-6xl px-5 pt-16 pb-12 text-center sm:pt-24">
          <a
            href="#download"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs text-sky-200 backdrop-blur-md transition-colors hover:border-sky-400/40 hover:bg-white/[0.1]"
          >
            <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            <span className="font-doto tracking-wider uppercase">{winVer} DESKTOP</span>
            <span className="text-white/75">个人微信零封号桥接已上线</span>
            <ArrowRight className="size-3 text-white/50" />
          </a>

          <h1 className="mx-auto mt-7 max-w-4xl font-brand text-4xl leading-[1.12] font-semibold tracking-tight text-white sm:text-6xl">
            把外贸生意，收进一台
            <span className="bg-gradient-to-r from-sky-300 via-blue-200 to-indigo-300 bg-clip-text text-transparent">
              {" "}
              AI 驱动的指挥舱
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-white/65 sm:text-lg">
            邮件、WhatsApp、个人微信安全上屏、海外社媒矩阵与 AI 外贸单据全链路打通。
            让每一次海外询盘从首次破冰到报价回款，都有清晰上下文与团队协作。
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a
              href={`${CRM_APP_URL}/register`}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-slate-950 shadow-[0_0_40px_-8px_rgba(125,211,252,0.65)] transition-all hover:scale-[1.01] hover:bg-sky-50"
            >
              立即免费使用
              <ArrowRight className="size-4" />
            </a>
            <a
              href="#download"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-6 text-sm font-medium text-white backdrop-blur-md transition-all hover:border-white/30 hover:bg-white/12"
            >
              <Download className="size-4 text-sky-300" />
              下载桌面版（Win / Mac）
            </a>
          </div>

          {/* 交互式工作台实景预览 */}
          <div id="channels" className="scroll-mt-24">
            <LandingShowcase />
          </div>
        </section>

        {/* ── 点阵数字亮点条 ── */}
        <section className="mx-auto max-w-6xl px-5 py-10">
          <div className="grid grid-cols-2 gap-4 rounded-2xl border border-white/8 bg-white/[0.02] p-6 sm:grid-cols-4">
            {[
              { num: "0%", label: "微信内存 Hook 侵入", sub: "只读同步 + 半自动上屏" },
              { num: "10+", label: "AI 外贸标准单据", sub: "PI / CI / PL / 报价单" },
              { num: "5+", label: "海外社媒矩阵统一收信", sub: "独立指纹防关联" },
              { num: "24/7", label: "多语种实时自动翻译", sub: "阿/俄/西/英秒级转中文" },
            ].map((stat) => (
              <div key={stat.label} className="text-center sm:text-left">
                <p className="font-doto text-3xl font-bold tracking-tight text-white sm:text-4xl">{stat.num}</p>
                <p className="mt-1 text-xs font-medium text-white/80">{stat.label}</p>
                <p className="mt-0.5 text-[11px] text-white/40">{stat.sub}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bento Grid 核心能力 ── */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20">
          <div className="max-w-2xl">
            <p className="font-doto text-xs tracking-[0.22em] text-sky-400 uppercase">BUILT FOR EXPORT TEAMS</p>
            <h2 className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              告别碎片化工具，全链路外贸提效
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/60 sm:text-base">
              专为中小外贸与汽车出口团队打磨的每一个细节：不折腾复杂配置，上手即用。
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-6">
            {/* 大卡 1：个人微信零封号工作台 */}
            <div className="group relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-white/[0.03] to-transparent p-6 md:col-span-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex size-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                  <MessagesSquare className="size-5" />
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-300">
                  <ShieldCheck className="size-3.5" />
                  零封号架构
                </span>
              </div>
              <h3 className="mt-5 text-xl font-semibold text-white">个人微信安全工作台</h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/65">
                依托车车桌面端，采用「白名单本地只读同步 + 半自动一键上屏」方案：私人聊天绝不上传，发消息时自动精准定位微信号并粘贴到输入框，由业务员核对头像后按回车发出，杜绝封号与发错客户。
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-white/70">
                <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1">兼容微信 4.0 / 3.9</span>
                <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1">发送回执自动闭环</span>
                <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1">粘贴聊天记录秒级解析</span>
              </div>
            </div>

            {/* 卡 2：WhatsApp & 邮件 */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition-colors hover:border-white/20 md:col-span-2">
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-green-500/15 text-green-300">
                <MessageCircle className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-white">WhatsApp + 邮件聚合</h3>
              <p className="mt-2 text-xs leading-relaxed text-white/60">
                扫码 / 配对码直连 WhatsApp，IMAP/SMTP 自动归档客户往来邮件并追踪打开与点击，外文消息自动译成中文。
              </p>
            </div>

            {/* 卡 3：AI 副驾驶与客户记忆 */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition-colors hover:border-white/20 md:col-span-2">
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300">
                <Bot className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-white">车车 AI 副驾驶 & 记忆</h3>
              <p className="mt-2 text-xs leading-relaxed text-white/60">
                自动从邮件与聊天中提炼客户背景、车型偏好与交期要求；一键撰写地道英文/俄语/阿语开发信与跟进回复。
              </p>
            </div>

            {/* 卡 4：AI 单据制作工作台 */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition-colors hover:border-white/20 md:col-span-2">
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                <FileText className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-white">AI 外贸单据工作台</h3>
              <p className="mt-2 text-xs leading-relaxed text-white/60">
                按公司样本版式自动生成报价单、PI、商业发票、装箱单等 10 种专业单据，自动核对金额、汇率与贸易条款。
              </p>
            </div>

            {/* 卡 5：社媒矩阵 */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition-colors hover:border-white/20 md:col-span-2">
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
                <Globe className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-white">海外社媒矩阵运行器</h3>
              <p className="mt-2 text-xs leading-relaxed text-white/60">
                独立指纹浏览器与代理隔离，多账号常驻监听 TikTok / Instagram / LinkedIn / X 私信，统一汇总进收件箱。
              </p>
            </div>

            {/* 宽卡 6：全链路外贸管理闭环 */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition-colors hover:border-white/20 md:col-span-6">
              <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2 text-xs text-amber-300">
                    <Workflow className="size-4" />
                    <span>端到端成交与风控闭环</span>
                  </div>
                  <h3 className="mt-2 text-xl font-semibold text-white">线索公海 · 商机看板 · 订单物流 · 应收账龄与审批</h3>
                  <p className="mt-2 text-xs leading-relaxed text-white/60 sm:text-sm">
                    内置客户查重防撞单、公海自动回收规则、多币种报价一键转订单、物流单证追踪、分期回款计划、折扣/删客审批流与全链路操作审计，管理层随时掌握团队真实产出。
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 text-xs">
                  {["公海回收", "查重防撞单", "多币种结算", "审批流", "操作审计"].map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-white/75">
                      <Building2 className="size-3 text-sky-400" />
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 桌面版下载中心 ── */}
        <DownloadSection releases={releases} />

        {/* ── 底部 CTA ── */}
        <section className="mx-auto max-w-6xl px-5 pt-6 pb-24">
          <div className="relative overflow-hidden rounded-3xl border border-white/12 bg-gradient-to-br from-blue-600/25 via-indigo-600/15 to-[#091022] px-6 py-14 text-center sm:px-12">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[520px] -translate-x-1/2 rounded-full bg-sky-400/20 blur-3xl"
            />
            <p className="inline-flex items-center gap-1.5 font-doto text-xs tracking-[0.2em] text-sky-300 uppercase">
              <Sparkles className="size-3.5" />
              START IN 60 SECONDS
            </p>
            <h2 className="mx-auto mt-3 max-w-2xl font-brand text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              准备好升级你的外贸客户跟进效率了吗？
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-white/65">
              注册即建企业工作空间，支持网页端直接使用或搭配 Windows / Mac 桌面版解锁全功能。
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href={`${CRM_APP_URL}/register`}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-7 text-sm font-semibold text-slate-950 transition-all hover:bg-sky-50"
              >
                免费创建企业账号
                <ArrowRight className="size-4" />
              </a>
              <a
                href={`${CRM_APP_URL}/login`}
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-6 text-sm font-medium text-white transition-all hover:bg-white/12"
              >
                已有账号，直接登录
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ── 页脚 ── */}
      <footer className="border-t border-white/8 px-5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs text-white/45 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-6 rounded-md" />
            <span>© {new Date().getFullYear()} CarAI · 车车外贸 CRM</span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <a href="#features" className="hover:text-white/80">
              核心能力
            </a>
            <a href="#download" className="hover:text-white/80">
              桌面版下载
            </a>
            <a href={`${CRM_APP_URL}/login`} className="hover:text-white/80">
              CRM 登录
            </a>
            <a href="/api/desktop/download?arch=win" className="inline-flex items-center gap-1 hover:text-white/80">
              <Mail className="size-3" />
              Windows {winVer}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
