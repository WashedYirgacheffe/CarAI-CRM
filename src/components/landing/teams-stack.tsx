"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Building2, Cloud, Cpu, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const TEAM_CARDS = [
  {
    num: "01",
    tag: "零封号桌面桥接",
    title: "本机安全运行，杜绝封号",
    desc: "个人微信采用本地白名单只读同步 + 半自动一键上屏，海外社媒矩阵运行在独立指纹「车车浏览器」内，不走高危群控协议，保障外贸大客户号资产长期安全。",
    bg: "#e7d8fc",
    icon: ShieldCheck,
  },
  {
    num: "02",
    tag: "多租户与权限体系",
    title: "部门树隔离与脱敏风控",
    desc: "支持企业部门树、自定义角色权限与「仅本人 / 本部门 / 全公司」三级数据范围；可对社媒主页链接和联系方式开启脱敏保护，防止客户资源流失与飞单。",
    bg: "#c7f2da",
    icon: Building2,
  },
  {
    num: "03",
    tag: "AI 深度执行闭环",
    title: "不是聊天框，而是能干活的 AI 同事",
    desc: "车车 AI 直接连接客户档案、产品库、报价单与邮件/聊天上下文：支持自动改字段、建商机、联网背调官网、解读扫描版信用证、按公司样本出 10 种专业外贸单据。",
    bg: "#fbe6b5",
    icon: Cpu,
  },
  {
    num: "04",
    tag: "云端 SaaS + 私有化",
    title: "60 秒开箱，也支持自有服务器部署",
    desc: "既可以直接在 caraicrm.com 注册即用（Windows / macOS 桌面端自动静默更新），也提供完整 Docker Compose 一键私有化部署方案与每日自动备份脚本。",
    bg: "#cde4ff",
    icon: Cloud,
  },
] as const;

/**
 * 1:1 复刻 openbot.run Section 4：左侧 Sticky 进度索引 + 右侧 4 张方格纸底纹粘性堆叠彩色卡片（滚动实时计算 scale 与 brightness）
 */
export function TeamsStackSection({ crmUrl }: { crmUrl: string }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [coverRatios, setCoverRatios] = useState<number[]>([0, 0, 0, 0]);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const onScroll = () => {
      const rects = cardRefs.current.map((el) => el?.getBoundingClientRect());
      let current = 0;
      const ratios = [0, 0, 0, 0];

      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (!r) continue;
        if (r.top <= 240) current = i;
        const next = rects[i + 1];
        if (next) {
          const overlap = Math.max(0, Math.min(1, (r.bottom - next.top) / Math.max(1, r.height * 0.7)));
          ratios[i] = overlap;
        }
      }
      setActiveIdx(current);
      setCoverRatios(ratios);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section id="teams" className="mx-auto max-w-[1160px] scroll-mt-24 px-5 py-24 sm:py-32">
      <div className="grid items-start gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        {/* 左侧 Sticky 引导 + 01-04 实时索引 */}
        <div className="lg:sticky lg:top-28">
          <p className="font-dot text-xs tracking-[0.2em] text-[#0063d1] uppercase">BUILT FOR REAL TRADE TEAMS</p>
          <h2 className="mt-3 font-brand text-3xl font-semibold tracking-[-0.03em] text-[#151514] sm:text-5xl">
            为整个外贸团队配备 AI 同事。
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-[#5c5c58] sm:text-base">
            无论是 3 人精锐外贸工作室，还是多部门协同的汽车与大宗出口企业，车车 CRM 都能在合规、效率与安全之间做到完美平衡。
          </p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <a
              href={`${crmUrl}/register`}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#151514] px-6 text-sm font-medium text-white transition-colors hover:bg-[#2a2a28]"
            >
              免费创建企业空间
            </a>
            <a
              href="#download"
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-white px-5 text-sm font-medium text-[#151514] ring-1 ring-black/[0.1] transition-colors hover:bg-[#f3f3f0]"
            >
              <span>下载桌面版</span>
              <ArrowRight className="size-4" />
            </a>
          </div>

          <ol className="mt-10 hidden space-y-2.5 border-l border-black/[0.1] pl-4 lg:block">
            {TEAM_CARDS.map((c, idx) => (
              <li key={c.num} className="relative">
                {activeIdx === idx && (
                  <span className="absolute top-1 -left-[17px] h-4 w-[2px] rounded-full bg-[#0063d1]" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => cardRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  className={cn(
                    "flex items-center gap-3 text-left text-xs transition-colors",
                    activeIdx === idx ? "font-semibold text-[#151514]" : "text-[#6f6f6a] hover:text-[#151514]",
                  )}
                >
                  <span className="font-mono text-[11px]">{c.num}</span>
                  <span>{c.tag}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        {/* 右侧 4 张粘性堆叠彩色方格纸大卡 */}
        <div className="space-y-6">
          {TEAM_CARDS.map((c, idx) => {
            const Icon = c.icon;
            const covered = coverRatios[idx] ?? 0;
            const scale = 1 - covered * 0.05;
            const brightness = 1 - covered * 0.12;
            return (
              <div
                key={c.num}
                ref={(el) => {
                  cardRefs.current[idx] = el;
                }}
                style={{
                  backgroundColor: c.bg,
                  top: `${96 + idx * 18}px`,
                  transform: `scale(${scale.toFixed(3)})`,
                  filter: `brightness(${brightness.toFixed(3)})`,
                }}
                className="lp-graph-paper sticky flex min-h-[340px] flex-col justify-between overflow-hidden rounded-[28px] p-7 text-[#151514] shadow-[0_14px_40px_-18px_rgba(21,21,20,0.22),0_0_0_1px_rgba(21,21,20,0.1)] transition-[transform,filter] duration-150 sm:min-h-[370px] sm:p-8"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-white/75 px-3 py-1 text-xs font-medium text-[#151514] ring-1 ring-black/[0.08] backdrop-blur-xs">
                    {c.tag}
                  </span>
                  <span className="font-mono text-xs font-medium text-[#151514]/60">{c.num} / 04</span>
                </div>

                <div className="my-6 flex justify-end pr-2">
                  <div className="flex size-20 items-center justify-center rounded-3xl bg-white/55 ring-1 ring-black/[0.08]">
                    <Icon className="size-10 stroke-[1.4] text-[#151514]" />
                  </div>
                </div>

                <div className="max-w-lg">
                  <h3 className="font-brand text-2xl font-semibold tracking-tight sm:text-3xl">{c.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-[#151514]/75">{c.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
