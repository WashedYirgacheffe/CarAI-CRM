"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Download } from "lucide-react";
import { Brand, BrandMark } from "@/components/brand";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "产品预览", href: "#preview" },
  { label: "核心能力", href: "#features" },
  { label: "全站模块", href: "#modules" },
  { label: "团队架构", href: "#teams" },
  { label: "下载中心", href: "#download" },
  { label: "常见问题", href: "#faq" },
];

export function LandingHeader({ crmUrl }: { crmUrl: string }) {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 28);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50 px-4 pt-3.5 transition-all duration-300">
      <div
        className={cn(
          "mx-auto flex h-14 max-w-[1220px] items-center justify-between rounded-full px-3.5 transition-all duration-[420ms] [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] sm:px-5",
          stuck
            ? "bg-white/82 shadow-[0_8px_32px_-12px_rgba(21,21,20,0.16),0_0_0_1px_rgba(21,21,20,0.08)] backdrop-blur-2xl backdrop-saturate-150"
            : "bg-transparent",
        )}
      >
        {/* 左侧品牌 */}
        <a href="#" className="flex items-center gap-2.5">
          <BrandMark className="size-7 rounded-[24%]" />
          <Brand className="h-[18px]" />
        </a>

        {/* 中央悬浮胶囊导航条（1:1 openbot.run 风格） */}
        <nav
          aria-label="主导航"
          className={cn(
            "hidden items-center gap-0.5 rounded-full px-1.5 py-1 transition-all duration-300 lg:flex",
            stuck ? "bg-transparent" : "bg-white/75 shadow-[0_2px_10px_-4px_rgba(21,21,20,0.1),0_0_0_1px_rgba(21,21,20,0.07)] backdrop-blur-xl",
          )}
        >
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full px-3.5 py-1.5 text-[13px] font-medium text-[#5c5c58] transition-colors hover:bg-black/[0.045] hover:text-[#151514]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* 右侧双胶囊 CTA */}
        <div className="flex items-center gap-2">
          <a
            href="#download"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#151514] px-4 text-[13px] font-medium text-white shadow-xs transition-all hover:bg-[#2a2a28]"
          >
            <Download className="size-3.5" />
            <span>下载</span>
          </a>
          <a
            href={`${crmUrl}/login`}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-[#e3eefd] px-4 text-[13px] font-medium text-[#0063d1] transition-all hover:bg-[#d2e5fc]"
          >
            <span>进入应用</span>
            <ArrowRight className="size-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
}
