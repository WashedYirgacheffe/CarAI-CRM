"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Building2, Cloud, Cpu, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const TEAM_CARDS = [
  {
    id: "bridge",
    label: "零封号桌面桥接",
    title: "本机安全运行，守住大客户号资产",
    desc: "个人微信采用本地白名单只读同步与半自动一键上屏，海外社媒矩阵运行在独立指纹车车浏览器内，不走高危群控协议，保障外贸核心账号长期稳定。",
    bg: "#e8f1fd",
    dark: false,
    icon: ShieldCheck,
  },
  {
    id: "rbac",
    label: "多租户与权限隔离",
    title: "树形部门隔离与联系方式脱敏",
    desc: "支持企业部门树、自定义角色权限与仅本人、本部门、全公司三级数据范围；可对社媒主页链接和联系方式开启脱敏保护，防止客户资源流失与飞单。",
    bg: "#e2f4ea",
    dark: false,
    icon: Building2,
  },
  {
    id: "agent",
    label: "深度业务执行",
    title: "不是聊天框，而是能干活的 AI 同事",
    desc: "车车 AI 直接连接客户档案、产品库、报价单与邮件聊天上下文：自动更新字段、建商机、联网背调官网、解读扫描版信用证，并按公司样本出 10 种外贸单据。",
    bg: "#f3edfe",
    dark: false,
    icon: Cpu,
  },
  {
    id: "deploy",
    label: "云端与私有化兼得",
    title: "开箱即用，也支持自有服务器部署",
    desc: "既可以在 caraicrm.com 注册即用，享受桌面端自动静默更新；也提供完整的 Docker Compose 私有化部署方案与每日自动备份脚本，数据完全自主可控。",
    bg: "#151514",
    dark: true,
    icon: Cloud,
  },
] as const;

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
        {/* 左侧粘性叙事与进度导航 */}
        <div className="lg:sticky lg:top-28">
          <h2 className="lp-h2 font-brand font-semibold text-[#151514]">
            为整个外贸团队配备可靠的 AI 同事
          </h2>
          <p className="lp-body mt-4 max-w-[44ch] text-[#5c5c58]">
            无论是 3 人精锐外贸工作室，还是多部门协同的汽车与大宗出口企业，都能在合规、效率与安全之间取得平衡。
          </p>

          <div className="mt-8">
            <a
              href={`${crmUrl}/register`}
              className="lp-body inline-flex h-12 items-center gap-2 rounded-full bg-[#151514] px-7 font-medium text-white transition-colors duration-150 hover:bg-[#2a2a28]"
            >
              <span>免费创建企业空间</span>
              <ArrowRight className="size-4" />
            </a>
          </div>

          <ul className="mt-10 hidden space-y-3 border-l border-black/[0.1] pl-4 lg:block">
            {TEAM_CARDS.map((c, idx) => (
              <li key={c.id} className="relative">
                {activeIdx === idx && (
                  <span className="absolute top-1.5 -left-[17px] h-4 w-[2px] rounded-full bg-[#0063d1]" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => cardRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  className={cn(
                    "lp-sm text-left transition-colors duration-150",
                    activeIdx === idx ? "font-semibold text-[#151514]" : "text-[#5c5c58] hover:text-[#151514]",
                  )}
                >
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* 右侧 4 张粘性堆叠建筑卡片 */}
        <div className="space-y-6">
          {TEAM_CARDS.map((c, idx) => {
            const Icon = c.icon;
            const covered = coverRatios[idx] ?? 0;
            const scale = 1 - covered * 0.045;
            const brightness = 1 - covered * 0.1;
            return (
              <div
                key={c.id}
                ref={(el) => {
                  cardRefs.current[idx] = el;
                }}
                style={{
                  backgroundColor: c.bg,
                  top: `${96 + idx * 18}px`,
                  transform: `scale(${scale.toFixed(3)})`,
                  filter: `brightness(${brightness.toFixed(3)})`,
                }}
                className={cn(
                  "sticky flex min-h-[340px] flex-col justify-between overflow-hidden rounded-[28px] p-8 shadow-[0_14px_40px_-18px_rgba(21,21,20,0.22),0_0_0_1px_rgba(21,21,20,0.08)] transition-[transform,filter] duration-150 sm:min-h-[370px] sm:p-10",
                  c.dark ? "lp-graph-paper-dark text-white" : "lp-graph-paper text-[#151514]",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("lp-sm font-medium", c.dark ? "text-white/70" : "text-[#5c5c58]")}>
                    {c.label}
                  </span>
                  <div
                    className={cn(
                      "flex size-12 items-center justify-center rounded-2xl",
                      c.dark ? "bg-white/10 text-white" : "bg-white/75 text-[#151514]",
                    )}
                  >
                    <Icon className="size-6 stroke-[1.5]" />
                  </div>
                </div>

                <div className="mt-14 max-w-lg">
                  <h3
                    className={cn(
                      "lp-h2 font-brand font-semibold",
                      c.dark ? "text-white" : "text-[#151514]",
                    )}
                  >
                    {c.title}
                  </h3>
                  <p className={cn("lp-body mt-4", c.dark ? "text-white/75" : "text-[#2a2a28]")}>
                    {c.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
