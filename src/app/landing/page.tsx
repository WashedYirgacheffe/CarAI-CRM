import type { Metadata } from "next";
import { ArrowDown, Building2 } from "lucide-react";
import { Brand, BrandMark } from "@/components/brand";
import { AgentAvatar } from "@/components/agentes/agent-avatar";
import { LandingHeader } from "@/components/landing/landing-header";
import { HeroBeamCanvas, HeroCtaRow } from "@/components/landing/hero-beam-canvas";
import { AppWindowPreview } from "@/components/landing/app-window-preview";
import { NetworkCanvasSection } from "@/components/landing/network-canvas";
import { BentoFeaturesSection } from "@/components/landing/bento-features";
import { ModuleDirectorySection } from "@/components/landing/module-directory";
import { TeamsStackSection } from "@/components/landing/teams-stack";
import { ChromaticShowcase } from "@/components/landing/chromatic-showcase";
import { DownloadSection } from "@/components/landing/download-section";
import { FaqAndPostCta } from "@/components/landing/faq-and-cta";
import { getDesktopReleases } from "@/server/desktop-releases";
import "./landing.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CarAI · 车车外贸 CRM | AI 驱动的多渠道外贸工作台",
  description:
    "将个人微信零封号工作台、WhatsApp、外贸邮件、海外社媒矩阵、AI 外贸单据、客户公海、订单物流与应收回款融为一体。",
  openGraph: {
    title: "CarAI · 车车外贸 CRM",
    description: "面向中小外贸与汽车出口团队的 AI 多渠道 CRM：微信零封号桥接、WhatsApp、邮件、社媒矩阵与 AI 单据。",
    url: "https://caraicrm.com",
    siteName: "CarAI CRM",
    type: "website",
  },
};

const CRM_APP_URL = "https://crm.caraicrm.com";

