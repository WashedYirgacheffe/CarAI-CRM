"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, Globe, History, Paperclip, Play, Send, Settings2, Square, SquarePen, X } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CanvasLayout } from "@/lib/canvas";
import type { ActionCard } from "@/lib/ai-actions";
import { ActionCardView, cardSummary, type CardState } from "@/components/dashboard/canvas/action-card";
import { applyLayout, applyWorkspace, canvasOnPage, canvasSnapshot, type WorkspaceEvent } from "./canvas-bridge";
import { AgentAvatar, type AgentState } from "@/components/agentes/agent-avatar";
import { PixelSpinner } from "@/components/agentes/pixel-spinner";
import { HeroSky } from "@/components/agentes/sky";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizeAppearance } from "@/lib/agentes/tokens/look";
import { AgentProfile, DEFAULT_PREFS, Feedback, SIZES, ThreadList, WorkLine, WorkSummary, type Prefs, type ThreadMeta } from "./agent-bits";
import { AI_COMPOSE_EVENT, type ComposeKind } from "./selection-toolbar";
import { RichText, VisualView } from "./ai-visual";
import { isStageTabs, setStageMode, setStagePane, useStage, withStageTransition } from "./ai-stage";
import { visualSummary, type Visual } from "@/lib/ai-visual";
import { cn } from "@/lib/utils";
import { noAutofill } from "@/lib/no-autofill";
import { filesToAttachments, MAX_ATTACHMENTS, type AiAttachment } from "./ai-media";
import { AI_LOOK_EVENT, type AiLookDetail, type PageSnippet } from "./ai-context-menu";
import { PixelSpinner as Busy } from "@/components/agentes/pixel-spinner";

type Choice = { question: string; options: { label: string; detail?: string; reply: string }[] };
type Source = { title: string; url: string; site: string; snippet: string };
/** 用户这句话带的图片 / 视频（只留缩略图，存得下）和右键给 AI 看的页面内容 */
type UserMedia = { kind: "image" | "video"; name: string; thumb: string };
type AssistantTurn = {
  role: "assistant";
  /** 用来让这条回复旁边的助手做表情（旧记录没有，读回时补上） */
  id: string;
  text: string;
  status: string | null;
  choice: Choice | null;
  links: { label: string; href: string }[];
  error: string | null;
  done: boolean;
  cards: CardState[];
  /** 对话里的可视化卡片（旧记录没有） */
  visuals?: Visual[];
  /** 不在工作台时 AI 摆了组件：给一个「到工作台查看」 */
  canvas?: boolean;
  /** 本步开始时的文字长度，丢弃过渡话时截回这里 */
  mark: number;
  /** 做事过程：每一步的说明，开始 / 结束时间 */
  steps?: string[];
  startedAt?: number;
  endedAt?: number;
  feedback?: "up" | "down";
  /** 联网查到 / 读过的网页 */
  sources?: Source[];
};
type UserTurn = { role: "user"; text: string; media?: UserMedia[]; snippet?: { label: string; text: string } };
type Turn = UserTurn | AssistantTurn;
type Thread = { id: string; turns: Turn[]; at: number };
const MAX_THREADS = 20;
const newId = () => Math.random().toString(36).slice(2, 10);
const titleOf = (turns: Turn[]) =>
  turns
    .find((t) => t.role === "user")
    ?.text.replace(/\s+/g, " ")
    .slice(0, 40) || "新对话";

type StreamEvent =
  | { t: "status"; text: string }
  | { t: "text"; text: string }
  | { t: "layout"; layout: CanvasLayout }
  | ({ t: "choice" } & Choice)
  | { t: "link"; label: string; href: string }
  | { t: "visual"; visual: Visual }
  | { t: "error"; message: string }
  | { t: "action"; card: ActionCard }
  | { t: "sources"; items: Source[] }
  | WorkspaceEvent
  | { t: "step" }
  | { t: "drop" }
  | { t: "done" };

const MAX_TURNS = 30;

function suggestionsFor(path: string, sp: URLSearchParams) {
  if (/^\/customers\/[^/]+$/.test(path)) return ["总结这个客户的近况", "给这个客户起草一封跟进邮件", "明天上午提醒我跟进这个客户"];
  if (path === "/mail" && sp.get("id")) return ["帮我起草这封邮件的回复", "把发件人建成线索", "后天提醒我处理这封邮件"];
  if (path.startsWith("/quotations")) return ["最近的报价单哪些还没成交", "给 Acme 做一份报价单"];
  if (path.startsWith("/marketing")) return ["我有哪些营销序列", "把最近的询盘客户加入序列"];
  if (path.startsWith("/mail")) return ["有哪些未读邮件要先处理", "总结一下这周的询盘邮件", "最近谁问过价格"];
  if (path.startsWith("/whatsapp")) return ["WhatsApp 上谁还在等我回复", "总结一下今天的 WhatsApp 对话", "看看客户发来的图片是什么"];
  if (path.startsWith("/leads")) return ["哪些询盘还没人跟进", "联网查一下最新询盘公司的背景"];
  return ["今天有哪些事要处理", "有哪些未读邮件和 WhatsApp", "团队本月业绩怎么样", "联网查一下最近的汽车出口行情"];
}

