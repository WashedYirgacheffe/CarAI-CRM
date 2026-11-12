"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, ThumbsDown, ThumbsUp, Trash2 } from "@/components/icons";
import { AgentAvatar, type AgentAppearance } from "@/components/agentes/agent-avatar";
import { PixelSpinner } from "@/components/agentes/pixel-spinner";
import { playAgentReaction } from "@/lib/agentes/agent/live";
import { AGENT_ACCESSORIES, AGENT_COLORS, AGENT_EYES, type AgentAccessory, type AgentEyes } from "@/lib/agentes/tokens/look";
import { gradientOf } from "@/lib/agentes/agent/engine.js";
import { noAutofill } from "@/lib/no-autofill";
import { cn } from "@/lib/utils";

/*
 * AI 对话里借鉴 agentes「和代理沟通、管理代理」的几块：
 * - WorkLine：正在做什么（像素轨道 + 当前步骤 + 用时），做事过程看得见
 * - WorkSummary：做完后收成一行「看看它做了什么 · N 步 · X 秒」，点开逐步列出
 * - Feedback：👍 / 👎 / 复制；点赞点踩时助手当场做个表情
 * - AgentProfile：给助手起名字、换颜色 / 眼睛 / 配饰，实时预览
 * - ThreadList：多段对话，随时切回之前的
 */

export type Prefs = { name: string; size: number; look: AgentAppearance };
export const DEFAULT_PREFS: Prefs = { name: "AI 助手", size: 14, look: {} };
export const SIZES = [
  { px: 13, label: "小" },
  { px: 14, label: "标准" },
  { px: 15.5, label: "大" },
  { px: 17, label: "特大" },
];

const COLOR_NAMES: Record<(typeof AGENT_COLORS)[number], string> = {
  sky: "天蓝",
  indigo: "靛蓝",
  violet: "紫罗兰",
  rose: "玫瑰",
  amber: "琥珀",
  green: "薄荷绿",
  teal: "青碧",
  graphite: "石墨",
};
const EYE_NAMES: Record<AgentEyes, string> = { round: "圆眼", dots: "豆豆眼", wide: "大眼", happy: "笑眼", sleepy: "困困眼" };
const ACCESSORY_NAMES: Record<AgentAccessory, string> = {
  none: "不戴",
  hat: "礼帽",
  cap: "棒球帽",
  headphones: "耳机",
  bow: "蝴蝶结",
  crown: "皇冠",
  antenna: "天线",
  headset: "耳麦",
  beanie: "毛线帽",
  party: "派对帽",
  flower: "小花",
  scarf: "围巾",
};

const secondsText = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
};

