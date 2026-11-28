"use client";

import { useState } from "react";
import {
  Bell,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  KanbanSquare,
  LayoutDashboard,
  ListTodo,
  Mail,
  MessageCircle,
  MessagesSquare,
  Package,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Stamp,
} from "lucide-react";
import { Brand, BrandMark } from "@/components/brand";
import { AgentAvatar } from "@/components/agentes/agent-avatar";
import { RailHorizon } from "@/components/agentes/sky";
import { moduleColor, tileVars } from "@/lib/module-color";
import { cn } from "@/lib/utils";

type ScreenKey = "dashboard" | "wechat" | "whatsapp" | "doc" | "matrix" | "customers";

const RAIL_MODULES: { key: ScreenKey; title: string; icon: typeof LayoutDashboard; badge?: number; path: string }[] = [
  { key: "dashboard", title: "工作台", icon: LayoutDashboard, path: "/dashboard" },
  { key: "wechat", title: "微信", icon: MessagesSquare, badge: 3, path: "/wechat" },
  { key: "whatsapp", title: "沟通", icon: MessageCircle, badge: 5, path: "/whatsapp" },
  { key: "doc", title: "单据", icon: FileText, path: "/doc" },
  { key: "matrix", title: "社媒", icon: Globe, badge: 2, path: "/social/matrix" },
  { key: "customers", title: "交易", icon: Building2, path: "/orders" },
];

/**
 * 1:1 真实还原车车外贸 CRM（AppShell：暖白纸面 #fbfbfa + 顶栏 + 左侧 #f6f9fd 图标栏含 RailHorizon 像素天空 + 纯白 surface 卡片 + 右下角活的 AgentAvatar）
 */
