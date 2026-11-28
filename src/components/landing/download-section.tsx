"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Globe, Laptop, Monitor, Server, Smartphone, Terminal } from "lucide-react";
import type { DesktopReleases } from "@/server/desktop-releases";

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
      title: "Windows 桌面版",
      bg: "#e2f4ea",
      meta: `${os === "win" ? "推荐当前系统 · " : ""}Windows 10 / 11 x64 · ${winVer}${releases.win.sizeMb ? ` · ${releases.win.sizeMb} MB` : ""}`,
      desc: "含个人微信 4.0 与 3.9 零封号一键上屏桥接、白名单只读同步与社媒车车浏览器，支持系统托盘自动更新。",
      icon: Monitor,
      primary: { label: `下载 Windows 版 (${winVer})`, href: "/api/desktop/download?arch=win" },
      secondary: { label: "查看 Windows 安装说明", href: "#faq" },
    },
    {
      key: "mac",
      title: "macOS 桌面版",
      bg: "#e8f1fd",
      meta: `${os === "mac" ? "推荐当前系统 · " : ""}macOS 13+ Apple Silicon · ${macVer}${releases.macArm64.sizeMb ? ` · ${releases.macArm64.sizeMb} MB` : ""}`,
      desc: "原生支持 M1 至 M4 芯片，包含微信快捷上屏、本机只读同步与海外社媒矩阵本地运行器。",
      icon: Laptop,
      primary: { label: "下载 macOS Apple 芯片版", href: "/api/desktop/download?arch=arm64" },
      secondary: { label: "下载 Intel Mac 版 (.dmg)", href: "/api/desktop/download?arch=x64" },
    },
    {
      key: "web",
      title: "Web 网页版",
      bg: "#ffffff",
      meta: "Chrome · Edge · Safari · 免安装即用",
      desc: "无需下载客户端，打开浏览器即可使用客户公海、邮件追踪、WhatsApp、AI 单据、订单物流与团队报表。",
      icon: Globe,
      primary: { label: "直接登录 Web CRM", href: `${crmUrl}/login` },
      secondary: { label: "60 秒注册新企业空间", href: `${crmUrl}/register` },
    },
  ];

  const bottomRows = [
    {
      key: "pwa",
      title: "手机移动版 (PWA)",
      meta: "iOS Safari 与 Android Chrome 添加到主屏幕",
      desc: "外出跑展会、拜访客户时随时查档案、回 WhatsApp、用 AI 助手查报价并快速批审批。",
      icon: Smartphone,
      href: `${crmUrl}/login`,
      cta: "手机浏览器打开",
    },
    {
      key: "chatlog",
      title: "微信 4.0 本地只读配套",
      meta: "配合桌面版 · 本机 127.0.0.1:5030 只读直连",
      desc: "内置白名单同步引擎，开启本机只读服务后每 20 秒自动增量入库并回执发送状态。",
      icon: Terminal,
      href: `${crmUrl}/wechat`,
      cta: "打开微信同步设置",
    },
    {
      key: "docker",
      title: "企业私有化部署",
      meta: "Docker Compose · PostgreSQL + Redis + Caddy",
      desc: "支持部署在企业自有阿里云或腾讯云服务器，自带 HTTPS 与每日数据库附件定时备份。",
      icon: Server,
      href: `${crmUrl}/register`,
      cta: "了解企业部署方案",
    },
  ];

  return (
    <section id="download" className="mx-auto max-w-[1160px] scroll-mt-24 px-5 py-24 sm:py-32">
      <div className="max-w-2xl">
        <h2 className="lp-h2 font-brand font-semibold text-[#151514]">
          下载车车外贸 CRM
        </h2>
        <p className="lp-body mt-4 max-w-[56ch] text-[#5c5c58]">
          桌面版与云端 CRM 实时同步。下载安装后登录账号即自动完成本机配对，后续新版本由系统托盘自动检测推送。
        </p>
      </div>

      {/* 主平台 3 列高对比面板 */}
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {topCards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.key}
              style={{ backgroundColor: c.bg }}
              className="flex min-h-[370px] flex-col justify-between rounded-[26px] p-7 text-[#151514] shadow-[0_1px_2px_rgba(21,21,20,0.04),0_0_0_1px_rgba(21,21,20,0.09)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1"
            >
              <div>
                <span className="flex size-11 items-center justify-center rounded-2xl bg-white/80 text-[#151514] ring-1 ring-black/[0.07]">
                  <Icon className="size-5 stroke-[1.6]" />
                </span>

                <h3 className="lp-body mt-6 font-semibold text-[#151514]">{c.title}</h3>
                <p className="lp-sm mt-1 text-[#5c5c58] tabular-nums">{c.meta}</p>
                <p className="lp-body mt-4 text-[#2a2a28]">{c.desc}</p>
              </div>

              <div className="mt-8 space-y-3 border-t border-black/[0.09] pt-5">
                <a
                  href={c.primary.href}
                  className="lp-sm inline-flex w-full items-center justify-between rounded-full bg-[#151514] px-5 py-3 font-medium text-white tabular-nums transition-colors duration-150 hover:bg-[#2a2a28]"
                >
                  <span>{c.primary.label}</span>
                  <ArrowUpRight className="size-4 shrink-0" />
                </a>
                <a
                  href={c.secondary.href}
                  className="lp-sm inline-flex items-center gap-1 font-medium text-[#5c5c58] underline-offset-4 transition-colors duration-150 hover:text-[#151514] hover:underline"
                >
                  <span>{c.secondary.label}</span>
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {/* 延伸终端与部署：1px 细线分隔的建筑三列 */}
      <div className="mt-12 grid gap-8 border-t border-black/[0.09] pt-10 md:grid-cols-3">
        {bottomRows.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.key} className="flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2.5 text-[#151514]">
                  <Icon className="size-5 shrink-0 text-[#0063d1]" />
                  <h3 className="lp-body font-semibold">{c.title}</h3>
                </div>
                <p className="lp-sm mt-1.5 text-[#5c5c58] tabular-nums">{c.meta}</p>
                <p className="lp-body mt-3 text-[#5c5c58]">{c.desc}</p>
              </div>
              <a
                href={c.href}
                className="lp-sm mt-5 inline-flex items-center gap-1 font-medium text-[#0063d1] underline-offset-4 transition-colors duration-150 hover:underline"
              >
                <span>{c.cta}</span>
                <ArrowUpRight className="size-4" />
              </a>
            </div>
          );
        })}
      </div>

      {/* 系统安装提示细线底栏 */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.09] pt-6">
        <p className="lp-sm text-[#5c5c58]">
          <strong className="font-semibold text-[#151514]">安装提示：</strong>
          Windows 首次运行若弹出 SmartScreen 保护提示，点击「更多信息」后再点击「仍要运行」即可。
        </p>
        <p className="lp-sm font-medium text-[#0063d1] tabular-nums">
          Windows {winVer} · macOS {macVer}
        </p>
      </div>
    </section>
  );
}
