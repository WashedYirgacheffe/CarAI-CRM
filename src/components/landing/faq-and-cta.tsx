"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, Download } from "lucide-react";
import { AgentAvatar } from "@/components/agentes/agent-avatar";
import type { AgentColorName } from "@/lib/agentes/agent/engine.js";
import { cn } from "@/lib/utils";

const FAQS = [
  {
    q: "个人微信接入车车 CRM，真的不会封号吗？",
    a: "是的。我们彻底摒弃了极易被风控扫描的 PC 内存 Hook、DLL 注入与破解 Pad 协议，采用本机只读白名单同步与半自动一键上屏方案：不改微信进程、不走外挂发包，发消息时只自动粘贴到微信输入框，最后一下回车由业务员核对头像后亲自按下，从根源上杜绝封号与发错人。",
  },
  {
    q: "接入个人微信后，业务员的私人聊天会被公司看到吗？",
    a: "不会。系统默认开启白名单隐私模式，仅同步备注带指定前缀（如「客户-」）、已在 CRM 关联或业务员手动勾选开启同步的客户会话，其余家人朋友的私人聊天完全留在本地，绝不上传服务器。",
  },
  {
    q: "Windows 桌面版首次安装提示「Windows 已保护你的电脑」怎么办？",
    a: "这是 Windows SmartScreen 对新发布安装包的标准提示。点击弹窗里的「更多信息」，再点击「仍要运行」即可正常安装；装好后软件支持在当前用户目录静默自动更新，无需管理员权限。",
  },
  {
    q: "旧版 Windows 桌面端如何升级到含微信桥接的最新版本？",
    a: "有两种方式：在 Windows 右下角系统托盘右键点击「车车 CRM」图标，选择「检查更新」自动拉取升级；或者在本页下载中心直接下载最新版覆盖安装，原有账号配对与社媒浏览器环境都会完整保留。",
  },
  {
    q: "AI 单据工作台支持哪些外贸单据？能按我们公司格式出吗？",
    a: "支持报价单、形式发票（PI）、商业发票（CI）、装箱单（PL）、销售合同、装运通知、提单草稿等 10 种常用外贸单据。在设置里上传公司抬头、银行信息和样本版式后，车车 AI 会自动按你们公司格式套版、算汇率与生成英文金额大写。",
  },
  {
    q: "海外社媒矩阵多账号同时登录，会不会互相串号关联？",
    a: "不会。车车桌面版内置基于 Camoufox 定制的车车浏览器，为每个 TikTok、Instagram、Facebook、LinkedIn 与 X 账号分配完全隔离的硬件指纹目录和独立代理 IP，并支持加密打包在多台电脑或云端之间迁移，无需重复扫码登录。",
  },
  {
    q: "多业务员同时开发客户，怎么防止内部撞单和离职带走客户？",
    a: "系统内置按邮箱域名、手机号、WhatsApp 与微信号多维查重防撞单，并配备可自定义的公海自动回收规则与每日领取上限；所有邮件、WhatsApp、微信和社媒跟进记录都沉淀在企业客户档案下，支持按部门隔离数据与联系方式脱敏权限。",
  },
  {
    q: "支持部署到我们自己的服务器吗？",
    a: "完全支持。车车 CRM 基于 Next.js、PostgreSQL、Redis 与 Caddy 容器化架构，提供开箱即用的 Docker Compose 与每日数据库和附件自动备份脚本，可轻松部署在企业自有的阿里云或腾讯云主机上。",
  },
];

const MASCOT_WALL: { name: string; color: AgentColorName; state: "idle" | "thinking" | "writing" | "waiting" }[] = [
  { name: "M1", color: "sky", state: "idle" },
  { name: "M2", color: "green", state: "thinking" },
  { name: "M3", color: "amber", state: "idle" },
  { name: "M4", color: "violet", state: "writing" },
  { name: "M5", color: "teal", state: "idle" },
  { name: "M6", color: "rose", state: "waiting" },
  { name: "M7", color: "indigo", state: "idle" },
  { name: "M8", color: "sky", state: "writing" },
  { name: "M9", color: "green", state: "idle" },
  { name: "M10", color: "amber", state: "thinking" },
  { name: "M11", color: "violet", state: "idle" },
  { name: "M12", color: "teal", state: "waiting" },
  { name: "M13", color: "rose", state: "idle" },
  { name: "M14", color: "indigo", state: "thinking" },
  { name: "M15", color: "sky", state: "idle" },
  { name: "M16", color: "green", state: "writing" },
  { name: "M17", color: "amber", state: "idle" },
  { name: "M18", color: "violet", state: "idle" },
  { name: "M19", color: "teal", state: "thinking" },
  { name: "M20", color: "rose", state: "idle" },
  { name: "M21", color: "indigo", state: "idle" },
  { name: "M22", color: "sky", state: "waiting" },
  { name: "M23", color: "green", state: "idle" },
  { name: "M24", color: "amber", state: "writing" },
];