/** 把一轮回复压成给模型看的历史（选项里的 reply 带着 id，下一轮要用） */
function historyOf(turns: Turn[]) {
  return turns.slice(-10).map((t) => {
    if (t.role === "user") {
      const extra = [
        t.media?.length ? `（我发了${t.media.map((m) => `${m.kind === "video" ? "视频" : "图片"}「${m.name}」`).join("、")}）` : "",
        t.snippet ? `（我右键给你看了「${t.snippet.label}」：${t.snippet.text.slice(0, 1200)}）` : "",
      ].filter(Boolean);
      return { role: "user" as const, content: [t.text, ...extra].join("\n") };
    }
    const parts = [t.text.trim()];
    if (t.choice) parts.push(`（我问了：${t.choice.question}；选项：${t.choice.options.map((o) => `${o.label} → ${o.reply}`).join("；")}）`);
    for (const v of t.visuals ?? []) parts.push(visualSummary(v));
    for (const c of t.cards) parts.push(cardSummary(c));
    if (t.links.length) parts.push(`（给了跳转按钮：${t.links.map((l) => `${l.label} ${l.href}`).join("，")}）`);
    if (t.sources?.length) parts.push(`（参考了网页：${t.sources.map((x) => `${x.title} ${x.url}`).join("；")}）`);
    return { role: "assistant" as const, content: parts.filter(Boolean).join("\n") || "（已调整画布）" };
  });
}

/** 刷新页面后恢复：没跑完的一轮标成结束，执行中的卡片回到待确认 */
function revive(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Turn[]).slice(-MAX_TURNS).map((t) =>
    t.role === "assistant"
      ? {
          ...t,
          id: t.id || newId(),
          status: null,
          done: true,
          cards: (t.cards ?? []).map((c) => (c.state === "running" ? { ...c, state: "pending" } : c)),
        }
      : t,
  );
}

/** 全局 AI 浮窗：右下角的小角色，点开向左推出对话条；切页面不丢对话 */
const COMPOSE: Record<ComposeKind, { title: string; options: { label: string; prompt: string }[] }> = {
  polish: {
    title: "润色",
    options: [
      { label: "更专业正式", prompt: "把下面这段润色得更专业、正式，适合外贸商务往来，保持原语言，只给出润色后的文本" },
      { label: "更简洁", prompt: "把下面这段改得更简洁有力，保留关键信息，保持原语言，只给出改好的文本" },
      { label: "更亲切热情", prompt: "把下面这段改得更亲切热情、有温度，保持原语言，只给出改好的文本" },
      { label: "修正语法", prompt: "只修正下面这段的语法和拼写错误，尽量不改原意和语气，并简短列出改了哪里" },
    ],
  },
  rewrite: {
    title: "仿写",
    options: [
      { label: "换个说法", prompt: "仿照下面这段，用不同的措辞写一版意思相同的，保持原语言" },
      { label: "写成跟进邮件", prompt: "仿照下面这段的风格，写一封给客户的跟进邮件（含主题），用英文" },
      { label: "写成 WhatsApp 短消息", prompt: "仿照下面这段，改写成一条简短自然的 WhatsApp 消息，用英文" },
      { label: "译成英文并润色", prompt: "把下面这段写成地道的商务英文" },
    ],
  },
  variants: {
    title: "裂变",
    options: [
      { label: "裂变 3 个版本", prompt: "基于下面这段，裂变出 3 个措辞不同但意思一致的版本，用于群发避免雷同，保持原语言，编号列出" },
      { label: "5 个邮件主题", prompt: "基于下面这段，写 5 个吸引人打开的英文邮件主题行，编号列出" },
      { label: "不同语气各一版", prompt: "基于下面这段，分别写正式、友好、简短三种语气各一版，保持原语言" },
      { label: "多语言版本", prompt: "把下面这段分别写成英语、西班牙语、德语三个版本" },
    ],
  },
};

