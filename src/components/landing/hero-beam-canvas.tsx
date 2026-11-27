"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Download, Globe, Laptop, Monitor } from "lucide-react";
import type { DesktopReleases } from "@/server/desktop-releases";
import { cn } from "@/lib/utils";

/**
 * 1:1 致敬 openbot.run 右侧高能粒子光束 Canvas（适配 CarAI agentes 暖白纸面 + Agent 蓝/天蓝光柱）
 */
export function HeroBeamCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0;
    let h = 0;

    type Particle = { x: number; y: number; vy: number; vx: number; size: number; alpha: number; color: string };
    const particles: Particle[] = [];
    const colors = ["#0063d1", "#3d8bff", "#7c4dff", "#00a896"];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      particles.length = 0;
      const beamX = w * 0.84;
      for (let i = 0; i < 65; i++) {
        particles.push({
          x: beamX + (Math.random() - 0.5) * 220,
          y: Math.random() * h,
          vy: 0.4 + Math.random() * 1.1,
          vx: (Math.random() - 0.5) * 0.25,
          size: 2 + Math.floor(Math.random() * 3),
          alpha: 0.15 + Math.random() * 0.45,
          color: colors[i % colors.length],
        });
      }
    };

    resize();
    window.addEventListener("resize", resize);

    let t = 0;
    const draw = () => {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);

      const beamX = w * 0.84;
      const pulse = 0.88 + 0.12 * Math.sin(t * 1.4);

      // 宽柔光晕
      const wide = ctx.createRadialGradient(beamX, h * 0.36, 10, beamX, h * 0.48, Math.max(320, w * 0.32));
      wide.addColorStop(0, `rgba(61, 139, 255, ${0.26 * pulse})`);
      wide.addColorStop(0.42, `rgba(124, 77, 255, ${0.12 * pulse})`);
      wide.addColorStop(1, "rgba(251, 251, 250, 0)");
      ctx.fillStyle = wide;
      ctx.fillRect(0, 0, w, h);

      // 右侧垂直核心光柱
      const col = ctx.createLinearGradient(beamX - 70, 0, beamX + 70, 0);
      col.addColorStop(0, "rgba(0, 99, 209, 0)");
      col.addColorStop(0.35, `rgba(61, 139, 255, ${0.22 * pulse})`);
      col.addColorStop(0.5, `rgba(255, 255, 255, ${0.95 * pulse})`);
      col.addColorStop(0.65, `rgba(61, 139, 255, ${0.22 * pulse})`);
      col.addColorStop(1, "rgba(0, 99, 209, 0)");
      ctx.fillStyle = col;
      ctx.fillRect(beamX - 70, 0, 140, h * 0.92);

      // 汇入下方 CRM 窗口顶部的水平流光池
      const pool = ctx.createRadialGradient(w * 0.56, h * 0.88, 20, w * 0.56, h * 0.88, w * 0.45);
      pool.addColorStop(0, `rgba(0, 99, 209, ${0.22 * pulse})`);
      pool.addColorStop(0.5, `rgba(124, 77, 255, ${0.09 * pulse})`);
      pool.addColorStop(1, "rgba(251, 251, 250, 0)");
      ctx.fillStyle = pool;
      ctx.fillRect(0, h * 0.55, w, h * 0.45);

      // 像素风粒子沿光束流动（呼应 agentes 像素语言）
      for (const p of particles) {
        if (!reduced) {
          p.y += p.vy;
          p.x += p.vx;
          if (p.y > h) {
            p.y = -8;
            p.x = beamX + (Math.random() - 0.5) * 190;
          }
        }
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
      ctx.globalAlpha = 1;

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" />;
}

/** 1:1 复刻 openbot.run Hero 分体式主下载胶囊（左侧一键下载当前 OS，右侧 ▾ 下拉全平台） */
export function HeroCtaRow({ releases, crmUrl }: { releases: DesktopReleases; crmUrl: string }) {
  const [os, setOs] = useState<"win" | "mac">("win");
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) setOs("mac");
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const primaryHref = os === "mac" ? "/api/desktop/download?arch=arm64" : "/api/desktop/download?arch=win";
  const primaryLabel =
    os === "mac"
      ? `下载 macOS 版${releases.macArm64.version ? ` v${releases.macArm64.version}` : ""}`
      : `下载 Windows 版${releases.win.version ? ` v${releases.win.version}` : ""}`;

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
      {/* 分体式主胶囊 */}
      <div ref={menuRef} className="relative inline-flex items-stretch rounded-full bg-[#151514] text-white shadow-[0_12px_30px_-10px_rgba(21,21,20,0.45)]">
        <a
          href={primaryHref}
          className="inline-flex h-12 items-center gap-2 rounded-l-full pr-4 pl-6 text-sm font-medium transition-colors hover:bg-[#2a2a28]"
        >
          {os === "mac" ? <Laptop className="size-4" /> : <Monitor className="size-4" />}
          <span>{primaryLabel}</span>
        </a>
        <span className="my-2.5 w-px bg-white/15" aria-hidden />
        <button
          type="button"
          aria-label="选择其他平台下载"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-12 items-center justify-center rounded-r-full pr-4 pl-3 transition-colors hover:bg-[#2a2a28]"
        >
          <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute top-14 left-0 z-30 w-72 overflow-hidden rounded-2xl bg-white p-1.5 text-left text-[#151514] shadow-[0_24px_56px_-14px_rgba(21,21,20,0.28),0_0_0_1px_rgba(21,21,20,0.08)]">
            <p className="px-3 py-1.5 text-[11px] font-medium text-[#6f6f6a]">选择你的系统版本</p>
            {[
              {
                label: "Windows 10 / 11 (x64)",
                sub: `${releases.win.version ? `v${releases.win.version}` : "最新版"} · 含微信 4.0 一键上屏`,
                href: "/api/desktop/download?arch=win",
                icon: Monitor,
              },
              {
                label: "macOS (Apple 芯片 M1–M4)",
                sub: `${releases.macArm64.version ? `v${releases.macArm64.version}` : "最新版"} · ARM64 .dmg`,
                href: "/api/desktop/download?arch=arm64",
                icon: Laptop,
              },
              {
                label: "macOS (Intel 芯片)",
                sub: `${releases.macX64.version ? `v${releases.macX64.version}` : "最新版"} · x64 .dmg`,
                href: "/api/desktop/download?arch=x64",
                icon: Laptop,
              },
              {
                label: "网页版 Web CRM",
                sub: "免安装，任意浏览器直接登录",
                href: `${crmUrl}/login`,
                icon: Globe,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-[#f3f3f0]"
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-[#0063d1]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-[#151514]">{item.label}</p>
                    <p className="text-[11px] text-[#6f6f6a]">{item.sub}</p>
                  </div>
                  <Download className="mt-1 size-3.5 shrink-0 text-[#6f6f6a]" />
                </a>
              );
            })}
          </div>
        )}
      </div>

      {/* 次按钮：玻璃白胶囊 */}
      <a
        href={`${crmUrl}/register`}
        className="inline-flex h-12 items-center gap-2 rounded-full bg-white/85 px-6 text-sm font-medium text-[#151514] shadow-[0_2px_10px_-3px_rgba(21,21,20,0.1),0_0_0_1px_rgba(21,21,20,0.1)] backdrop-blur-md transition-all hover:bg-white"
      >
        <span>免费注册试用</span>
        <ArrowRight className="size-4 text-[#0063d1]" />
      </a>
    </div>
  );
}
