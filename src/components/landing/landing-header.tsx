"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
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
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        stuck
          ? "bg-[#fbfbfa]/88 shadow-[0_1px_0_rgba(21,21,20,0.08)] backdrop-blur-xl backdrop-saturate-150"
          : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5">
        {/* 左侧品牌：字标尺寸明显强于导航文字 */}
        <a href="#" className="flex shrink-0 items-center gap-2.5">
          <BrandMark className="size-8 rounded-[24%]" />
          <Brand className="h-[22px]" />
        </a>

        {/* 中央单行无边框导航 */}
        <nav aria-label="主导航" className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="lp-sm rounded-full px-3.5 py-1.5 font-medium text-[#5c5c58] transition-colors duration-150 hover:text-[#151514]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* 右侧单一主动作 + 轻量登录入口 */}
        <div className="flex shrink-0 items-center gap-4">
          <a
            href={`${crmUrl}/login`}
            className="lp-sm hidden font-medium text-[#5c5c58] transition-colors duration-150 hover:text-[#151514] sm:inline"
          >
            登录应用
          </a>
          <a
            href="#download"
            className="lp-sm inline-flex h-10 items-center gap-1.5 rounded-full bg-[#151514] px-5 font-medium text-white transition-colors duration-150 hover:bg-[#2a2a28]"
          >
            <span>下载桌面版</span>
            <ArrowRight className="size-4" />
          </a>
        </div>
      </div>
    </header>
  );
}