export function AppWindowPreview() {
  const [screen, setScreen] = useState<ScreenKey>("dashboard");
  const [aiTipOpen, setAiTipOpen] = useState(false);

  const activeItem = RAIL_MODULES.find((m) => m.key === screen) ?? RAIL_MODULES[0];

  return (
    <div id="preview" className="relative mx-auto mt-14 max-w-[1140px] scroll-mt-24">
      {/* 窗口外框阴影（模拟真实桌面端窗口） */}
      <div className="relative overflow-hidden rounded-[22px] bg-[#fbfbfa] text-[#151514] shadow-[0_32px_80px_-22px_rgba(21,21,20,0.28),0_0_0_1px_rgba(21,21,20,0.1)]">
        {/* 桌面端系统窗口栏 + 场景快速切换 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] bg-[#f3f3f0]/80 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-2 text-xs font-medium text-[#5c5c58] tabular-nums">
              车车 CRM 桌面版 · {activeItem.path}
            </span>
          </div>
          <div
            role="tablist"
            aria-label="切换预览模块"
            className="inline-flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-xl bg-black/[0.05] p-1"
          >
            {RAIL_MODULES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={screen === m.key}
                onClick={() => setScreen(m.key)}
                className={cn(
                  "shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150 sm:px-3",
                  screen === m.key
                    ? "bg-white text-[#151514] shadow-2xs"
                    : "text-[#5c5c58] hover:text-[#151514]",
                )}
              >
                {m.title}
              </button>
            ))}
          </div>
        </div>

        {/* 1:1 真实 AppShell 顶栏 */}
        <div className="flex h-13 items-center justify-between gap-3 border-b border-black/[0.06] bg-[#fbfbfa]/95 px-4">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-7 rounded-[24%]" />
            <div className="text-left leading-none">
              <Brand className="h-[15px]" />
              <p className="mt-0.5 text-[10px] text-[#6f6f6a]">华东汽车出口贸易有限公司</p>
            </div>
          </div>

          <div className="hidden h-8 w-72 items-center justify-between rounded-full bg-white px-3 text-xs text-[#6f6f6a] shadow-2xs ring-1 ring-black/[0.07] sm:flex">
            <span className="inline-flex items-center gap-1.5">
              <Search className="size-3.5" />
              搜索客户、订单、报价单、聊天…
            </span>
            <kbd className="rounded bg-[#f3f3f0] px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
          </div>

          <div className="flex items-center gap-2">
            <span className="relative flex size-8 items-center justify-center rounded-full bg-white text-[#5c5c58] ring-1 ring-black/[0.07]">
              <Bell className="size-4" />
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#b42a20] px-1 text-[9px] font-medium text-white">
                8
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white py-1 pr-2.5 pl-1 text-xs font-medium ring-1 ring-black/[0.07]">
              <span className="flex size-6 items-center justify-center rounded-full bg-[#0063d1] text-[10px] text-white">陈</span>
              <span className="hidden sm:inline">陈经理</span>
            </span>
          </div>
        </div>

        {/* 1:1 真实 AppShell 主体：左侧 74px #f6f9fd 侧边栏（含真实 RailHorizon 像素天色）+ 右侧纸面主区 */}
        <div className="relative grid min-h-[540px] grid-cols-1 text-left md:grid-cols-[74px_1fr]">
          {/* 左侧模块图标栏 */}
          <aside className="relative hidden flex-col items-center gap-1.5 overflow-hidden border-r border-black/[0.06] bg-[#f6f9fd] px-1.5 py-3 md:flex">
            <RailHorizon level={0.42} />
            {RAIL_MODULES.map((m) => {
              const Icon = m.icon;
              const on = screen === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setScreen(m.key)}
                  className={cn(
                    "relative z-10 flex w-full flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors duration-150",
                    on
                      ? "bg-white text-[#151514] shadow-[0_2px_8px_-2px_rgba(21,21,20,0.12),0_0_0_1px_rgba(21,21,20,0.06)]"
                      : "text-[#5c5c58] hover:bg-black/[0.04] hover:text-[#151514]",
                  )}
                >
                  <span
                    className={cn("relative flex size-7 items-center justify-center rounded-lg", on && "ac-tile text-white")}
                    style={on ? tileVars(moduleColor(m.key === "doc" ? "trade" : m.key === "matrix" ? "social" : m.key)) : undefined}
                  >
                    <Icon className="size-4" />
                    {m.badge && (
                      <span className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#b42a20] px-1 text-[8px] font-semibold text-white ring-2 ring-[#f6f9fd]">
                        {m.badge}
                      </span>
                    )}
                  </span>
                  <span>{m.title}</span>
                </button>
              );
            })}
            <div className="relative z-10 mt-auto flex flex-col items-center gap-2 pb-1 text-[#6f6f6a]">
              <ListTodo className="size-4" />
              <Mail className="size-4" />
              <Stamp className="size-4" />
            </div>
          </aside>

          {/* 右侧主内容区（真实 #fbfbfa 暖白纸面 + 纯白 surface 卡片） */}
          <div className="relative bg-[#fbfbfa] p-4 sm:p-5">
            {screen === "dashboard" && <DashboardMock />}
            {screen === "wechat" && <WechatMock />}
            {screen === "whatsapp" && <WhatsappMock />}
            {screen === "doc" && <TradeDocMock />}
            {screen === "matrix" && <MatrixMock />}
            {screen === "customers" && <OrdersMock />}

            {/* 右下角 1:1 真实 AI 助手悬浮球（可点击交互） */}
            <div className="absolute right-4 bottom-4 z-20 flex flex-col items-end gap-2">
              {aiTipOpen && (
                <div className="w-64 rounded-2xl bg-white p-3 text-xs shadow-[0_16px_40px_-10px_rgba(21,21,20,0.22),0_0_0_1px_rgba(21,21,20,0.08)]">
                  <p className="font-medium text-[#151514]">车车 AI 副驾驶在线</p>
                  <p className="mt-1 leading-relaxed text-[#5c5c58]">
                    可随时让我「汇总迪拜 Alex 微信+邮件沟通记录」、「按公司样本出一份 5 台比亚迪宋 Plus PI」或「筛出 7 天未跟进的 4 星客户」。
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() => setAiTipOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full bg-white py-1.5 pr-3.5 pl-2 shadow-[0_10px_28px_-8px_rgba(0,99,209,0.28),0_0_0_1px_rgba(0,99,209,0.16)] transition-transform hover:scale-105"
              >
                <AgentAvatar name="车车AI" size="sm" state="idle" appearance={{ color: "sky", eyes: "dots" }} framed={false} />
                <span className="text-xs font-medium text-[#0063d1]">问车车 AI</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 场景 1：工作台 ── */
function DashboardMock() {
  const bars = [
    { m: "6月", h: 42, val: "¥128万" },
    { m: "7月", h: 58, val: "¥176万" },
    { m: "8月", h: 50, val: "¥152万" },
    { m: "9月", h: 74, val: "¥224万" },
    { m: "10月", h: 68, val: "¥206万" },
    { m: "11月", h: 92, val: "¥289万", peak: true },
  ];

  return (
    <div className="space-y-4">
      {/* AI 首屏工作舞台 */}
      <div className="surface relative overflow-hidden p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AgentAvatar name="车车AI" size="md" state="thinking" appearance={{ color: "sky", eyes: "dots" }} />
            <div>
              <p className="font-brand text-base font-medium text-[#151514]">早上好，陈经理 · 3 条高意向询盘待回复</p>
              <p className="text-xs text-[#6f6f6a]">已自动汇总昨晚 WhatsApp、微信和邮箱来信，并提取 2 份新报价需求</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full bg-[#e3eefd] px-3 py-1 font-medium text-[#0063d1]">生成今天跟进清单</span>
            <span className="rounded-full bg-[#f3f3f0] px-3 py-1 text-[#2a2a28]">检查逾期应收款</span>
          </div>
        </div>
      </div>

      {/* 4 指标卡 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "本月签约额", value: "$418,600", delta: "+28.4%", color: "text-[#0063d1]" },
          { label: "跟进中商机", value: "34 笔", delta: "$1.26M", color: "text-[#7c4dff]" },
          { label: "待回微信 / WA", value: "8 条", delta: "已译中文", color: "text-[#12804a]" },
          { label: "待审批单据", value: "2 项", delta: "折扣审批", color: "text-[#b25e00]" },
        ].map((k) => (
          <div key={k.label} className="surface p-3.5">
            <p className="text-[11px] text-[#6f6f6a]">{k.label}</p>
            <p className="mt-1 font-brand text-2xl font-bold tracking-tight text-[#151514] tabular-nums">{k.value}</p>
            <p className={cn("mt-0.5 text-[11px] font-medium", k.color)}>{k.delta}</p>
          </div>
        ))}
      </div>

      {/* 下排：抖动柱状趋势图 + 世界时钟 & 汇率换算 */}
      <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        <div className="surface p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-[#151514]">近 6 个月外贸订单趋势</p>
            <span className="font-mono text-[11px] text-[#0063d1]">合计 ¥1,175 万</span>
          </div>
          <div className="mt-4 flex h-36 items-end justify-between gap-2.5 px-1">
            {bars.map((b) => (
              <div key={b.m} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="font-mono text-[10px] text-[#6f6f6a]">{b.val}</span>
                <div
                  className={cn("w-full rounded-t-lg transition-colors duration-150", b.peak ? "bg-[#0063d1]" : "bar-stripes")}
                  style={{ height: `${b.h}%` }}
                />
                <span className="text-[10px] text-[#6f6f6a]">{b.m}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="surface p-3.5">
            <p className="text-xs font-medium text-[#151514]">重点市场世界时钟</p>
            <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
              {[
                { city: "迪拜 UAE", time: "13:15", tag: "工作时段" },
                { city: "阿拉木图 KZ", time: "14:15", tag: "工作时段" },
                { city: "莫斯科 RU", time: "12:15", tag: "工作时段" },
                { city: "圣保罗 BR", time: "06:15", tag: "刚起床" },
              ].map((c) => (
                <div key={c.city} className="rounded-lg bg-[#f3f3f0]/75 px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#6f6f6a]">{c.city}</span>
                    <span className="font-mono text-xs font-semibold text-[#151514]">{c.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="surface p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#151514]">实时汇率换算</span>
              <span className="font-mono text-[11px] text-[#12804a]">1 USD = 7.24 CNY</span>
            </div>
            <div className="mt-2 flex items-center justify-between rounded-lg bg-[#f3f3f0]/75 px-3 py-1.5 font-mono text-xs">
              <span>$21,800 USD</span>
              <span className="text-[#6f6f6a]">≈</span>
              <span className="font-semibold text-[#0063d1]">¥157,832 CNY</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 场景 2：个人微信零封号工作台 ── */
function WechatMock() {
  return (
    <div className="surface grid min-h-[490px] overflow-hidden md:grid-cols-[240px_1fr]">
      <div className="border-r border-black/[0.06] p-3">
        <div className="flex items-center gap-2 pb-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-[#dcf7e6] text-[#12804a]">
            <MessagesSquare className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold">个人微信助手</span>
              <span className="rounded bg-[#dcf7e6] px-1 py-0.5 text-[9px] font-medium text-[#12804a]">零封号</span>
            </div>
            <p className="text-[10px] text-[#6f6f6a]">Win v0.2.6 就绪 · 白名单同步</p>
          </div>
        </div>
        <div className="space-y-1">
          {[
            { name: "客户-迪拜Alex", id: "alex_auto_dxb", text: "5台宋Plus FOB报下价", cust: "Al Noor Auto", unread: 2, active: true },
            { name: "客户-哈萨克采购群", id: "14人客户群", text: "提单草稿已核对无误", cust: "KZ Motors", unread: 1 },
            { name: "客户-约旦Tariq", id: "tariq_ev2026", text: "什么时候能安排装柜？", cust: "Amman EV", unread: 0 },
          ].map((c) => (
            <div key={c.name} className={cn("rounded-xl p-2.5", c.active ? "bg-[#dcf7e6]/60" : "hover:bg-[#f3f3f0]")}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#151514]">{c.name}</span>
                {c.unread > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#12804a] px-1 text-[9px] text-white">
                    {c.unread}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[11px] text-[#5c5c58]">{c.text}</p>
              <div className="mt-1 flex items-center gap-1">
                <span className="rounded bg-[#e3eefd] px-1.5 py-0.5 text-[9px] text-[#0063d1]">{c.cust}</span>
                <span className="font-mono text-[9px] text-[#6f6f6a]">{c.id}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col justify-between bg-[#fbfbfa]/60">
        <div className="flex items-center justify-between border-b border-black/[0.06] bg-white px-4 py-2.5">
          <div>
            <p className="text-sm font-medium text-[#151514]">客户-迪拜Alex</p>
            <p className="text-[11px] text-[#6f6f6a]">精准定位词：alex_auto_dxb（微信号精准）· 已关联 Al Noor Auto</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#dcf7e6] px-2.5 py-1 text-[10px] font-medium text-[#12804a]">
            <ShieldCheck className="size-3" />
            只读同步 · 不碰协议
          </span>
        </div>

        <div className="space-y-3 p-4">
          <div className="max-w-[82%] rounded-2xl bg-white p-3 text-xs shadow-2xs ring-1 ring-black/[0.06]">
            <p>Hi, please send FOB Shanghai price for 5 units BYD Song Plus EV 2026.</p>
            <p className="mt-1.5 border-t border-black/[0.06] pt-1.5 text-[11px] text-[#0063d1]">
              译文：你好，请发一下 5 台 2026 款比亚迪宋 Plus EV 的上海港 FOB 报价。
            </p>
          </div>
          <div className="ml-auto max-w-[84%] rounded-2xl border border-[#b25e00]/30 bg-[#ffefd2]/60 p-3 text-xs">
            <p className="text-[#151514]">
              Hi Alex, FOB Shanghai for 5 units BYD Song Plus EV 2026 is $21,800/unit, delivery in 18 days. Preparing your formal PI now.
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-[#b25e00]/15 pt-1.5 text-[10px]">
              <span className="inline-flex items-center gap-1 text-[#b25e00]">
                <Clock className="size-3" />
                已上屏到微信输入框，核对头像后按 Enter 发送
              </span>
              <span className="inline-flex items-center gap-0.5 font-medium text-[#12804a]">
                <CheckCircle2 className="size-3" />
                发送后自动回执
              </span>
            </div>
          </div>
        </div>

        <div className="border-t border-black/[0.06] bg-white p-3">
          <div className="flex items-center justify-between text-[11px] text-[#6f6f6a]">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded bg-[#12804a]" />
              自动搜索定位 <code className="rounded bg-[#f3f3f0] px-1.5 py-0.5 text-[#151514]">alex_auto_dxb</code>
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-[#0063d1]">
              <Sparkles className="size-3" />
              AI 帮我写回复
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl bg-[#f3f3f0]/75 px-3 py-2 text-xs text-[#6f6f6a]">
            <span>安全机制：绝不自动按最终回车键，防串人防封号…</span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-[#12804a] px-3 py-1.5 text-xs font-medium text-white">
              <Send className="size-3" />
              一键上屏到微信
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 场景 3：WhatsApp 沟通 ── */
function WhatsappMock() {
  return (
    <div className="surface grid min-h-[490px] overflow-hidden md:grid-cols-[1fr_240px]">
      <div className="flex flex-col justify-between p-4">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
          <div>
            <p className="text-sm font-medium text-[#151514]">+971 50 842 **** · Al Noor Auto Trading</p>
            <p className="text-[11px] text-[#12804a]">● WhatsApp 已连接 · 自动译成中文 · 支持直发报价单 PDF</p>
          </div>
          <span className="rounded-full bg-[#e3eefd] px-2.5 py-1 text-[10px] font-medium text-[#0063d1]">已关联 5★ 客户</span>
        </div>
        <div className="my-4 space-y-3">
          <div className="max-w-[85%] rounded-2xl bg-[#f3f3f0] p-3 text-xs">
            <p>مرحبا، هل يمكنك إرسال قائمة أسعار السيارات الكهربائية الجديدة؟</p>
            <p className="mt-1.5 border-t border-black/[0.08] pt-1.5 text-[11px] text-[#0063d1]">
              译文：你好，可以发一下最新新能源车型的报价表吗？
            </p>
          </div>
          <div className="ml-auto max-w-[82%] rounded-2xl bg-[#12804a] p-3 text-xs text-white">
            <p>Sure! Here is our latest 2026 EV export price list (FOB Shanghai / Ningbo). Let me know which models interest you.</p>
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-white/15 px-2.5 py-1.5 text-[11px]">
              <FileText className="size-3.5" />
              <span>2026_EV_Export_Catalog_FOB.pdf · 2.4 MB</span>
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-[#e3eefd]/60 px-3.5 py-2 text-[11px] text-[#0063d1]">
          AI 记忆自动沉淀：客户偏好比亚迪/长安纯电右舵与中东版车型，已自动创建 3 天后二次跟进提醒。
        </div>
      </div>

      <div className="border-l border-black/[0.06] bg-[#f6f9fd]/70 p-4">
        <p className="text-xs font-semibold text-[#151514]">客户档案侧栏</p>
        <div className="mt-3 space-y-2.5 text-xs">
          <div className="rounded-xl bg-white p-2.5 ring-1 ring-black/[0.06]">
            <p className="text-[10px] text-[#6f6f6a]">客户公司</p>
            <p className="mt-0.5 font-medium">Al Noor Auto Trading LLC</p>
            <p className="text-[10px] text-[#6f6f6a]">阿联酋 · 迪拜 · 成交老客</p>
          </div>
          <div className="rounded-xl bg-white p-2.5 ring-1 ring-black/[0.06]">
            <p className="text-[10px] text-[#6f6f6a]">历史商机 / 订单</p>
            <p className="mt-0.5 font-mono font-semibold text-[#0063d1]">$261,600 (2 单)</p>
          </div>
          <div className="rounded-xl bg-white p-2.5 ring-1 ring-black/[0.06]">
            <p className="text-[10px] text-[#6f6f6a]">AI 提炼偏好</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#5c5c58]">习惯 30% 定金 + 见提单副本付尾款；对装运前验车视频非常敏感。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 场景 4：AI 外贸单据工作台 ── */
function TradeDocMock() {
  return (
    <div className="grid gap-3 md:grid-cols-[1.25fr_1fr]">
      <div className="surface p-4">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-2.5">
          <div>
            <p className="font-mono text-xs font-semibold text-[#0063d1]">PROFORMA INVOICE · PI-20261127-08</p>
            <p className="text-[10px] text-[#6f6f6a]">按公司样本自动套版 · 10 种外贸单据（PI / CI / PL / 合同 / 报价单）</p>
          </div>
          <span className="rounded-full bg-[#e3eefd] px-2 py-0.5 text-[10px] font-medium text-[#0063d1]">A4 导出 PDF</span>
        </div>
        <div className="mt-3 space-y-2 font-mono text-[11px]">
          <div className="grid grid-cols-[1fr_44px_84px] border-b border-black/[0.06] pb-1 text-[#6f6f6a]">
            <span>DESCRIPTION</span>
            <span className="text-right">QTY</span>
            <span className="text-right">AMOUNT</span>
          </div>
          <div className="grid grid-cols-[1fr_44px_84px]">
            <span>BYD Song Plus EV 2026</span>
            <span className="text-right">5</span>
            <span className="text-right font-medium">$109,000</span>
          </div>
          <div className="grid grid-cols-[1fr_44px_84px]">
            <span>Changan UNI-Z PHEV</span>
            <span className="text-right">3</span>
            <span className="text-right font-medium">$53,400</span>
          </div>
          <div className="flex items-center justify-between border-t border-black/[0.08] pt-2 text-xs font-semibold text-[#0063d1]">
            <span>TOTAL (FOB SHANGHAI)</span>
            <span>USD 162,400.00</span>
          </div>
          <p className="rounded-lg bg-[#f3f3f0] p-2 text-[10px] text-[#5c5c58]">
            SAY TOTAL US DOLLARS ONE HUNDRED SIXTY-TWO THOUSAND FOUR HUNDRED ONLY.
          </p>
        </div>
      </div>

      <div className="surface flex flex-col justify-between p-4">
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <AgentAvatar name="单据助手" size="sm" state="writing" appearance={{ color: "teal", eyes: "dots" }} />
            <span className="text-xs font-semibold">车车 AI 单据工作台</span>
          </div>
          <div className="rounded-xl bg-[#f3f3f0] p-3 text-xs leading-relaxed text-[#2a2a28]">
            已从客户历史微信与邮件自动带入收货人抬头、HS 编码与银行账号，金额大写与条款已逐项校验无误。
          </div>
          <div className="rounded-xl bg-[#e3eefd]/70 p-2.5 text-[11px] text-[#0063d1]">
            ✓ L/C 装运期校验通过 · ✓ 多币种汇率快照已锁定
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs font-medium">
          <span className="rounded-xl bg-[#151514] py-2 text-white">一键发邮件</span>
          <span className="rounded-xl bg-[#dcf7e6] py-2 text-[#12804a]">上屏发微信</span>
        </div>
      </div>
    </div>
  );
}

/* ── 场景 5：海外社媒矩阵 ── */
function MatrixMock() {
  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center justify-between gap-2 p-4">
        <div>
          <p className="text-sm font-semibold text-[#151514]">海外社媒矩阵 · 车车浏览器独立指纹环境</p>
          <p className="text-xs text-[#6f6f6a]">TikTok / Instagram / Facebook / LinkedIn / X 多账号本机常驻监听私信，防关联、统一汇总进收件箱</p>
        </div>
        <span className="text-xs font-medium text-[#12804a] tabular-nums">5 个账号监听中</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { platform: "TikTok", handle: "@carai_export_dxb", proxy: "Dubai Residential", msg: "常驻监听 · 3 条新询盘", color: "bg-[#151514] text-white" },
          { platform: "Instagram", handle: "@carai.motors", proxy: "Almaty ISP", msg: "常驻监听 · 自动翻译中", color: "bg-[#e5487a] text-white" },
          { platform: "LinkedIn", handle: "CarAI Fleet Export", proxy: "HK Dedicated", msg: "独立环境就绪 · 支持加密迁移", color: "bg-[#0063d1] text-white" },
        ].map((a) => (
          <div key={a.handle} className="surface p-4">
            <div className="flex items-center justify-between">
              <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-semibold", a.color)}>{a.platform}</span>
              <span className="size-2 rounded-full bg-[#12804a]" />
            </div>
            <p className="mt-2.5 font-mono text-xs font-semibold text-[#151514]">{a.handle}</p>
            <p className="mt-1 text-[11px] text-[#6f6f6a]">独立代理：{a.proxy}</p>
            <p className="mt-2 rounded-lg bg-[#f3f3f0] px-2.5 py-1.5 text-[11px] font-medium text-[#12804a]">{a.msg}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 场景 6：订单、物流与回款闭环 ── */
function OrdersMock() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="surface p-4">
        <div className="flex items-center justify-between">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#151514]">
            <KanbanSquare className="size-4 text-[#7c4dff]" />
            商机看板 & 防撞单公海
          </p>
          <span className="text-[11px] text-[#6f6f6a]">自动回收 30 天未跟进</span>
        </div>
        <div className="mt-3 space-y-2 text-xs">
          {[
            { stage: "已报 FOB 价", deal: "迪拜 Al Noor · 5 台宋 Plus", val: "$109,000", tag: "bg-[#e3eefd] text-[#0063d1]" },
            { stage: "信用证审核", deal: "阿拉木图 KZ Motors · 12 台", val: "$248,000", tag: "bg-[#ffefd2] text-[#b25e00]" },
            { stage: "赢单转订单", deal: "约旦 Amman EV · 6 台", val: "$132,600", tag: "bg-[#dcf7e6] text-[#12804a]" },
          ].map((d) => (
            <div key={d.deal} className="flex items-center justify-between rounded-xl bg-[#f3f3f0]/75 p-2.5">
              <div>
                <p className="font-medium text-[#151514]">{d.deal}</p>
                <span className={cn("mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", d.tag)}>{d.stage}</span>
              </div>
              <span className="font-mono font-semibold text-[#151514]">{d.val}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="surface p-4">
        <div className="flex items-center justify-between">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#151514]">
            <Package className="size-4 text-[#00a896]" />
            出运物流单证 & 分期回款计划
          </p>
          <span className="text-[11px] text-[#12804a]">已回款 72%</span>
        </div>
        <div className="mt-3 space-y-2.5 text-xs">
          <div className="rounded-xl bg-[#f3f3f0]/75 p-3">
            <div className="flex justify-between">
              <span className="font-medium">SO-20261108 · 提单 COSU638921</span>
              <span className="font-medium text-[#00a896]">海运在途 · ETA 12/06</span>
            </div>
            <p className="mt-1 text-[11px] text-[#6f6f6a]">报关单 ✓ · 产地证 CO ✓ · 装运前检验证 ✓</p>
          </div>
          <div className="rounded-xl bg-[#f3f3f0]/75 p-3">
            <div className="flex justify-between">
              <span className="font-medium">分期收款 · 30% 定金 + 70% 尾款</span>
              <span className="font-mono font-semibold text-[#0063d1]">$188,000 / $261,600</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/[0.08]">
              <div className="h-full w-[72%] rounded-full bg-[#0063d1]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