export function AiDock({ storageKey }: { storageKey: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState(0);
  const [unread, setUnread] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // 待发送的图片 / 视频、右键带来的页面内容、正在处理（抽帧、下载）的个数、是否有文件拖进来
  const [files, setFiles] = useState<AiAttachment[]>([]);
  const [snippet, setSnippet] = useState<PageSnippet | null>(null);
  const [preparing, setPreparing] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // 划词唤起的「润色 / 仿写 / 裂变」：先问想要什么效果
  const [compose, setCompose] = useState<{ text: string; kind: ComposeKind } | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [editing, setEditing] = useState(false);
  // 多段对话：当前这段 + 之前的（最新在前）
  const [threadId, setThreadId] = useState(newId);
  const [archive, setArchive] = useState<Thread[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [ready, setReady] = useState(false);
  // 电脑端（≥768px）角色常驻右下角；手机端只在工作台常驻
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // 电脑端工作台：对话界面放进页面里的「AI 舞台」，而不是右下角浮窗
  const stage = useStage();
  const staged = pathname === "/dashboard" && !!stage.slot;
  const stagedRef = useRef(staged);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);
  const hasTurns = turns.length > 0;
  useLayoutEffect(() => {
    setStageMode(hasTurns ? "split" : "hero");
  }, [hasTurns]);
  /** 舞台上从居中切到左右分栏（或反过来）时带过渡动画 */
  const morph = (update: () => void) => {
    if (!stagedRef.current) return update();
    withStageTransition(() => flushSync(update));
  };
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const heroFace = useRef<HTMLSpanElement>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // 读回上次的对话（只在浏览器里，避免和服务端渲染不一致）
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
        turns?: unknown;
        id?: string;
        archive?: { id?: string; turns?: unknown; at?: number }[];
        open?: boolean;
      } | null;
      if (saved) {
        setTurns(revive(saved.turns));
        if (saved.id) setThreadId(saved.id);
        if (Array.isArray(saved.archive))
          setArchive(
            saved.archive
              .map((t) => ({ id: t.id || newId(), turns: revive(t.turns), at: t.at ?? Date.now() }))
              .filter((t) => t.turns.length)
              .slice(0, MAX_THREADS),
          );
        if (saved.open && (window.location.pathname === "/dashboard" || window.matchMedia("(min-width: 768px)").matches)) setOpen(true);
      }
      const p = JSON.parse(localStorage.getItem(`${storageKey}:prefs`) ?? "null") as Partial<Prefs> | null;
      if (p)
        setPrefs({
          name: p.name?.trim() || DEFAULT_PREFS.name,
          size: SIZES.some((x) => x.px === p.size) ? p.size! : DEFAULT_PREFS.size,
          look: normalizeAppearance(p.look),
        });
    } catch {}
    setReady(true);
  }, [storageKey]);
  // 读回存档之后才开始写，免得初始的空状态先把存档覆盖掉
  useEffect(() => {
    if (!ready || busy) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ id: threadId, turns: turns.slice(-MAX_TURNS), archive, open }));
    } catch {}
  }, [ready, turns, threadId, archive, open, busy, storageKey]);

  const savePrefs = (next: Prefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(`${storageKey}:prefs`, JSON.stringify(next));
    } catch {}
  };

  useEffect(() => {
    if (open || staged) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, open, staged]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const toggle = (next = !open) => {
    // 舞台上没有「收起」：⌘J / 唤起时直接聚焦输入框
    if (stagedRef.current) {
      setStagePane("chat");
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      return;
    }
    setOpen(next);
    if (!next) setCompose(null);
    if (next) {
      setUnread(false);
      setPush((n) => n + 1);
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    }
  };

  // ⌘J / Ctrl+J 打开或收起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle(!openRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchLast = (fn: (t: AssistantTurn) => Partial<AssistantTurn>) =>
    setTurns((ts) => {
      const last = ts[ts.length - 1];
      if (!last || last.role !== "assistant") return ts;
      return [...ts.slice(0, -1), { ...last, ...fn(last) }];
    });

  const send = async (raw: string, extra?: { attachments?: AiAttachment[]; snippet?: PageSnippet | null }) => {
    const media = extra?.attachments ?? files;
    const look = extra && "snippet" in extra ? (extra.snippet ?? null) : snippet;
    const message = raw.trim() || (media.length || look ? (media.length ? "帮我看看这个" : "帮我看看这是什么") : "");
    if (!message || busy) return;
    if (!extra) {
      setFiles([]);
      setSnippet(null);
    }
    const history = historyOf(turns);
    const snap = canvasSnapshot();
    const query = sp.toString();
    const first = turns.length === 0;
    const start = () => {
      setInput("");
      setBusy(true);
      setTurns((ts) => [
        ...ts.slice(-(MAX_TURNS - 2)),
        {
          role: "user",
          text: message,
          ...(media.length ? { media: media.map((m) => ({ kind: m.kind, name: m.name, thumb: m.thumb })) } : {}),
          ...(look ? { snippet: { label: look.label, text: look.text.slice(0, 2000) } } : {}),
        },
        {
          role: "assistant",
          id: newId(),
          text: "",
          status: "正在思考…",
          choice: null,
          links: [],
          error: null,
          done: false,
          mark: 0,
          cards: [],
          visuals: [],
          steps: [],
          startedAt: Date.now(),
        },
      ]);
      if (first) setStageMode("split");
      if (stagedRef.current) setStagePane("chat");
    };
    if (first) morph(start);
    else start();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/ai/canvas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          history,
          layout: snap.layout,
          active: snap.active,
          page: `${pathname}${query ? `?${query}` : ""}`,
          // 手机上的工作台在另一个标签页，看不到画布：按「不在工作台」回答，多用对话里的图表卡片
          onCanvas: canvasOnPage() && !isStageTabs(),
          narrow: !window.matchMedia("(min-width: 768px)").matches,
          name: prefs.name,
          attachments: media.map((m) => ({ kind: m.kind, name: m.name, frames: m.frames, times: m.times, duration: m.duration })),
          snippet: look ?? undefined,
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => "")) || "AI 暂时不可用，请稍后重试");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as StreamEvent;
          if (e.t === "step") patchLast((t) => ({ mark: t.text.length }));
          else if (e.t === "drop") patchLast((t) => ({ text: t.text.slice(0, t.mark) }));
          else if (e.t === "status")
            patchLast((t) => ({ status: e.text, steps: t.steps?.at(-1) === e.text ? t.steps : [...(t.steps ?? []), e.text] }));
          else if (e.t === "text") patchLast((t) => ({ text: t.text + e.text, status: null }));
          else if (e.t === "layout") {
            const here = canvasOnPage();
            const tabs = isStageTabs();
            applyLayout(e.layout);
            if (!here || tabs) patchLast(() => ({ canvas: true }));
            if (tabs) setStagePane("chat", true);
          } else if (e.t === "choice") patchLast(() => ({ choice: { question: e.question, options: e.options }, status: null }));
          else if (e.t === "action")
            patchLast((t) => ({ cards: [...t.cards, { card: e.card, params: e.card.params, state: "pending" }], status: null }));
          else if (e.t === "workspace") {
            const here = canvasOnPage();
            const tabs = isStageTabs();
            applyWorkspace(e);
            if (!here || tabs) patchLast(() => ({ canvas: true }));
            if (tabs) setStagePane("chat", true);
          } else if (e.t === "visual") patchLast((t) => ({ visuals: [...(t.visuals ?? []), e.visual], status: null }));
          else if (e.t === "link") patchLast((t) => ({ links: [...t.links, { label: e.label, href: e.href }] }));
          else if (e.t === "sources") patchLast((t) => ({ sources: [...(t.sources ?? []), ...e.items].slice(0, 8) }));
          else if (e.t === "error") patchLast(() => ({ error: e.message, status: null }));
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) patchLast(() => ({ error: e instanceof Error ? e.message : "AI 出错了，请重试" }));
    } finally {
      patchLast(() => ({ status: null, done: true, endedAt: Date.now() }));
      setBusy(false);
      abortRef.current = null;
      if (!openRef.current && !stagedRef.current) setUnread(true);
    }
  };

  const patchCard = (ti: number, ci: number, patch: Partial<CardState>) =>
    setTurns((ts) =>
      ts.map((t, i) => (i === ti && t.role === "assistant" ? { ...t, cards: t.cards.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : t)),
    );

  /** 当前这段收进「之前的对话」 */
  const shelve = (rest: Thread[]) => (turns.length ? [{ id: threadId, turns, at: Date.now() }, ...rest] : rest).slice(0, MAX_THREADS);
  const clear = () =>
    morph(() => {
      setArchive((a) => shelve(a));
      setTurns([]);
      setThreadId(newId());
      setStageMode("hero");
    });
  const openThread = (id: string) => {
    const t = archive.find((x) => x.id === id);
    if (!t || busy) return;
    setHistoryOpen(false);
    morph(() => {
      setArchive((a) => shelve(a.filter((x) => x.id !== id)));
      setTurns(t.turns);
      setThreadId(t.id);
      setStageMode("split");
    });
  };
  const deleteThread = (id: string) => setArchive((a) => a.filter((x) => x.id !== id));
  const threadMetas: ThreadMeta[] = archive.map((t) => ({ id: t.id, title: titleOf(t.turns), at: t.at, count: t.turns.length }));
  const setFeedback = (ti: number, v: "up" | "down" | undefined) =>
    setTurns((ts) => ts.map((t, i) => (i === ti && t.role === "assistant" ? { ...t, feedback: v } : t)));

  // 助手此刻的状态：想 → 写 → 等你确认 → 待命
  const lastTurn = turns.at(-1);
  const pending = turns.reduce((n, t) => n + (t.role === "assistant" ? t.cards.filter((c) => c.state === "pending").length : 0), 0);
  const agentState: AgentState = busy
    ? lastTurn?.role === "assistant" && lastTurn.text.trim() && !lastTurn.status
      ? "writing"
      : "thinking"
    : pending
      ? "waiting"
      : "idle";
  const stateText =
    agentState === "thinking"
      ? "正在处理…"
      : agentState === "writing"
        ? "正在回复…"
        : agentState === "waiting"
          ? `有 ${pending} 件事等你确认`
          : "能看邮件和 WhatsApp、联网、看图看视频，起草的事你确认后才执行";

  const stop = () => {
    abortRef.current?.abort();
    patchLast((t) => ({ text: t.text || "已停止", status: null, done: true, endedAt: Date.now() }));
  };

  // 页面上的「让 AI …」按钮：打开浮窗并直接发出
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    const onAsk = (e: Event) => {
      const message = (e as CustomEvent<{ message?: string }>).detail?.message;
      if (!message) return;
      toggle(true);
      void sendRef.current(message);
    };
    const onCompose = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; kind?: ComposeKind }>).detail;
      if (!d?.text || !d.kind) return;
      setCompose({ text: d.text.slice(0, 4000), kind: d.kind });
      toggle(true);
    };
    // 右键「给 AI 看看」：带着那一块内容打开；图片 / 视频处理好了再放进来；带了 message 就直接发
    const onLook = (e: Event) => {
      const d = (e as CustomEvent<AiLookDetail>).detail;
      if (!d) return;
      toggle(true);
      setCompose(null);
      if (d.message) {
        const go = (items: AiAttachment[]) => void sendRef.current(d.message!, { attachments: items, snippet: d.snippet ?? null });
        if (d.pending) {
          setPreparing((n) => n + 1);
          void d.pending.then(go).finally(() => setPreparing((n) => n - 1));
        } else go(d.attachments ?? []);
        return;
      }
      setSnippet(d.snippet ?? null);
      if (d.attachments?.length) setFiles((f) => [...f, ...d.attachments!].slice(-MAX_ATTACHMENTS));
      if (d.pending) {
        setPreparing((n) => n + 1);
        void d.pending.then((items) => setFiles((f) => [...f, ...items].slice(-MAX_ATTACHMENTS))).finally(() => setPreparing((n) => n - 1));
      }
    };
    window.addEventListener("crm:ai-ask", onAsk);
    window.addEventListener(AI_COMPOSE_EVENT, onCompose);
    window.addEventListener(AI_LOOK_EVENT, onLook);
    return () => {
      window.removeEventListener("crm:ai-ask", onAsk);
      window.removeEventListener(AI_COMPOSE_EVENT, onCompose);
      window.removeEventListener(AI_LOOK_EVENT, onLook);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 电脑端每个页面都常驻；手机端只在工作台常驻，其他页面由「让 AI …」按钮唤起，换页就收起
  const home = pathname === "/dashboard";
  useEffect(() => {
    // 直接问浏览器宽度：刚加载时 desktop 状态还没同步，用它会把电脑上本该开着的浮窗关掉
    if (pathname !== "/dashboard" && !window.matchMedia("(min-width: 768px)").matches) setOpen(false);
  }, [pathname]);

  const suggestions = suggestionsFor(pathname, sp);
  const runCompose = (instruction: string) => {
    if (!compose) return;
    const c = compose;
    setCompose(null);
    void send(`${instruction}\n\n原文：\n"""\n${c.text}\n"""`);
  };
  // 有底部输入框的页面（聊天、写信）把角色抬高一点，别挡住发送按钮
  const lifted = pathname.startsWith("/whatsapp") || pathname.startsWith("/mail/compose");
  // 客户详情在手机上底部有「写跟进」操作条
  const liftMobile = /^\/customers\/(?!new)[^/]+$/.test(pathname);

  /** 选的、粘贴的、拖进来的图片和视频 */
  const addFiles = async (list: FileList | File[] | null) => {
    const arr = [...(list ?? [])].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!arr.length) return false;
    const room = MAX_ATTACHMENTS - files.length;
    if (room <= 0) {
      toast.error(`一次最多 ${MAX_ATTACHMENTS} 个图片或视频`);
      return true;
    }
    setPreparing((n) => n + 1);
    try {
      const { items, skipped } = await filesToAttachments(arr.slice(0, room));
      setFiles((f) => [...f, ...items].slice(0, MAX_ATTACHMENTS));
      if (skipped) toast.error(`有 ${skipped} 个文件读不了，已跳过`);
      if (arr.length > room) toast.error(`一次最多 ${MAX_ATTACHMENTS} 个，多出的没有加上`);
    } finally {
      setPreparing((n) => n - 1);
    }
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return true;
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (![...e.dataTransfer.items].some((i) => i.kind === "file")) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setDragging(false);
      void addFiles(e.dataTransfer.files);
    },
  };
  const staging = files.length > 0 || !!snippet || preparing > 0;
  /** 输入框上方：待发的页面内容、图片、视频，和几个顺手的问法 */
  const tray = staging && (
    <div className="flex flex-col gap-2 pt-1.5 pb-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {snippet && (
          <span className="ac-attach flex h-12 max-w-[16rem] min-w-0 items-center gap-2 rounded-[10px] border border-line bg-muted/60 py-1 pr-1 pl-2 text-left">
            <span className="ac-tile size-6 shrink-0" style={{ borderRadius: "30% 30% 30% 9%" }}>
              <Eye className="size-3.5" strokeWidth={2.2} />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[12.5px] font-medium">{snippet.label || "页面内容"}</span>
              <span className="block truncate text-[11.5px] text-muted-foreground">{snippet.text.replace(/\s+/g, " ").slice(0, 80)}</span>
            </span>
            <button
              type="button"
              onClick={() => setSnippet(null)}
              aria-label="去掉页面内容"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          </span>
        )}
        {files.map((f) => (
          <span
            key={f.id}
            className="ac-attach group relative size-12 shrink-0 overflow-hidden rounded-[10px] border border-line bg-muted"
            title={f.name}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.thumb} alt={f.name} className="size-full object-cover" />
            {f.kind === "video" && (
              <span className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
                <Play className="size-2.5 fill-current" />
                {f.frames.length} 帧
              </span>
            )}
            <button
              type="button"
              onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}
              aria-label={`去掉 ${f.name}`}
              className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-md bg-black/55 text-white opacity-90 hover:bg-black/75 md:opacity-0 md:group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {preparing > 0 && (
          <span
            className="grid size-12 place-items-center rounded-[10px] border border-dashed border-line text-muted-foreground"
            aria-label="正在处理"
          >
            <Busy size={14} className="text-brand" />
          </span>
        )}
      </div>
      {!input.trim() && (
        <div className="flex flex-wrap gap-1.5">
          {(files.length
            ? ["这是什么", "图里的文字和数字帮我整理出来", "结合客户资料，我该怎么回复"]
            : ["这是什么，帮我解释", "总结要点", "接下来我该做什么"]
          ).map((q) => (
            <button
              key={q}
              type="button"
              disabled={busy || preparing > 0}
              onClick={() => void send(q)}
              className="h-7 rounded-md border border-line bg-card px-2.5 text-[12px] text-foreground/80 transition-colors hover:bg-muted disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
  const attachButton = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        aria-label="发图片或视频"
        title="发图片或视频（也可以直接粘贴、拖进来）"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Paperclip className="size-[18px]" />
      </button>
    </>
  );

  const live = open || staged;
  const iconBtn =
    "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
  const settingsButton = (
    <button
      type="button"
      onClick={() => setEditing((v) => !v)}
      aria-label="助手档案"
      aria-expanded={editing}
      title="助手档案：名字、形象、字号"
      className={cn(iconBtn, editing && "bg-muted text-foreground")}
    >
      <Settings2 className="size-[18px]" />
    </button>
  );
  const historyButton = (
    <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="之前的对话" title="之前的对话" className={cn(iconBtn, historyOpen && "bg-muted text-foreground")}>
          <History className="size-[18px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-1 p-1.5">
        <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">之前的对话</p>
        <ThreadList threads={threadMetas} onOpen={openThread} onDelete={deleteThread} />
      </PopoverContent>
    </Popover>
  );
  const prefsPanel = editing && <AgentProfile value={prefs} onChange={savePrefs} onClose={() => setEditing(false)} />;
  const composeBox = compose && (
    <div className="ac-rise border-b bg-brand-soft/40 px-4 py-3 text-left">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold">{COMPOSE[compose.kind].title}</span>
        <span className="text-muted-foreground">想要什么效果？点一个，或在下面直接说</span>
        <button
          type="button"
          onClick={() => setCompose(null)}
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted"
          aria-label="取消"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <blockquote className="mt-2 line-clamp-3 border-l-2 border-brand/60 pl-2.5 text-[13px] whitespace-pre-wrap text-foreground/75">
        {compose.text}
      </blockquote>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {COMPOSE[compose.kind].options.map((o) => (
          <button
            key={o.label}
            type="button"
            disabled={busy}
            onClick={() => runCompose(o.prompt)}
            className="h-8 rounded-md border border-brand/25 bg-card px-3 text-[12.5px] font-medium text-brand-ink transition-colors hover:bg-brand-soft disabled:opacity-50"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
  const chips = (className?: string) => (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => void send(s)}
          className="h-8 shrink-0 rounded-[10px] border border-line bg-card px-3 text-[12.5px] text-foreground/80 shadow-e1 transition-[color,background-color,transform] hover:bg-muted hover:text-foreground active:scale-[0.97]"
        >
          {s}
        </button>
      ))}
    </div>
  );
  const log = (
    <div ref={logRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-4 pb-3" style={{ fontSize: prefs.size }} aria-live="polite">
      {turns.map((t, i) =>
        t.role === "user" ? (
          <UserView key={i} turn={t} />
        ) : (
          <AssistantView
            key={t.id ?? i}
            turn={t}
            name={prefs.name}
            look={prefs.look}
            state={i === turns.length - 1 ? agentState : "idle"}
            last={i === turns.length - 1}
            busy={busy}
            onReply={send}
            onCard={(ci, patch) => patchCard(i, ci, patch)}
            onFeedback={(v) => setFeedback(i, v)}
            onNavigate={() => setOpen(false)}
            onShowCanvas={staged ? () => withStageTransition(() => setStagePane("canvas")) : undefined}
          />
        ),
      )}
    </div>
  );
  const submit = () => {
    if (compose && input.trim()) {
      const v = input.trim();
      setInput("");
      runCompose(`${COMPOSE[compose.kind].title}：${v}`);
    } else void send(input);
  };
  /** 输入框：回车发送，Shift+回车换行，输入法选词时的回车不算 */
  const field = (big: boolean) => (
    <textarea
      {...noAutofill}
      ref={inputRef}
      value={input}
      rows={1}
      tabIndex={live ? 0 : -1}
      onChange={(e) => setInput(e.target.value)}
      onPaste={(e) => {
        const pasted = [...e.clipboardData.files];
        if (pasted.some((f) => f.type.startsWith("image/") || f.type.startsWith("video/"))) {
          e.preventDefault();
          void addFiles(pasted);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          submit();
        }
      }}
      placeholder={
        compose
          ? "说说想要的效果，比如：更正式、写成西班牙语…"
          : staging
            ? "想让我看什么？比如：这是什么、帮我回复…"
            : big || !hasTurns
              ? "说一句话：查数据、看邮件和 WhatsApp、联网查资料、发图给我看…"
              : "接着说，或让我做点别的…"
      }
      aria-label={`对${prefs.name}说`}
      maxLength={2000}
      style={{ fontSize: big ? Math.max(prefs.size + 1, desktop ? 15 : 16) : Math.max(prefs.size, desktop ? 13.5 : 16) }}
      className={cn(
        "field-sizing-content min-w-0 flex-1 resize-none bg-transparent leading-6 outline-none placeholder:text-muted-foreground",
        big ? "max-h-40 min-h-12 py-1" : "max-h-32 py-2",
      )}
    />
  );
  const sendButton = (big: boolean) =>
    busy ? (
      <Button type="button" size={big ? "icon" : "icon-sm"} variant="outline" onClick={stop} aria-label="停止" title="停止">
        <Square className="size-4 [&_rect]:fill-current" />
      </Button>
    ) : (
      <Button
        type="submit"
        size={big ? "icon" : "icon-sm"}
        variant="brand"
        disabled={(!input.trim() && !files.length && !snippet) || preparing > 0}
        aria-label="发送"
        title="发送（回车）"
        tabIndex={live ? 0 : -1}
      >
        <Send className="size-[18px]" />
      </Button>
    );
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };
  /** 对话里的输入框（贴底） */
  const form = (className: string) => (
    <form aria-hidden={!live} className={cn(className, dragging && "ac-dropzone")} onSubmit={onSubmit} {...dropProps}>
      <div className="flex min-w-0 flex-1 flex-col">
        {tray}
        <div className="flex min-w-0 items-end">{field(false)}</div>
      </div>
      <span className="flex shrink-0 items-center gap-0.5 self-end pb-1">
        {attachButton}
        {sendButton(false)}
      </span>
    </form>
  );
  const header = (
    <header className="flex items-center gap-2.5 border-b px-3.5 py-2.5">
      <span className="[view-transition-name:ai-mascot]">
        <AgentAvatar name={prefs.name} size="md" state={agentState} appearance={prefs.look} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.005em]">{prefs.name}</span>
        <span
          className={cn("flex items-center gap-1.5 truncate text-xs", agentState === "waiting" ? "text-warn" : "text-muted-foreground")}
          aria-live="polite"
        >
          {busy && <PixelSpinner size={10} className="text-brand" />}
          <span className="truncate">{stateText}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          disabled={busy}
          onClick={clear}
          title="新对话（当前这段会留在「之前的对话」里）"
          aria-label="新对话"
          className={cn(iconBtn, "disabled:opacity-40")}
        >
          <SquarePen className="size-[18px]" />
        </button>
        {historyButton}
        {settingsButton}
        {!staged && (
          <button type="button" onClick={() => toggle(false)} aria-label="收起" title="收起（Esc）" className={iconBtn}>
            <X className="size-[18px]" />
          </button>
        )}
      </span>
    </header>
  );

  // 工作台：对话界面就是页面主角（电脑左右分栏，手机分「对话 / 工作台」两页）
  if (staged && stage.slot) {
    return createPortal(
      hasTurns ? (
        <section
          aria-label={prefs.name}
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] bg-card shadow-e2 [view-transition-name:ai-panel]"
        >
          {header}
          {prefsPanel}
          {composeBox}
          {log}
          <div className="p-3 pt-1">
            {form(
              "flex items-end gap-2 rounded-xl border border-[var(--line-strong)] bg-background py-1 pr-1.5 pl-3.5 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25 [view-transition-name:ai-input]",
            )}
          </div>
        </section>
      ) : (
        <section
          aria-label={prefs.name}
          className="relative mx-auto flex max-w-2xl flex-col items-center pt-[max(3.5rem,calc(33svh-11rem))] pb-8 text-center lg:pt-[max(3.75rem,calc(33svh-16rem))] lg:pb-10"
        >
          <span className="absolute top-0 right-0 flex items-center gap-0.5">
            {archive.length > 0 && historyButton}
            {settingsButton}
          </span>
          {/* 助手站在一小片自己的天光里 */}
          <span className="relative grid place-items-center">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[300px] w-[min(620px,94vw)] -translate-1/2 overflow-hidden"
            >
              <HeroSky color={prefs.look.color ?? "sky"} face={heroFace} />
            </span>
            <span ref={heroFace} className="relative grid place-items-center [view-transition-name:ai-mascot]">
              <AgentAvatar name={prefs.name} size="xl" state={agentState} appearance={prefs.look} labelled />
            </span>
          </span>
          <h1 className="mt-2 font-brand text-[1.5rem] leading-8 font-medium tracking-[-0.02em] md:text-[1.8rem] md:leading-10">{stage.greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stage.sub ? `${stage.sub} · ` : ""}今天想让<b className="font-medium text-foreground">{prefs.name}</b>帮你做什么？
          </p>
          {(prefsPanel || composeBox) && (
            <div className="mt-4 w-full overflow-hidden rounded-[14px] bg-card shadow-e2">
              {prefsPanel}
              {composeBox}
            </div>
          )}
          <form
            aria-hidden={!live}
            onSubmit={onSubmit}
            {...dropProps}
            className={cn(
              "mt-5 w-full rounded-[14px] border border-[var(--line-strong)] bg-card px-4 pt-3 pb-2.5 text-left shadow-e3 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/20 [view-transition-name:ai-input]",
              dragging && "ac-dropzone",
            )}
          >
            {tray}
            <div className="flex">{field(true)}</div>
            <div className="mt-1 flex items-center gap-2">
              {attachButton}
              <span className="text-xs text-muted-foreground max-md:hidden">回车发送 · 可以粘贴或拖进图片、视频 · 页面上右键「给 AI 看看」</span>
              <span className="ml-auto">{sendButton(true)}</span>
            </div>
          </form>
          {!compose &&
            chips(
              "mt-3.5 justify-center max-md:-mx-3 max-md:w-[calc(100%+1.5rem)] max-md:flex-nowrap max-md:justify-start max-md:overflow-x-auto max-md:px-3 max-md:py-1 max-md:[scrollbar-width:none]",
            )}
        </section>
      ),
      stage.slot,
    );
  }

  if (!home && !open && !desktop) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed right-3 z-40 flex w-[min(40rem,calc(100vw-1.5rem))] flex-col items-end gap-2 md:right-6",
        lifted
          ? "bottom-[calc(9rem+env(safe-area-inset-bottom))] md:bottom-24"
          : liftMobile
            ? "bottom-[calc(9rem+env(safe-area-inset-bottom))] md:bottom-6"
            : "bottom-[calc(5.25rem+env(safe-area-inset-bottom))] md:bottom-6",
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open && !historyOpen) toggle(false);
      }}
    >
      {/* 对话记录：在对话条上方 */}
      {open && (
        <section
          aria-label={prefs.name}
          className="pointer-events-auto flex max-h-[min(36rem,calc(100svh-12rem))] w-full origin-bottom-right animate-in flex-col overflow-hidden rounded-[18px] bg-popover shadow-e3 duration-200 fade-in-0 slide-in-from-bottom-2"
        >
          {header}
          {prefsPanel}
          {composeBox}
          {compose && turns.length === 0 ? null : turns.length === 0 ? (
            <div className="space-y-2.5 px-4 py-3.5">
              <p className="text-sm text-muted-foreground">可以这样问我：</p>
              {chips()}
            </div>
          ) : (
            log
          )}
        </section>
      )}

      <div className="flex w-full items-end justify-end gap-2">
        {/* 对话条：从助手左边推出来 */}
        {form(
          cn(
            "flex min-h-12 min-w-0 origin-right items-end gap-2 overflow-hidden rounded-[14px] border border-[var(--line-strong)] bg-popover py-1 pr-1.5 pl-4 shadow-e3 transition-[max-width,opacity,transform,border-color,box-shadow] duration-300 ease-out focus-within:border-ring",
            open ? "pointer-events-auto max-w-full flex-1 opacity-100" : "max-w-0 flex-none scale-x-90 border-transparent opacity-0",
          ),
        )}

        <button
          key={push}
          type="button"
          onClick={() => toggle()}
          aria-label={open ? `收起${prefs.name}` : `打开${prefs.name}`}
          aria-expanded={open}
          title={open ? "收起（⌘J）" : `${prefs.name}（⌘J）`}
          className={cn(
            "pointer-events-auto relative shrink-0 rounded-[30%] shadow-e3 transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            push > 0 && "ai-push",
          )}
        >
          <AgentAvatar name={prefs.name} size="lg" state={agentState} appearance={prefs.look} />
          {busy && !open && (
            <span className="absolute -top-1 -left-1 grid size-5 place-items-center rounded-md bg-popover shadow-e1">
              <PixelSpinner size={11} className="text-brand" />
            </span>
          )}
          {(unread || pending > 0) && !open && (
            <span
              className={cn("absolute -top-0.5 -right-0.5 size-3 rounded-full ring-2 ring-popover", pending ? "bg-warn" : "bg-destructive")}
              aria-label={pending ? "有事等你确认" : "有新回复"}
            />
          )}
        </button>
      </div>
    </div>
  );
}

