"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUp, LoaderCircle, Square, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CanvasLayout } from "@/lib/canvas";
import type { ActionCard } from "@/lib/ai-actions";
import { ActionCardView, cardSummary, type CardState } from "@/components/dashboard/canvas/action-card";
import { applyLayout, applyWorkspace, canvasOnPage, canvasSnapshot, type WorkspaceEvent } from "./canvas-bridge";
import { AiMascot } from "./ai-mascot";
import { cn } from "@/lib/utils";

type Choice = { question: string; options: { label: string; detail?: string; reply: string }[] };
type AssistantTurn = {
  role: "assistant";
  text: string;
  status: string | null;
  choice: Choice | null;
  links: { label: string; href: string }[];
  error: string | null;
  done: boolean;
  cards: CardState[];
  /** 不在工作台时 AI 摆了组件：给一个「到工作台查看」 */
  canvas?: boolean;
  /** 本步开始时的文字长度，丢弃过渡话时截回这里 */
  mark: number;
};
type Turn = { role: "user"; text: string } | AssistantTurn;

type StreamEvent =
  | { t: "status"; text: string }
  | { t: "text"; text: string }
  | { t: "layout"; layout: CanvasLayout }
  | ({ t: "choice" } & Choice)
  | { t: "link"; label: string; href: string }
  | { t: "error"; message: string }
  | { t: "action"; card: ActionCard }
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
  return ["今天有哪些提醒", "团队本月业绩怎么样", "最近 30 天成交额走势", "把当前布局存成默认情景"];
}

/** 把一轮回复压成给模型看的历史（选项里的 reply 带着 id，下一轮要用） */
function historyOf(turns: Turn[]) {
  return turns.slice(-10).map((t) => {
    if (t.role === "user") return { role: "user" as const, content: t.text };
    const parts = [t.text.trim()];
    if (t.choice) parts.push(`（我问了：${t.choice.question}；选项：${t.choice.options.map((o) => `${o.label} → ${o.reply}`).join("；")}）`);
    for (const c of t.cards) parts.push(cardSummary(c));
    if (t.links.length) parts.push(`（给了跳转按钮：${t.links.map((l) => `${l.label} ${l.href}`).join("，")}）`);
    return { role: "assistant" as const, content: parts.filter(Boolean).join("\n") || "（已调整画布）" };
  });
}

/** 刷新页面后恢复：没跑完的一轮标成结束，执行中的卡片回到待确认 */
function revive(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Turn[])
    .slice(-MAX_TURNS)
    .map((t) =>
      t.role === "assistant"
        ? { ...t, status: null, done: true, cards: (t.cards ?? []).map((c) => (c.state === "running" ? { ...c, state: "pending" } : c)) }
        : t,
    );
}

