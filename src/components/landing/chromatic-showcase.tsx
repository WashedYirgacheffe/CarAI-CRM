"use client";

import { useRef, useState } from "react";
import { Check, Download } from "lucide-react";

/**
 * 光学折光玻璃透镜互动展示区（以客户收益为核心主标）
 */
export function ChromaticShowcase() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState({ x: 60, y: 48 });

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(10, Math.min(90, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(15, Math.min(85, ((e.clientY - rect.top) / rect.height) * 100));
    setLens({ x, y });
  };

  return (
    <section className="mx-auto max-w-[1160px] px-5 py-20 text-center sm:py-28">
      <div
        ref={stageRef}
        onMouseMove={handleMove}
        className="relative mx-auto flex flex-col items-center justify-center overflow-hidden rounded-[36px] bg-white px-6 py-20 shadow-[0_14px_44px_-18px_rgba(21,21,20,0.12),0_0_0_1px_rgba(21,21,20,0.075)] sm:px-12 sm:py-24"
      >
        {/* 金属流光巨幅主标 + 随光标滑行的光学透镜 */}
        <div className="relative select-none">
          <h2 className="lp-metallic-text font-brand text-[clamp(3.25rem,10vw,7.5rem)] leading-[0.98] font-bold tracking-[-0.055em]">
            守住每个客户号
          </h2>

          <div
            aria-hidden
            style={{
              left: `${lens.x}%`,
              top: `${lens.y}%`,
            }}
            className="pointer-events-none absolute z-10 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-white/15 shadow-[inset_0_2px_12px_rgba(255,255,255,0.9),0_14px_34px_-8px_rgba(0,99,209,0.28),0_0_0_1.5px_rgba(0,99,209,0.25)] backdrop-blur-[2px] backdrop-saturate-150 transition-[left,top] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] sm:size-36"
          >
            <span className="absolute inset-1.5 rounded-full border border-sky-400/35" />
            <span className="absolute inset-3 rounded-full border border-rose-400/25" />
          </div>
        </div>

        <p className="lp-body mt-6 max-w-[54ch] text-[#5c5c58]">
          不破解微信协议、不注入微信内存，用本机白名单只读与半自动上屏守护你的核心外贸客户号，Windows 与 macOS 桌面端免费下载。
        </p>

        <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[#151514]">
          {[
            "全站外贸核心模块开箱即用",
            "Windows 与 macOS 桌面端免费下载",
            "支持自有服务器 Docker 私有化",
          ].map((t) => (
            <li key={t} className="lp-body inline-flex items-center gap-2 font-medium">
              <Check className="size-4 shrink-0 text-[#12804a]" />
              <span>{t}</span>
            </li>
          ))}
        </ul>

        <div className="mt-10">
          <a
            href="#download"
            className="lp-body inline-flex h-12 items-center gap-2 rounded-full bg-[#151514] px-7 font-medium text-white transition-colors duration-150 hover:bg-[#2a2a28]"
          >
            <Download className="size-4" />
            <span>前往下载桌面版</span>
          </a>
        </div>
      </div>
    </section>
  );
}
