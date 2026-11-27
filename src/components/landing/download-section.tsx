"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUpRight, Globe, Laptop, Monitor, Server, Smartphone, Terminal } from "lucide-react";
import type { DesktopReleases } from "@/server/desktop-releases";

/**
 * 1:1 复刻 openbot.run Section 6：2 行 × 3 列柔和粉彩实色下载大卡片（动态读取 OSS 最新版本）
 */
export function DownloadSection({ releases, crmUrl }: { releases: DesktopReleases; crmUrl: string }) {
  const [os, setOs] = useState<"win" | "mac" | "other">("win");

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Macintosh|Mac OS X/i.test(ua)) setOs("mac");
    else if (/Windows/i.test(ua)) setOs("win");
    else setOs("other");
  }, []);

  const winVer = releases.win.version ? `v${releases.win.version}` : "最新版";
  const macVer = releases.macArm64.version ? `v${releases.macArm64.version}` : "最新版";

  const topCards = [
    {
      key: "win",
      title: "Windows",
      bg: "#b8f0d0",
      badge: os === "win" || os === "other" ? "主力推荐 · 当前系统" : "外贸主力版",
      meta: `Windows 10 / 11 · x64 · ${winVer}${releases.win.sizeMb ? ` · ${releases.win.sizeMb} MB` : ""}`,
      desc: "含个人微信 4.0/3.9 零封号一键上屏桥接、白名单只读同步与社媒车车浏览器，支持静默自动更新。",
      icon: Monitor,
      primary: { label: `下载 Windows 版 (${winVer})`, href: "/api/desktop/download?arch=win" },
      secondary: { label: "查看 Windows 安装说明", href: "#faq" },
    },
    {
      key: "mac",
      title: "macOS",
      bg: "#e5cdfc",
      badge: os === "mac" ? "当前系统推荐" : "可用",
      meta: `macOS 13+ · Apple Silicon · ${macVer}${releases.macArm64.sizeMb ? ` · ${releases.macArm64.sizeMb} MB` : ""}`,
      desc: "原生 M1–M4 芯片加速，支持微信快捷上屏、chatlog 本机只读同步与海外社媒矩阵本地运行器。",
      icon: Laptop,
      primary: { label: `下载 macOS Apple 芯片版`, href: "/api/desktop/download?arch=arm64" },
      secondary: { label: "下载 Intel Mac 版 (.dmg)", href: "/api/desktop/download?arch=x64" },
    },
    {
      key: "web",
      title: "Web 网页版",
      bg: "#fae2aa",
      badge: "免安装即用",
      meta: "Chrome · Edge · Safari · 随时随地访问",
      desc: "无需下载客户端，打开浏览器即可使用客户公海、邮件追踪、WhatsApp、AI 单据、订单物流与团队报表。",
      icon: Globe,
      primary: { label: "直接登录 Web CRM", href: `${crmUrl}/login` },
      secondary: { label: "60 秒注册新企业空间", href: `${crmUrl}/register` },
    },
  ];

  const bottomCards = [
    {
      key: "pwa",
      title: "手机移动版 (PWA)",
      bg: "#c2e0ff",
      meta: "iOS Safari / Android Chrome · 添加到主屏幕",
      desc: "外出跑展会、见客户随时查档案、回 WhatsApp、用手机底部 AI 助手查报价、一键批审批。",
      icon: Smartphone,
      href: `${crmUrl}/login`,
      cta: "手机浏览器打开",
    },
    {
      key: "chatlog",
      title: "微信 4.0 本地只读配套",
      bg: "#fbd1c3",
      meta: "配合桌面版 · 本机 127.0.0.1:5030 只读直连",
      desc: "桌面版内置白名单同步引擎，开启本机 chatlog 只读服务后每 20 秒自动增量入库并回执发送状态。",
      icon: Terminal,
      href: `${crmUrl}/wechat`,
      cta: "打开微信同步设置",
    },
    {
      key: "docker",
      title: "企业私有化部署",
      bg: "#c9edd8",
      meta: "Docker Compose · PostgreSQL + Redis + Caddy",
      desc: "支持部署在企业自有阿里云 / 腾讯云服务器，自动 HTTPS 与每日数据库/附件定时备份，数据 100% 自主掌控。",
      icon: Server,
      href: `${crmUrl}/register`,
      cta: "了解企业版 / 试用",
    },
  ];

  return (
    <section id="download" className="mx-auto max-w-[1160px] scroll-mt-24 px-5 py-24 sm:py-32">
      <div className="max-w-2xl">
        <p className="font-dot text-xs tracking-[0.2em] text-[#0063d1] uppercase">DOWNLOAD CARAI DESKTOP</p>
        <h2 className="mt-3 font-brand text-3xl font-semibold tracking-[-0.03em] text-[#151514] sm:text-5xl">
          下载车车 CRM
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[#5c5c58] sm:text-base">
          桌面版与云端 CRM 实时同步。下载安装后登录账号即自动完成本机配对，后续新版本由系统托盘自动检测并静默推送。
        </p>
      </div>

      {/* 第一行：3 张高大实色主下载卡片 */}
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {topCards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.key}
              style={{ backgroundColor: c.bg }}
              className="flex min-h-[380px] flex-col justify-between rounded-[22px] p-6 text-[#151514] ring-1 ring-[#151514]/15 transition-transform duration-200 hover:-translate-y-1 sm:p-7"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-white/60 ring-1 ring-black/[0.08]">
                    <Icon className="size-6 stroke-[1.6]" />
                  </span>
                  <span className="rounded-full bg-[#151514]/10 px-3 py-1 text-[11px] font-semibold text-[#151514]">
                    {c.badge}
                  </span>
                </div>

                <h3 className="mt-7 font-brand text-2xl font-semibold tracking-tight">{c.title}</h3>
                <p className="mt-1 font-mono text-[11px] text-[#151514]/65">{c.meta}</p>
                <p className="mt-3 text-xs leading-relaxed text-[#151514]/80">{c.desc}</p>
              </div>

              <div className="mt-8 space-y-2.5 border-t border-[#151514]/12 pt-4">
                <a
                  href={c.primary.href}
                  className="inline-flex w-full items-center justify-between rounded-xl bg-[#151514] px-4 py-3 text-xs font-semibold text-white transition-colors hover:bg-[#2a2a28]"
                >
                  <span>{c.primary.label}</span>
                  <ArrowUpRight className="size-4" />
                </a>
                <a
                  href={c.secondary.href}
                  className="inline-flex w-full items-center justify-between rounded-xl px-2 py-1 text-xs font-medium text-[#151514]/80 transition-colors hover:text-[#151514]"
                >
                  <span>{c.secondary.label}</span>
                  <ArrowDown className="size-3.5" />
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {/* 第二行：3 张延伸终端与生态卡片 */}
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {bottomCards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.key}
              style={{ backgroundColor: c.bg }}
              className="flex min-h-[250px] flex-col justify-between rounded-[22px] p-6 text-[#151514] ring-1 ring-[#151514]/15 transition-transform duration-200 hover:-translate-y-1"
            >
              <div>
                <span className="flex size-10 items-center justify-center rounded-xl bg-white/60 ring-1 ring-black/[0.08]">
                  <Icon className="size-5 stroke-[1.6]" />
                </span>
                <h3 className="mt-5 font-brand text-xl font-semibold tracking-tight">{c.title}</h3>
                <p className="mt-1 font-mono text-[10px] text-[#151514]/65">{c.meta}</p>
                <p className="mt-2.5 text-xs leading-relaxed text-[#151514]/80">{c.desc}</p>
              </div>
              <a
                href={c.href}
                className="mt-5 inline-flex items-center justify-between border-t border-[#151514]/12 pt-3 text-xs font-semibold text-[#151514] hover:opacity-75"
              >
                <span>{c.cta}</span>
                <ArrowUpRight className="size-4" />
              </a>
            </div>
          );
        })}
      </div>

      {/* 系统要求提示条（1:1 复刻 openbot.run 下载区底条） */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-5 py-3.5 text-xs text-[#5c5c58] ring-1 ring-black/[0.07]">
        <span>
          <strong className="font-medium text-[#151514]">安装提示：</strong>
          Windows 首次运行若弹出 SmartScreen 蓝屏保护，点击「更多信息」→「仍要运行」即可；桌面版后续升级支持托盘一键检测自动更新。
        </span>
        <span className="font-mono text-[11px] text-[#0063d1]">
          Win {winVer} · Mac {macVer}
        </span>
      </div>
    </section>
  );
}