/** 全局 AI 浮窗：右下角的小角色，点开向左推出对话条；切页面不丢对话 */
export function AiDock({ storageKey }: { storageKey: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState(0);
  const [unread, setUnread] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  const loaded = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // 读回上次的对话（只在浏览器里，避免和服务端渲染不一致）
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { turns?: unknown; open?: boolean } | null;
      if (saved) {
        setTurns(revive(saved.turns));
        if (saved.open && window.location.pathname === "/dashboard") setOpen(true);
      }
    } catch {}
    loaded.current = true;
  }, [storageKey]);
  useEffect(() => {
    if (!loaded.current || busy) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ turns: turns.slice(-MAX_TURNS), open }));
    } catch {}
  }, [turns, open, busy, storageKey]);

  useEffect(() => {
    if (open) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, open]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const toggle = (next = !open) => {
    setOpen(next);
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

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    const history = historyOf(turns);
    const snap = canvasSnapshot();
    const query = sp.toString();
    setInput("");
    setBusy(true);
    setTurns((ts) => [
      ...ts.slice(-(MAX_TURNS - 2)),
      { role: "user", text: message },
      { role: "assistant", text: "", status: "正在思考…", choice: null, links: [], error: null, done: false, mark: 0, cards: [] },
    ]);
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
          onCanvas: canvasOnPage(),
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
          else if (e.t === "status") patchLast(() => ({ status: e.text }));
          else if (e.t === "text") patchLast((t) => ({ text: t.text + e.text, status: null }));
          else if (e.t === "layout") {
            const here = canvasOnPage();
            applyLayout(e.layout);
            if (!here) patchLast(() => ({ canvas: true }));
          } else if (e.t === "choice") patchLast(() => ({ choice: { question: e.question, options: e.options }, status: null }));
          else if (e.t === "action")
            patchLast((t) => ({ cards: [...t.cards, { card: e.card, params: e.card.params, state: "pending" }], status: null }));
          else if (e.t === "workspace") {
            const here = canvasOnPage();
            applyWorkspace(e);
            if (!here) patchLast(() => ({ canvas: true }));
          } else if (e.t === "link") patchLast((t) => ({ links: [...t.links, { label: e.label, href: e.href }] }));
          else if (e.t === "error") patchLast(() => ({ error: e.message, status: null }));
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) patchLast(() => ({ error: e instanceof Error ? e.message : "AI 出错了，请重试" }));
    } finally {
      patchLast(() => ({ status: null, done: true }));
      setBusy(false);
      abortRef.current = null;
      if (!openRef.current) setUnread(true);
    }
  };

  const patchCard = (ti: number, ci: number, patch: Partial<CardState>) =>
    setTurns((ts) =>
      ts.map((t, i) => (i === ti && t.role === "assistant" ? { ...t, cards: t.cards.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : t)),
    );

  const stop = () => {
    abortRef.current?.abort();
    patchLast((t) => ({ text: t.text || "已停止", status: null, done: true }));
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
    window.addEventListener("crm:ai-ask", onAsk);
    return () => window.removeEventListener("crm:ai-ask", onAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 只在工作台首页常驻；其他页面只有「让 AI …」按钮唤起时出现，收起就消失
  const home = pathname === "/dashboard";
  useEffect(() => {
    if (pathname !== "/dashboard") setOpen(false);
  }, [pathname]);

  const suggestions = suggestionsFor(pathname, sp);
  // 有底部输入框的页面（聊天、写信）把角色抬高一点，别挡住发送按钮
  const lifted = pathname.startsWith("/whatsapp") || pathname.startsWith("/mail/compose");
  // 客户详情在手机上底部有「写跟进」操作条
  const liftMobile = /^\/customers\/(?!new)[^/]+$/.test(pathname);

  if (!home && !open) return null;

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
        if (e.key === "Escape" && open) toggle(false);
      }}
    >
      {/* 对话记录：在对话条上方 */}
      {open && (
        <section
          aria-label="AI 助手"
          className="pointer-events-auto flex max-h-[min(34rem,calc(100svh-12rem))] w-full origin-bottom-right animate-in flex-col overflow-hidden rounded-3xl bg-popover shadow-2xl ring-1 ring-black/[0.06] duration-200 fade-in-0 slide-in-from-bottom-2"
        >
          <header className="flex items-center gap-2 border-b px-4 py-2.5">
            <span className="shrink-0 text-base">AI 助手</span>
            <span className="truncate text-xs text-muted-foreground max-sm:hidden">能查数据、摆工作台、起草消息和单据，确认后才执行</span>
            <span className="ml-auto flex items-center gap-0.5">
              {turns.length > 0 && (
                <Button size="icon-xs" variant="ghost" disabled={busy} onClick={() => setTurns([])} aria-label="清空对话" title="清空对话">
                  <Trash2 />
                </Button>
              )}
              <Button size="icon-xs" variant="ghost" onClick={() => toggle(false)} aria-label="收起" title="收起（Esc）">
                <X />
              </Button>
            </span>
          </header>
          {turns.length === 0 ? (
            <div className="space-y-2 px-4 py-3">
              <p className="text-sm text-muted-foreground">可以这样问我：</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border bg-card px-3 py-1 text-xs transition-colors hover:border-foreground/30 hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div ref={logRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" aria-live="polite">
              {turns.map((t, i) =>
                t.role === "user" ? (
                  <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {t.text}
                  </p>
                ) : (
                  <AssistantView
                    key={i}
                    turn={t}
                    last={i === turns.length - 1}
                    busy={busy}
                    onReply={send}
                    onCard={(ci, patch) => patchCard(i, ci, patch)}
                    onNavigate={() => setOpen(false)}
                  />
                ),
              )}
            </div>
          )}
        </section>
      )}

      <div className="flex w-full items-center justify-end gap-2">
        {/* 对话条：从角色左边推出来 */}
        <form
          aria-hidden={!open}
          className={cn(
            "flex h-12 min-w-0 origin-right items-center gap-2 overflow-hidden rounded-full border bg-popover pr-1.5 pl-4 shadow-xl ring-1 ring-black/5 transition-[max-width,opacity,transform] duration-300 ease-out",
            open ? "pointer-events-auto max-w-full flex-1 opacity-100" : "max-w-0 flex-none scale-x-90 border-transparent opacity-0",
          )}
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            ref={inputRef}
            value={input}
            tabIndex={open ? 0 : -1}
            onChange={(e) => setInput(e.target.value)}
            placeholder="说一句话：查数据、摆工作台、起草邮件或报价单…"
            aria-label="对 AI 说"
            maxLength={2000}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {busy ? (
            <Button type="button" size="icon-sm" variant="outline" className="rounded-full" onClick={stop} aria-label="停止" title="停止">
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              className="rounded-full"
              disabled={!input.trim()}
              aria-label="发送"
              title="发送（回车）"
              tabIndex={open ? 0 : -1}
            >
              <ArrowUp />
            </Button>
          )}
        </form>

        <button
          key={push}
          type="button"
          onClick={() => toggle()}
          aria-label={open ? "收起 AI 助手" : "打开 AI 助手"}
          aria-expanded={open}
          title={open ? "收起（⌘J）" : "AI 助手（⌘J）"}
          className={cn(
            "pointer-events-auto relative size-14 shrink-0 rounded-full shadow-xl ring-1 ring-black/5 dark:ring-white/15 transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
            push > 0 && "ai-push",
          )}
        >
          <AiMascot thinking={busy} className="size-full" />
          {busy && !open && <LoaderCircle className="absolute -top-1 -left-1 size-4 animate-spin rounded-full bg-popover text-brand" />}
          {unread && !open && (
            <span className="absolute top-0.5 right-0.5 size-3 rounded-full bg-destructive ring-2 ring-popover" aria-label="有新回复" />
          )}
        </button>
      </div>
    </div>
  );
}

