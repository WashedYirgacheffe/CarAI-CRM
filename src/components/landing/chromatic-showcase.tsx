"use client";

import { useRef, useState } from "react";
import { ArrowRight, Check, Download } from "lucide-react";

/**
 * 1:1 致敬 openbot.run Section 3：超大金属流光展示字 + 可随光标移动的光学折光玻璃透镜球
 */
export function ChromaticShowcase({ crmUrl }: { crmUrl: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState({ x: 58, y: 48, active: false });

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(10, Math.min(90, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(15, Math.min(85, ((e.clientY - rect.top) / rect.height) * 100));
    setLens({ x, y, active: true });
  };

  return (
    <section className="mx-auto max-w-[1160px] px-5 py-20 text-center sm:py-28">
      <div
        ref={stageRef}
        onMouseMove={handleMove}
        onMouseLeave={() => setLens((prev) => ({ ...prev, active: false }))}
        className="relative mx-auto flex max-w-4xl cursor-default flex-col items-center justify-center overflow-hidden rounded-[36px] bg-white px-6 py-16 shadow-[0_12px_40px_-16px_rgba(21,21,20,0.12),0_0_0_1px_rgba(21,21,20,0.07)] sm:py-20"
      >
        <p className="font-dot text-xs tracking-[0.22em] text-[#0063d1] uppercase">ZERO RISK · FAST ONBOARDING</p>

        {/* 超大金属切面流光主字 */}
        <div className="relative mt-2 select-none">
          <p className="lp-metallic-text font-brand text-[clamp(4.5rem,16vw,12rem)] leading-[0.95] font-bold tracking-[-0.06em]">
            0 封号
          </p>

          {/* 随光标滑行的光学折光玻璃透镜球 */}
          <div
            aria-hidden
            style={{
              left: `${lens.x}%`,
              top: `${lens.y}%`,
            }}
            className="pointer-events-none absolute z-10 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-white/15 shadow-[inset_0_2px_12px_rgba(255,255,255,0.9),0_14px_34px_-8px_rgba(0,99,209,0.28),0_0_0_1.5px_rgba(0,99,209,0.25)] backdrop-blur-[2px] backdrop-saturate-150 transition-[left,top] duration-200 ease-out sm:size-36"
          >
            <span className="absolute inset-1.5 rounded-full border border-sky-400/35" />
            <span className="absolute inset-3 rounded-full border border-rose-400/25" />
          </div>
        </div>

        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#5c5c58] sm:text-base">
          不破解微信协议、不注入微信内存，用最稳健的本地只读与半自动上屏守护你的核心外贸客户号；同时 Windows / macOS 桌面客户端永久免费下载。
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-[#151514]">
          {["全站 15+ 核心外贸模块开箱即用", "Windows / macOS 桌面端免费下载", "支持自有服务器 Docker 私有化"].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <Check className="size-4 text-[#12804a]" />
              {t}
            </span>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#download"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-[#151514] px-6 text-sm font-medium text-white transition-colors hover:bg-[#2a2a28]"
          >
            <Download className="size-4" />
            下载桌面版
          </a>
          <a
            href={`${crmUrl}/register`}
            className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[#e3eefd] px-6 text-sm font-medium text-[#0063d1] transition-colors hover:bg-[#d2e5fc]"
          >
            <span>立即免费注册</span>
            <ArrowRight className="size-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