/** 正在做：像素轨道 + 当前在做的那一步 + 已用时 */
export function WorkLine({ status, since }: { status: string; since?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  return (
    <p className="ac-rise flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
      <PixelSpinner size={13} className="text-brand" />
      <span className="ai-shimmer min-w-0 truncate">{status}</span>
      {elapsed >= 2 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{elapsed}s</span>}
    </p>
  );
}

/** 做完了：一行可展开的工作记录 */
export function WorkSummary({ name, steps, ms }: { name: string; steps: string[]; ms?: number }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  return (
    <div className="max-w-[40rem]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <span className="ac-pixdone size-3.5" aria-hidden />
        看看{name}做了什么
        <span className="text-muted-foreground/70">
          · {steps.length} 步{ms ? ` · ${secondsText(ms)}` : ""}
        </span>
        <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <ol className="ac-rise mt-1 mb-1 space-y-1.5 rounded-[10px] rounded-bl-[2px] border border-line bg-card px-3.5 py-3 text-[13px]">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
              <span className="text-foreground/80">{s.replace(/[…。.]+$/, "")}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** 一条回复下面的小工具：👍 / 👎 让助手当场做个表情；复制回答 */
export function Feedback({
  id,
  value,
  text,
  onChange,
}: {
  id: string;
  value?: "up" | "down";
  text: string;
  onChange: (v: "up" | "down" | undefined) => void;
}) {
  const [copied, setCopied] = useState(false);
  const rate = (kind: "up" | "down") => {
    const next = value === kind ? undefined : kind;
    onChange(next);
    if (next) playAgentReaction(id, next);
  };
  const btn =
    "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  return (
    <div className="-ml-1.5 flex items-center gap-0.5">
      {text.trim() && (
        <button
          type="button"
          className={btn}
          aria-label="复制回答"
          title={copied ? "已复制" : "复制"}
          onClick={() => {
            void navigator.clipboard?.writeText(text.trim()).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
        >
          {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
        </button>
      )}
      <button
        type="button"
        className={cn(btn, value === "up" && "bg-brand-soft text-brand-ink")}
        aria-pressed={value === "up"}
        aria-label="有帮助"
        title="有帮助"
        onClick={() => rate("up")}
      >
        <ThumbsUp className="size-4" />
      </button>
      <button
        type="button"
        className={cn(btn, value === "down" && "bg-muted text-foreground")}
        aria-pressed={value === "down"}
        aria-label="没帮上"
        title="没帮上"
        onClick={() => rate("down")}
      >
        <ThumbsDown className="size-4" />
      </button>
    </div>
  );
}

/** 助手档案：名字、形象（颜色 / 眼睛 / 配饰）和对话字号，左边实时预览 */
export function AgentProfile({ value, onChange, onClose }: { value: Prefs; onChange: (p: Prefs) => void; onClose: () => void }) {
  const [name, setName] = useState(value.name);
  const named = () => name.trim().slice(0, 16) || DEFAULT_PREFS.name;
  const set = (patch: Partial<Prefs>) => onChange({ ...value, name: named(), ...patch });
  const look = value.look;
  const option = "relative grid place-items-center rounded-[10px] border transition-[border-color,background-color,transform] active:scale-95";
  const on = "border-brand bg-brand-soft/60";
  const off = "border-line hover:border-foreground/20 hover:bg-muted";

  return (
    <div className="ac-rise border-b bg-side/60 px-4 py-4 text-left text-sm">
      <div className="flex items-center gap-3.5">
        <AgentAvatar name={named()} size="lg" appearance={look} />
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-xs text-muted-foreground">名字</span>
          <input
            {...noAutofill}
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => set({})}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                set({});
                onClose();
              }
            }}
            placeholder={DEFAULT_PREFS.name}
            className="h-9 w-full min-w-0 rounded-[10px] border border-input bg-card px-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 max-md:text-base"
          />
        </label>
      </div>

      <p className="mt-4 mb-2 text-xs text-muted-foreground">颜色</p>
      <div role="radiogroup" aria-label="颜色" className="flex flex-wrap gap-2">
        {AGENT_COLORS.map((c) => {
          const [top, bottom] = gradientOf(c);
          const checked = (look.color ?? "sky") === c;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={COLOR_NAMES[c]}
              title={COLOR_NAMES[c]}
              onClick={() => set({ look: { ...look, color: c } })}
              className={cn(
                "size-7 rounded-[30%_30%_30%_9%] transition-transform active:scale-90",
                checked ? "ring-2 ring-foreground/70 ring-offset-2 ring-offset-side" : "hover:scale-110",
              )}
              style={{ background: `linear-gradient(160deg, ${top}, ${bottom})` }}
            />
          );
        })}
      </div>

      <p className="mt-4 mb-2 text-xs text-muted-foreground">眼睛</p>
      <div role="radiogroup" aria-label="眼睛" className="flex flex-wrap gap-1.5">
        {AGENT_EYES.map((e) => {
          const checked = (look.eyes ?? "round") === e;
          return (
            <button
              key={e}
              type="button"
              role="radio"
              aria-checked={checked}
              title={EYE_NAMES[e]}
              onClick={() => set({ look: { ...look, eyes: e } })}
              className={cn(option, "h-12 w-14 gap-0.5 pt-1", checked ? on : off)}
            >
              <AgentAvatar name={named()} size="sm" framed={false} appearance={{ ...look, eyes: e, accessory: "none" }} />
              <span className="text-[10.5px] leading-none text-muted-foreground">{EYE_NAMES[e]}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 mb-2 text-xs text-muted-foreground">配饰</p>
      <div role="radiogroup" aria-label="配饰" className="grid grid-cols-6 gap-1.5 max-sm:grid-cols-4">
        {AGENT_ACCESSORIES.map((a) => {
          const checked = (look.accessory ?? "none") === a;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={checked}
              title={ACCESSORY_NAMES[a]}
              onClick={() => set({ look: { ...look, accessory: a } })}
              className={cn(option, "h-14 content-end gap-1 pb-1.5", checked ? on : off)}
            >
              <AgentAvatar name={named()} size="sm" framed={false} appearance={{ ...look, accessory: a }} />
              <span className="text-[10.5px] leading-none text-muted-foreground">{ACCESSORY_NAMES[a]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className="text-xs text-muted-foreground">字号</span>
        <div role="radiogroup" aria-label="字号" className="inline-flex rounded-[10px] bg-card p-0.5 shadow-e1">
          {SIZES.map((s) => (
            <button
              key={s.px}
              type="button"
              role="radio"
              aria-checked={value.size === s.px}
              onClick={() => set({ size: s.px })}
              className={cn(
                "h-7 rounded-md px-3 transition-colors",
                value.size === s.px ? "bg-brand-soft font-medium text-brand-ink" : "text-foreground/70 hover:text-foreground",
              )}
              style={{ fontSize: s.px - 1 }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            set({});
            onClose();
          }}
          className="ml-auto h-8 rounded-md px-3 text-[13px] font-medium text-brand-ink hover:bg-brand-soft"
        >
          完成
        </button>
      </div>
    </div>
  );
}

export type ThreadMeta = { id: string; title: string; at: number; count: number };

const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} 天前` : new Date(at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};

/** 之前的对话：点一下切回去，可以删 */
export function ThreadList({ threads, onOpen, onDelete }: { threads: ThreadMeta[]; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  if (!threads.length) return <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">还没有之前的对话</p>;
  return (
    <ul className="max-h-80 space-y-0.5 overflow-y-auto">
      {threads.map((t) => (
        <li key={t.id} className="group/thread relative">
          <button
            type="button"
            onClick={() => onOpen(t.id)}
            className="flex w-full min-w-0 flex-col rounded-md px-2.5 py-2 pr-9 text-left transition-colors hover:bg-muted"
          >
            <span className="truncate text-[13.5px]">{t.title}</span>
            <span className="text-[11.5px] text-muted-foreground">
              {ago(t.at)} · {t.count} 条
            </span>
          </button>
          <button
            type="button"
            onClick={() => onDelete(t.id)}
            aria-label={`删除对话：${t.title}`}
            className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/thread:opacity-100 hover:bg-background hover:text-destructive focus-visible:opacity-100 max-md:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