/** 模型偶尔还是会带 Markdown：去掉加粗、标题、表格行 */
const plain = (s: string) =>
  s
    .split("\n")
    .filter((l) => !/^\s*\|/.test(l))
    .map((l) => l.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function AssistantView({
  turn,
  last,
  busy,
  onReply,
  onCard,
  onNavigate,
}: {
  turn: AssistantTurn;
  last: boolean;
  busy: boolean;
  onReply: (s: string) => void;
  onCard: (index: number, patch: Partial<CardState>) => void;
  onNavigate: () => void;
}) {
  return (
    <div className="space-y-2 text-sm">
      {turn.status && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> {turn.status}
        </p>
      )}
      {plain(turn.text) && <p className="leading-relaxed whitespace-pre-line text-foreground/90">{plain(turn.text)}</p>}
      {turn.choice && (
        <div>
          <p className="mb-1.5 text-foreground/90">{turn.choice.question}</p>
          <div className="flex flex-wrap gap-2">
            {turn.choice.options.map((o) => (
              <button
                key={o.reply}
                type="button"
                disabled={!last || busy}
                onClick={() => onReply(o.reply)}
                className="rounded-xl border px-3 py-1.5 text-left transition-colors enabled:hover:border-foreground/30 enabled:hover:bg-muted disabled:opacity-60"
              >
                <span className="block font-medium">{o.label}</span>
                {o.detail && <span className="block text-xs text-muted-foreground">{o.detail}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {turn.cards.map((c, ci) => (
        <ActionCardView key={ci} value={c} onChange={(patch) => onCard(ci, patch)} />
      ))}
      {(turn.links.length > 0 || turn.canvas) && (
        <div className="flex flex-wrap gap-2">
          {turn.canvas && (
            <Button asChild size="xs">
              <Link href="/dashboard" onClick={onNavigate}>
                到工作台查看 <ArrowRight />
              </Link>
            </Button>
          )}
          {turn.links.map((l) => (
            <Button key={l.href} asChild size="xs" variant="outline">
              <Link href={l.href} onClick={onNavigate}>
                {l.label} <ArrowRight />
              </Link>
            </Button>
          ))}
        </div>
      )}
      {turn.error && <p className="text-destructive">{turn.error}</p>}
    </div>
  );
}