export function FaqAndPostCta({ crmUrl }: { crmUrl: string }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <>
      {/* FAQ：无外框卡片，直接用 1px 细线排版 */}
      <section id="faq" className="mx-auto max-w-[1160px] scroll-mt-24 px-5 py-24 sm:py-32">
        <div className="grid items-start gap-12 lg:grid-cols-[5fr_7fr] lg:gap-16">
          <div className="lg:sticky lg:top-28">
            <h2 className="lp-h2 font-brand font-semibold text-[#151514]">
              常见问题
            </h2>
            <p className="lp-body mt-4 max-w-[38ch] text-[#5c5c58]">
              关于个人微信零封号原理、桌面端安装升级、AI 单据、多账号社媒与私有化部署的高频疑问都在这里。
            </p>
            <a
              href={`${crmUrl}/register`}
              className="lp-body mt-6 inline-flex items-center gap-1.5 font-medium text-[#0063d1] underline-offset-4 transition-colors duration-150 hover:underline"
            >
              <span>直接注册体验全部功能</span>
              <ArrowRight className="size-4" />
            </a>
          </div>

          <div className="divide-y divide-black/[0.09] border-t border-b border-black/[0.09]">
            {FAQS.map((item, idx) => {
              const open = openIdx === idx;
              return (
                <div key={item.q} className="py-6">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenIdx(open ? null : idx)}
                    className="flex w-full items-center justify-between gap-4 text-left"
                  >
                    <span className="lp-body font-semibold text-[#151514]">{item.q}</span>
                    <ChevronDown
                      className={cn(
                        "size-5 shrink-0 text-[#5c5c58] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                        open && "rotate-180 text-[#0063d1]",
                      )}
                    />
                  </button>
                  {open && <p className="lp-body mt-3 max-w-[60ch] pr-6 text-[#5c5c58]">{item.a}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 收尾全宽活体 AgentAvatar 群像横幅（无卡片套卡片） */}
      <section className="relative overflow-hidden border-t border-black/[0.06] bg-[#f6f9fd] px-5 py-28 text-center sm:py-36">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex flex-wrap items-center justify-center gap-6 p-6 opacity-45 [mask-image:radial-gradient(ellipse_80%_75%_at_50%_50%,transparent_22%,black_78%)]"
        >
          {MASCOT_WALL.map((m, idx) => (
            <div key={m.name} className={cn(idx % 2 === 1 && "translate-y-4")}>
              <AgentAvatar
                name={m.name}
                size="lg"
                state={m.state}
                appearance={{ color: m.color, eyes: (["dots", "round", "happy", "wide"] as const)[idx % 4] }}
              />
            </div>
          ))}
        </div>

        <div className="relative z-10 mx-auto max-w-2xl">
          <h2 className="lp-h2 font-brand font-semibold text-[#151514]">
            认识你的外贸 AI 队友
          </h2>
          <p className="lp-body mx-auto mt-4 max-w-[48ch] text-[#5c5c58]">
            下载车车 CRM 桌面版或注册网页空间，把全渠道客户沟通、制单与跟进收进同一台工作台。
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3">
            <a
              href="#download"
              className="lp-body inline-flex h-12 items-center gap-2 rounded-full bg-[#151514] px-8 font-medium text-white shadow-[0_12px_30px_-12px_rgba(21,21,20,0.45)] transition-colors duration-150 hover:bg-[#2a2a28]"
            >
              <Download className="size-4" />
              <span>下载车车桌面版</span>
            </a>
            <a
              href={`${crmUrl}/register`}
              className="lp-sm font-medium text-[#0063d1] underline-offset-4 transition-colors duration-150 hover:underline"
            >
              或免费注册网页版企业空间
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
