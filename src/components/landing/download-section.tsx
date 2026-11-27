"use client";

import { useEffect, useState } from "react";
import { Check, Download, Laptop, Monitor } from "lucide-react";
import type { DesktopReleases } from "@/server/desktop-releases";
import { cn } from "@/lib/utils";

type DetectedOs = "win" | "mac" | "other";

export function DownloadSection({ releases }: { releases: DesktopReleases }) {
  const [os, setOs] = useState<DetectedOs>("win");

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Macintosh|Mac OS X/i.test(ua)) setOs("mac");
    else if (/Windows/i.test(ua)) setOs("win");
    else setOs("other");
  }, []);

  const cards = [
    {
      key: "win",
      recommended: os === "win" || os === "other",
      title: "Windows 桌面版",
      subtitle: "Windows 10 / 11 (x64 安装程序)",
      href: "/api/desktop/download?arch=win",
      info: releases.win,
      icon: Monitor,
      badge: "外贸团队主力推荐",
      features: ["个人微信 4.0 / 3.9 零封号一键上屏", "本地白名单只读同步 + 发送回执", "内置社媒指纹浏览器与自动更新"],
    },
    {
      key: "mac-arm64",
      recommended: os === "mac",
      title: "macOS (Apple 芯片)",
      subtitle: "M1 / M2 / M3 / M4 原生版 (.dmg)",
      href: "/api/desktop/download?arch=arm64",
      info: releases.macArm64,
      icon: Laptop,
      badge: "Apple Silicon",
      features: ["原生 ARM64 极速启动", "支持微信快捷上屏与 chatlog 只读同步", "多账号社媒本地运行器"],
    },
    {
      key: "mac-x64",
      recommended: false,
      title: "macOS (Intel 芯片)",
      subtitle: "Intel x64 兼容版 (.dmg)",
      href: "/api/desktop/download?arch=x64",
      info: releases.macX64,
      icon: Laptop,
      badge: "Intel Mac",
      features: ["兼容老款 Intel 芯片 Mac", "完整支持桌面端配对与本地运行器", "与云端 CRM 实时同步"],
    },
  ];

  return (
    <section id="download" className="relative mx-auto max-w-6xl scroll-mt-24 px-5 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-doto text-xs tracking-[0.22em] text-sky-400 uppercase">DESKTOP APP · AUTO UPDATE</p>
        <h2 className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          下载车车 CRM 桌面版
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/60 sm:text-base">
          登录后自动配对本机，解锁「个人微信零封号桥接」与「社媒矩阵本地指纹运行器」。后续新版本自动静默推送更新。
        </p>
      </div>

      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          const ver = c.info.version ? `v${c.info.version}` : "最新版";
          const meta = [c.info.sizeMb ? `${c.info.sizeMb} MB` : null, c.info.releaseDate].filter(Boolean).join(" · ");

          return (
            <div
              key={c.key}
              className={cn(
                "relative flex flex-col justify-between rounded-2xl border p-6 transition-all",
                c.recommended
                  ? "border-sky-400/45 bg-gradient-to-b from-sky-500/12 via-white/[0.04] to-white/[0.02] shadow-[0_0_50px_-15px_rgba(56,189,248,0.35)]"
                  : "border-white/10 bg-white/[0.025] hover:border-white/20",
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "flex size-10 items-center justify-center rounded-xl border",
                      c.recommended ? "border-sky-400/35 bg-sky-500/15 text-sky-300" : "border-white/10 bg-white/[0.04] text-white/75",
                    )}
                  >
                    <Icon className="size-5" />
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                      c.recommended ? "bg-sky-400/20 text-sky-200" : "bg-white/[0.06] text-white/60",
                    )}
                  >
                    {c.recommended ? "当前系统推荐" : c.badge}
                  </span>
                </div>

                <h3 className="mt-5 text-lg font-semibold text-white">{c.title}</h3>
                <p className="mt-1 text-xs text-white/50">{c.subtitle}</p>

                <div className="mt-4 flex items-center gap-2 font-mono text-xs text-white/70">
                  <span className="rounded bg-white/10 px-2 py-0.5 text-white">{ver}</span>
                  {meta && <span className="text-white/45">{meta}</span>}
                </div>

                <ul className="mt-5 space-y-2.5 text-xs text-white/70">
                  {c.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <a
                href={c.href}
                className={cn(
                  "mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all",
                  c.recommended
                    ? "bg-white text-slate-950 hover:bg-sky-50"
                    : "border border-white/15 bg-white/[0.05] text-white hover:bg-white/12",
                )}
              >
                <Download className="size-4" />
                {c.info.available ? `立即下载 ${ver}` : "获取安装包"}
              </a>
            </div>
          );
        })}
      </div>

      {/* 3 步极速上手 */}
      <div className="mt-10 grid gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-5 sm:grid-cols-3">
        {[
          { step: "01", title: "下载并安装桌面版", desc: "Windows 首次运行若弹出 SmartScreen，点「更多信息 → 仍要运行」即可。" },
          { step: "02", title: "登录账号自动配对", desc: "登录车车 CRM 账号后自动安全配对本机，钥匙串加密保存设备令牌。" },
          { step: "03", title: "开启微信与社媒工作台", desc: "进入「微信」Tab 即刻使用一键上屏与白名单同步，零封号更省心。" },
        ].map((s) => (
          <div key={s.step} className="flex gap-3">
            <span className="font-doto text-lg font-bold text-sky-400/90">{s.step}</span>
            <div>
              <p className="text-xs font-medium text-white">{s.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/50">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