export default async function LandingPage() {
  const releases = await getDesktopReleases();

  return (
    <div className="lp-root relative min-h-svh overflow-x-clip bg-[#fbfbfa] text-[#151514] selection:bg-[#0063d1]/15">
      <LandingHeader crmUrl={CRM_APP_URL} />

      <main>
        {/* 首屏：背景与网格通顶至 y = 0，直接以超大主标 + 活体 AgentAvatar + 交互工作台开场 */}
        <section className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
          <div
            aria-hidden
            className="lp-grid-bg pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_85%_68%_at_50%_26%,black_30%,transparent_100%)]"
          />
          <HeroBeamCanvas />

          <div className="relative z-10 mx-auto max-w-[1200px] px-5 text-center">
            <h1 className="mx-auto flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2 font-brand text-[clamp(2.85rem,7.6vw,6rem)] leading-[0.98] font-semibold tracking-[-0.055em] text-[#151514]">
              <span>认识</span>
              <span className="inline-flex items-center justify-center rounded-[26%] bg-[#e3eefd] p-1.5 shadow-[0_8px_24px_-8px_rgba(0,99,209,0.35),0_0_0_1px_rgba(0,99,209,0.18)]">
                <AgentAvatar name="CarAI Hero" size="lg" state="idle" appearance={{ color: "sky", eyes: "dots" }} />
              </span>
              <span>车车外贸 CRM</span>
            </h1>

            <p className="lp-body mx-auto mt-6 max-w-[46ch] text-[#5c5c58]">
              在一台 AI 驱动的外贸工作台里，打通个人微信、WhatsApp、外贸邮件、海外社媒矩阵与 10 种外贸单据。
            </p>

            <HeroCtaRow releases={releases} crmUrl={CRM_APP_URL} />

            <AppWindowPreview />
          </div>
        </section>

        {/* 全渠道 AI 协同路由网络 */}
        <NetworkCanvasSection />

        {/* 不对称核心能力矩阵 */}
        <BentoFeaturesSection />

        {/* 分段切换全站 36 项能力目录 */}
        <ModuleDirectorySection />

        {/* 粘性堆叠团队架构卡片 */}
        <TeamsStackSection crmUrl={CRM_APP_URL} />

        {/* 光学折光玻璃透镜核心承诺 */}
        <ChromaticShowcase />

        {/* 多平台下载与部署中心 */}
        <DownloadSection releases={releases} crmUrl={CRM_APP_URL} />

        {/* 常见问题与活体群像收尾 */}
        <FaqAndPostCta crmUrl={CRM_APP_URL} />
      </main>

      {/* 4 列页脚 */}
      <footer className="border-t border-black/[0.08] bg-white px-5 py-16">
        <div className="mx-auto grid max-w-[1160px] gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <div>
            <a href="#" className="inline-flex items-center gap-2.5">
              <BrandMark className="size-8 rounded-[24%]" />
              <Brand className="h-[22px]" />
            </a>
            <p className="lp-sm mt-4 max-w-xs text-[#5c5c58]">
              面向中小外贸与汽车出口团队的 AI 多渠道客户跟进系统，把沟通、制单与交易闭环收进同一台工作台。
            </p>
            <a
              href="#download"
              className="lp-sm mt-5 inline-flex items-center gap-1.5 font-semibold text-[#0063d1] underline-offset-4 transition-colors duration-150 hover:underline"
            >
              <span>下载车车 CRM 桌面版</span>
              <ArrowDown className="size-3.5" />
            </a>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            <div>
              <p className="lp-sm font-semibold text-[#151514]">多渠道沟通</p>
              <ul className="mt-3 space-y-2.5 text-[#5c5c58]">
                <li><a href="#preview" className="lp-sm transition-colors duration-150 hover:text-[#151514]">个人微信工作台</a></li>
                <li><a href="#preview" className="lp-sm transition-colors duration-150 hover:text-[#151514]">WhatsApp 实时翻译</a></li>
                <li><a href="#modules" className="lp-sm transition-colors duration-150 hover:text-[#151514]">外贸邮件追踪</a></li>
                <li><a href="#preview" className="lp-sm transition-colors duration-150 hover:text-[#151514]">海外社媒矩阵</a></li>
              </ul>
            </div>
            <div>
              <p className="lp-sm font-semibold text-[#151514]">AI 与交易闭环</p>
              <ul className="mt-3 space-y-2.5 text-[#5c5c58]">
                <li><a href="#preview" className="lp-sm transition-colors duration-150 hover:text-[#151514]">AI 外贸单据</a></li>
                <li><a href="#features" className="lp-sm transition-colors duration-150 hover:text-[#151514]">AI 审单与客户记忆</a></li>
                <li><a href="#modules" className="lp-sm transition-colors duration-150 hover:text-[#151514]">客户公海与防撞单</a></li>
                <li><a href="#modules" className="lp-sm transition-colors duration-150 hover:text-[#151514]">出运物流与应收账龄</a></li>
              </ul>
            </div>
            <div>
              <p className="lp-sm font-semibold text-[#151514]">下载与部署</p>
              <ul className="mt-3 space-y-2.5 text-[#5c5c58]">
                <li><a href="/api/desktop/download?arch=win" className="lp-sm transition-colors duration-150 hover:text-[#151514]">Windows 桌面版</a></li>
                <li><a href="/api/desktop/download?arch=arm64" className="lp-sm transition-colors duration-150 hover:text-[#151514]">macOS Apple 芯片</a></li>
                <li><a href="/api/desktop/download?arch=x64" className="lp-sm transition-colors duration-150 hover:text-[#151514]">macOS Intel 芯片</a></li>
                <li><a href="#download" className="lp-sm transition-colors duration-150 hover:text-[#151514]">Docker 私有化部署</a></li>
              </ul>
            </div>
            <div>
              <p className="lp-sm font-semibold text-[#151514]">快速入口</p>
              <ul className="mt-3 space-y-2.5 text-[#5c5c58]">
                <li><a href={`${CRM_APP_URL}/login`} className="lp-sm transition-colors duration-150 hover:text-[#151514]">登录 CRM 后台</a></li>
                <li><a href={`${CRM_APP_URL}/register`} className="lp-sm transition-colors duration-150 hover:text-[#151514]">注册企业空间</a></li>
                <li><a href="#teams" className="lp-sm transition-colors duration-150 hover:text-[#151514]">团队架构优势</a></li>
                <li><a href="#faq" className="lp-sm transition-colors duration-150 hover:text-[#151514]">常见问题</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-12 flex max-w-[1160px] flex-col items-center justify-between gap-3 border-t border-black/[0.06] pt-6 text-[#5c5c58] sm:flex-row">
          <p className="lp-sm">© {new Date().getFullYear()} CarAI · 车车外贸 CRM，保留所有权利。</p>
          <p className="lp-sm inline-flex items-center gap-1.5">
            <Building2 className="size-4 text-[#0063d1]" />
            <span>支持 Windows、macOS、Web 与移动端</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