function AssistantView({
  turn,
  name,
  look,
  state,
  last,
  busy,
  onReply,
  onCard,
  onFeedback,
  onNavigate,
  onShowCanvas,
}: {
  turn: AssistantTurn;
  name: string;
  look: Prefs["look"];
  state: AgentState;
  last: boolean;
  busy: boolean;
  onReply: (s: string) => void;
  onCard: (index: number, patch: Partial<CardState>) => void;
  onFeedback: (v: "up" | "down" | undefined) => void;
  onNavigate: () => void;
  /** 手机工作台：切到「工作台」标签页，而不是跳转 */
  onShowCanvas?: () => void;
}) {
  const writing = !turn.done && !turn.status && !!turn.text.trim();
  const ms = turn.startedAt && turn.endedAt ? turn.endedAt - turn.startedAt : undefined;
  return (
    <div className="ac-rise grid grid-cols-[24px_minmax(0,1fr)] gap-x-2.5">
      <AgentAvatar name={name} size="sm" state={state} appearance={look} reactionKey={turn.id} className="mt-px" />
      <div className="min-w-0 space-y-2.5">
        <p className="flex h-6 items-center text-[13px] font-semibold">{name}</p>
        {turn.status && <WorkLine status={turn.status} since={turn.startedAt} />}
        {turn.done && <WorkSummary name={name} steps={turn.steps ?? []} ms={ms} />}
        {turn.text.trim() && (
          <div className={cn(writing && "ac-caret")}>
            <RichText text={turn.text} />
          </div>
        )}
        {turn.visuals?.map((v, vi) => (
          <VisualView key={vi} v={v} onNavigate={onNavigate} />
        ))}
        {turn.choice && (
          <div>
            <p className="mb-2 text-foreground/90">{turn.choice.question}</p>
            <div className="flex flex-wrap gap-2">
              {turn.choice.options.map((o) => (
                <button
                  key={o.reply}
                  type="button"
                  disabled={!last || busy}
                  onClick={() => onReply(o.reply)}
                  className="rounded-[10px] border border-line bg-card px-3 py-2 text-left shadow-e1 transition-[background-color,transform] enabled:hover:bg-muted enabled:active:scale-[0.98] disabled:opacity-60"
                >
                  <span className="block font-medium">{o.label}</span>
                  {o.detail && <span className="block text-xs text-muted-foreground">{o.detail}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {turn.cards.map((c, ci) => (
          <ActionCardView key={ci} value={c} agentName={name} onChange={(patch) => onCard(ci, patch)} />
        ))}
        {(turn.links.length > 0 || turn.canvas) && (
          <div className="flex flex-wrap gap-2">
            {turn.canvas && onShowCanvas ? (
              <Button size="sm" variant="brand" onClick={onShowCanvas}>
                查看工作台 <ArrowRight />
              </Button>
            ) : (
              turn.canvas && (
                <Button asChild size="sm" variant="brand">
                  <Link href="/dashboard" onClick={onNavigate}>
                    到工作台查看 <ArrowRight />
                  </Link>
                </Button>
              )
            )}
            {turn.links.map((l) => (
              <Button key={l.href} asChild size="sm" variant="outline">
                <Link href={l.href} onClick={onNavigate}>
                  {l.label} <ArrowRight />
                </Link>
              </Button>
            ))}
          </div>
        )}
        {turn.sources?.length ? <SourceList items={turn.sources} /> : null}
        {turn.error && <p className="text-destructive">{turn.error}</p>}
        {turn.done && !turn.error && (turn.text.trim() || turn.visuals?.length) ? (
          <Feedback id={turn.id} value={turn.feedback} text={turn.text} onChange={onFeedback} />
        ) : null}
      </div>
    </div>
  );
}

function UserView({ turn }: { turn: UserTurn }) {
  return (
    <div className="ac-rise ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1.5">
      {turn.snippet && (
        <span
          className="flex max-w-full items-center gap-1.5 rounded-[10px] border border-line bg-card px-2 py-1 text-[12px] text-muted-foreground"
          title={turn.snippet.text}
        >
          <Eye className="size-3.5 shrink-0" />
          <span className="truncate">给 AI 看了：{turn.snippet.label || "页面内容"}</span>
        </span>
      )}
      {turn.media?.length ? (
        <span className="flex flex-wrap justify-end gap-1.5">
          {turn.media.map((m, i) => (
            <span key={i} className="relative size-16 overflow-hidden rounded-[10px] border border-line bg-muted" title={m.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.thumb} alt={m.name} className="size-full object-cover" />
              {m.kind === "video" && (
                <span className="absolute inset-0 grid place-items-center bg-black/20 text-white">
                  <Play className="size-4 fill-current" />
                </span>
              )}
            </span>
          ))}
        </span>
      ) : null}
      <p className="line-clamp-[12] w-fit rounded-[18px] bg-[var(--own-bubble)] px-3.5 py-[7px] whitespace-pre-wrap text-foreground">{turn.text}</p>
    </div>
  );
}

/** 联网查到的网页：站点图标 + 标题 + 域名，点开新标签页 */
function SourceList({ items }: { items: Source[] }) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Globe className="size-3.5" />
        参考了 {items.length} 个网页
      </p>
      <div className="ac-stagger flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {items.map((x) => (
          <a
            key={x.url}
            href={x.url}
            target="_blank"
            rel="noopener noreferrer"
            title={x.snippet || x.title}
            className="ac-lift flex w-52 shrink-0 flex-col gap-1 rounded-[10px] border border-line bg-card px-2.5 py-2 text-left shadow-e1 transition-colors hover:bg-muted"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://icons.duckduckgo.com/ip3/${x.site}.ico`}
                alt=""
                className="size-3.5 shrink-0 rounded-sm"
                loading="lazy"
                onError={(e) => (e.currentTarget.style.visibility = "hidden")}
              />
              <span className="truncate">{x.site}</span>
            </span>
            <span className="line-clamp-2 text-[12.5px] leading-snug font-medium text-foreground">{x.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
