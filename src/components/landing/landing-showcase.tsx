"use client";

import { useState } from "react";
import { Bot, CheckCircle2, FileText, Globe, Mail, MessageCircle, MessagesSquare, Send, ShieldCheck, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "wechat", label: "个人微信零封号", icon: MessagesSquare, accent: "text-emerald-400", dot: "bg-emerald-400" },
  { key: "whatsapp", label: "WhatsApp 实时翻译", icon: MessageCircle, accent: "text-green-400", dot: "bg-green-400" },
  { key: "doc", label: "AI 外贸单据", icon: FileText, accent: "text-sky-400", dot: "bg-sky-400" },
  { key: "matrix", label: "海外社媒矩阵", icon: Globe, accent: "text-violet-400", dot: "bg-violet-400" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function LandingShowcase() {
  const [tab, setTab] = useState<TabKey>("wechat");

  return (
    <div className="relative mx-auto mt-14 max-w-5xl">
      {/* 外圈流光光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-1 rounded-[28px] bg-gradient-to-b from-blue-400/30 via-indigo-500/15 to-transparent blur-xl"
      />

      <div className="relative overflow-hidden rounded-[22px] border border-white/12 bg-[#0a0f1d]/90 shadow-[0_32px_90px_-20px_rgba(0,0,0,0.85)] backdrop-blur-xl">
        {/* 顶部窗口栏 + 场景切换 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="ml-2 inline-flex items-center gap-1.5 rounded-md bg-white/[0.05] px-2 py-0.5 font-mono text-[11px] text-white/55">
              crm.caraicrm.com/{tab}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-white/[0.04] p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                    active ? "bg-white/12 text-white shadow-xs" : "text-white/50 hover:text-white/80",
                  )}
                >
                  <Icon className={cn("size-3.5", active ? t.accent : "text-white/40")} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 主体预览区：左侧模拟车车 CRM 图标栏 + 右侧真实场景画面 */}
        <div className="grid min-h-[410px] grid-cols-1 md:grid-cols-[58px_1fr]">
          {/* 左侧迷你模块图标栏 */}
          <div className="hidden flex-col items-center gap-3 border-r border-white/8 bg-white/[0.015] py-4 md:flex">
            <BrandMark className="size-8 rounded-lg" />
            <div className="my-1 h-px w-6 bg-white/10" />
            <span className={cn("flex size-9 items-center justify-center rounded-xl", tab === "wechat" ? "bg-emerald-500/20 text-emerald-400" : "text-white/35")}>
              <MessagesSquare className="size-4" />
            </span>
            <span className={cn("flex size-9 items-center justify-center rounded-xl", tab === "whatsapp" ? "bg-green-500/20 text-green-400" : "text-white/35")}>
              <MessageCircle className="size-4" />
            </span>
            <span className={cn("flex size-9 items-center justify-center rounded-xl", tab === "doc" ? "bg-sky-500/20 text-sky-400" : "text-white/35")}>
              <FileText className="size-4" />
            </span>
            <span className={cn("flex size-9 items-center justify-center rounded-xl", tab === "matrix" ? "bg-violet-500/20 text-violet-400" : "text-white/35")}>
              <Globe className="size-4" />
            </span>
            <span className="flex size-9 items-center justify-center rounded-xl text-white/35">
              <Mail className="size-4" />
            </span>
          </div>

          {/* 场景内容 */}
          <div className="p-5 md:p-6">
            {tab === "wechat" && (
              <div className="grid gap-5 md:grid-cols-[220px_1fr]">
                <div className="space-y-2 border-b border-white/8 pb-4 md:border-r md:border-b-0 md:pr-4 md:pb-0">
                  <div className="flex items-center justify-between text-xs text-white/50">
                    <span>白名单客户会话</span>
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">Win v0.2.6</span>
                  </div>
                  {[
                    { name: "客户-迪拜Alex", wx: "alex_auto_dxb", msg: "BYD Song Plus FOB报价？", active: true, unread: 2 },
                    { name: "客户-阿拉木图车行", wx: "kz_motors88", msg: "PI已收到，明天安排定金", active: false, unread: 0 },
                    { name: "客户-约旦采购群", wx: "14人客户群", msg: "这批 6 台车船期确认了吗", active: false, unread: 1 },
                  ].map((c) => (
                    <div
                      key={c.name}
                      className={cn(
                        "rounded-xl border p-2.5 text-left transition-colors",
                        c.active ? "border-emerald-500/35 bg-emerald-500/10" : "border-white/6 bg-white/[0.02]",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-white">{c.name}</span>
                        {c.unread > 0 && (
                          <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-medium text-slate-950">
                            {c.unread}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-[10px] text-white/40">{c.wx}</p>
                      <p className="mt-1 truncate text-[11px] text-white/65">{c.msg}</p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col justify-between gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-white/8 pb-2.5">
                      <div>
                        <p className="text-sm font-medium text-white">客户-迪拜Alex</p>
                        <p className="text-[11px] text-white/45">精准定位词：alex_auto_dxb · 已关联客户档案</p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] text-emerald-300">
                        <ShieldCheck className="size-3.5" />
                        零 Hook · 零封号
                      </span>
                    </div>

                    <div className="max-w-[85%] rounded-2xl border border-white/8 bg-white/[0.05] px-3.5 py-2.5 text-xs text-white/90">
                      Hi, can you quote FOB Shanghai for 5 units BYD Song Plus EV 2026? Need delivery in 25 days.
                      <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] text-sky-300/85">
                        译文：你好，能报 5 台 2026 款比亚迪宋 Plus EV 的上海港 FOB 价吗？需要 25 天内发运。
                      </p>
                    </div>

                    <div className="ml-auto max-w-[85%] rounded-2xl border border-amber-400/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-white">
                      Hi Alex, sure! For 5 units BYD Song Plus EV 2026, FOB Shanghai is $21,800/unit, lead time 18 days. Sending you the formal PI now.
                      <div className="mt-2 flex items-center justify-between gap-3 border-t border-amber-400/20 pt-1.5 text-[10px] text-amber-200">
                        <span>● 已上屏到微信输入框，核对头像后按 Enter 发送</span>
                        <span className="inline-flex items-center gap-1 text-emerald-300">
                          <CheckCircle2 className="size-3" />
                          发出后自动回执
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-white/55">
                      <Bot className="size-3.5 text-sky-400" />
                      AI 已结合产品库与历史报价生成英文回复
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-slate-950">
                      <Send className="size-3.5" />
                      一键上屏到微信
                    </span>
                  </div>
                </div>
              </div>
            )}

            {tab === "whatsapp" && (
              <div className="grid gap-5 md:grid-cols-[1fr_240px]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-white/8 pb-2.5">
                    <div>
                      <p className="text-sm font-medium text-white">+971 50 842 **** · Al Noor Auto Trading</p>
                      <p className="text-[11px] text-white/45">WhatsApp 实时双端同步 · 自动识别阿拉伯语 / 英语 / 俄语</p>
                    </div>
                    <span className="rounded-full bg-green-500/15 px-2.5 py-1 text-[11px] text-green-300">已连接</span>
                  </div>
                  <div className="max-w-[85%] rounded-2xl border border-white/8 bg-white/[0.05] px-3.5 py-2.5 text-xs text-white/90">
                    مرحبا، هل الشحنة جاهزة للفحص قبل الشحن؟
                    <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] text-emerald-300/90">
                      中文译文：您好，这批货物准备好做装运前检验了吗？
                    </p>
                  </div>
                  <div className="ml-auto max-w-[85%] rounded-2xl bg-green-600/80 px-3.5 py-2.5 text-xs text-white">
                    Yes, all 12 vehicles passed pre-shipment inspection. I have attached the inspection report and photos.
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60">
                    <Sparkles className="size-3.5 text-amber-300" />
                    AI 记忆已自动更新：客户关注装运前检验报告 · 下次跟进提醒已排入日程
                  </div>
                </div>

                <div className="space-y-2.5 rounded-xl border border-white/8 bg-white/[0.025] p-3.5">
                  <p className="text-xs font-medium text-white">客户 360° 速览</p>
                  <div className="space-y-2 text-[11px] text-white/65">
                    <div className="flex justify-between">
                      <span>国家/地区</span>
                      <span className="text-white">阿联酋 · 迪拜</span>
                    </div>
                    <div className="flex justify-between">
                      <span>意向星级</span>
                      <span className="text-amber-300">★★★★★</span>
                    </div>
                    <div className="flex justify-between">
                      <span>在跟商机</span>
                      <span className="font-mono text-emerald-300">$261,600</span>
                    </div>
                    <div className="flex justify-between">
                      <span>已发单据</span>
                      <span className="text-white">PI-2026-019</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === "doc" && (
              <div className="grid gap-5 md:grid-cols-[1fr_260px]">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between border-b border-white/8 pb-3">
                    <div>
                      <p className="font-mono text-xs text-sky-300">PROFORMA INVOICE · PI-20261127-08</p>
                      <p className="mt-0.5 text-xs text-white/50">按公司标准模板自动排版 · 支持导出 PDF / Word / Excel</p>
                    </div>
                    <span className="rounded-md bg-sky-500/15 px-2 py-1 text-[11px] text-sky-300">10 种外贸单据</span>
                  </div>
                  <div className="mt-3 space-y-2 font-mono text-[11px] text-white/75">
                    <div className="grid grid-cols-[1fr_50px_80px] border-b border-white/6 pb-1.5 text-white/40">
                      <span>DESCRIPTION</span>
                      <span className="text-right">QTY</span>
                      <span className="text-right">AMOUNT</span>
                    </div>
                    <div className="grid grid-cols-[1fr_50px_80px]">
                      <span>BYD Song Plus EV Flagship 2026</span>
                      <span className="text-right">5</span>
                      <span className="text-right text-white">$109,000</span>
                    </div>
                    <div className="grid grid-cols-[1fr_50px_80px]">
                      <span>Changan UNI-Z PHEV 2026</span>
                      <span className="text-right">3</span>
                      <span className="text-right text-white">$53,400</span>
                    </div>
                    <div className="flex justify-between border-t border-white/10 pt-2 text-xs font-medium text-sky-300">
                      <span>TOTAL (FOB SHANGHAI)</span>
                      <span>USD 162,400.00</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-between rounded-xl border border-white/8 bg-white/[0.025] p-3.5">
                  <div className="space-y-2.5">
                    <p className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-300">
                      <Bot className="size-3.5" />
                      车车 AI 单据助手
                    </p>
                    <p className="rounded-lg bg-white/[0.04] p-2.5 text-[11px] leading-relaxed text-white/75">
                      「已自动核对信用证条款与 HS 编码，英文金额大写已生成，是否直接发送给迪拜 Alex？」
                    </p>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <span className="flex-1 rounded-lg bg-sky-500/20 py-1.5 text-center text-[11px] font-medium text-sky-200">
                      一键发邮件
                    </span>
                    <span className="flex-1 rounded-lg bg-emerald-500/20 py-1.5 text-center text-[11px] font-medium text-emerald-200">
                      上屏发微信
                    </span>
                  </div>
                </div>
              </div>
            )}

            {tab === "matrix" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 pb-3">
                  <div>
                    <p className="text-sm font-medium text-white">社媒矩阵本机运行器（Camoufox 独立指纹）</p>
                    <p className="text-[11px] text-white/45">TikTok · Instagram · Facebook · LinkedIn · X 统一收私信与自动归档</p>
                  </div>
                  <span className="rounded-full bg-violet-500/15 px-2.5 py-1 font-mono text-[11px] text-violet-300">
                    5 ACCOUNTS LIVE
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { platform: "TikTok", handle: "@carai_export_me", proxy: "Dubai ISP", state: "常驻监听中 · 3 条新私信" },
                    { platform: "Instagram", handle: "@carai.motors", proxy: "Almaty ISP", state: "常驻监听中 · 已同步" },
                    { platform: "LinkedIn", handle: "CarAI Fleet Sales", proxy: "HK Direct", state: "独立环境就绪 · 零关联" },
                  ].map((item) => (
                    <div key={item.handle} className="rounded-xl border border-white/8 bg-white/[0.03] p-3.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-white">{item.platform}</span>
                        <span className="size-2 rounded-full bg-emerald-400" />
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-violet-300">{item.handle}</p>
                      <p className="mt-2 text-[11px] text-white/45">代理：{item.proxy}</p>
                      <p className="mt-1 text-[11px] text-emerald-300/90">{item.state}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
