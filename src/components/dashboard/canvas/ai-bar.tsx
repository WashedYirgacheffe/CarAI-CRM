"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUp, LoaderCircle, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CanvasLayout } from "@/lib/canvas";
import type { ActionCard } from "@/lib/ai-actions";
import { ActionCardView, cardSummary, type CardState } from "./action-card";
import { cn } from "@/lib/utils";

type Choice = { question: string; options: { label: string; detail?: string; reply: string }[] };
type Turn =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      status: string | null;
      choice: Choice | null;
      links: { label: string; href: string }[];
      error: string | null;
      done: boolean;
      cards: CardState[];
      /** 本步开始时的文字长度，丢弃过渡话时截回这里 */
      mark: number;
    };

type Event =
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

export type WorkspaceEvent =
  | { t: "workspace"; op: "open"; id: string; layout: CanvasLayout }
  | { t: "workspace"; op: "saved"; id: string; name: string; layout: CanvasLayout; home: boolean };

const SUGGESTIONS = ["团队本月业绩怎么样", "今天有哪些提醒", "最近 30 天成交额走势", "把当前布局存成默认情景"];

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

/** 工作台顶部的 AI 栏：说一句话，AI 查数据、摆组件、给结论 */
export function AiBar({
  enabled,
  layout,
  active,
  onLayout,
  onWorkspace,
}: {
  enabled: boolean;
  layout: CanvasLayout;
  active: string;
  onLayout: (l: CanvasLayout) => void;
  /** 返回切换后的画布 */
  onWorkspace: (e: WorkspaceEvent) => CanvasLayout;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (fn: (t: Extract<Turn, { role: "assistant" }>) => Partial<Extract<Turn, { role: "assistant" }>>) =>
    setTurns((ts) => {
      const last = ts[ts.length - 1];
      if (!last || last.role !== "assistant") return ts;
      return [...ts.slice(0, -1), { ...last, ...fn(last) }];
    });

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    const history = historyOf(turns);
    setInput("");
    setBusy(true);
    setTurns((ts) => [
      ...ts.slice(-19),
      { role: "user", text: message },
      { role: "assistant", text: "", status: "正在思考…", choice: null, links: [], error: null, done: false, mark: 0, cards: [] },
    ]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/ai/canvas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history, layout: layoutRef.current, active }),
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
          const e = JSON.parse(line) as Event;
          if (e.t === "step") patchLast((t) => ({ mark: t.text.length }));
          else if (e.t === "drop") patchLast((t) => ({ text: t.text.slice(0, t.mark) }));
          else if (e.t === "status") patchLast(() => ({ status: e.text }));
          else if (e.t === "text") patchLast((t) => ({ text: t.text + e.text, status: null }));
          else if (e.t === "layout") {
            layoutRef.current = e.layout;
            onLayout(e.layout);
          } else if (e.t === "choice") patchLast(() => ({ choice: { question: e.question, options: e.options }, status: null }));
          else if (e.t === "action")
            patchLast((t) => ({ cards: [...t.cards, { card: e.card, params: e.card.params, state: "pending" }], status: null }));
          else if (e.t === "workspace") layoutRef.current = onWorkspace(e);
          else if (e.t === "link") patchLast((t) => ({ links: [...t.links, { label: e.label, href: e.href }] }));
          else if (e.t === "error") patchLast(() => ({ error: e.message, status: null }));
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) patchLast(() => ({ error: e instanceof Error ? e.message : "AI 出错了，请重试" }));
    } finally {
      patchLast(() => ({ status: null, done: true }));
      setBusy(false);
      abortRef.current = null;
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

  if (!enabled)
    return (
      <div className="surface mb-4 flex items-center gap-3 px-4 py-3">
        <Badge />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">AI 助手未开通：需要管理员配置 AI 并授予「使用 AI」权限</span>
      </div>
    );

  return (
    <section className="surface mb-4 overflow-hidden p-0" aria-label="AI 助手">
      <form
        className="flex items-center gap-3 px-4 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <Badge />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="告诉 AI 你想看什么、做什么，例如「团队本月业绩」「和 Cindy 聊聊」"
          aria-label="对 AI 说"
          maxLength={2000}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {busy ? (
          <Button type="button" size="icon-sm" variant="outline" onClick={stop} aria-label="停止" title="停止">
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon-sm" disabled={!input.trim()} aria-label="发送" title="发送（回车）">
            <ArrowUp />
          </Button>
        )}
      </form>

      {turns.length === 0 ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3 pl-15">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void send(s)}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      ) : (
        <div className="relative border-t">
          <button
            type="button"
            onClick={() => !busy && setTurns([])}
            disabled={busy}
            className="absolute top-2 right-3 z-10 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <X className="size-3" /> 清空对话
          </button>
          <div ref={logRef} className="max-h-[28rem] space-y-3 overflow-y-auto px-4 py-3 pr-24" aria-live="polite">
            {turns.map((t, i) =>
              t.role === "user" ? (
                <p key={i} className="text-sm font-medium">
                  {t.text}
                </p>
              ) : (
                <AssistantTurn
                  key={i}
                  turn={t}
                  last={i === turns.length - 1}
                  busy={busy}
                  onReply={send}
                  onCard={(ci, patch) => patchCard(i, ci, patch)}
                />
              ),
            )}
          </div>
        </div>
      )}
    </section>
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

function Badge() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-600">
      <Sparkles className="size-4" />
    </span>
  );
}

function AssistantTurn({
  turn,
  last,
  busy,
  onReply,
  onCard,
}: {
  turn: Extract<Turn, { role: "assistant" }>;
  last: boolean;
  busy: boolean;
  onReply: (s: string) => void;
  onCard: (index: number, patch: Partial<CardState>) => void;
}) {
  return (
    <div className="space-y-2 border-l-2 border-violet-500/30 pl-3 text-sm">
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
                className={cn(
                  "rounded-xl border px-3 py-1.5 text-left transition-colors enabled:hover:border-primary enabled:hover:bg-primary/5 disabled:opacity-60",
                )}
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
      {turn.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {turn.links.map((l) => (
            <Button key={l.href} asChild size="xs" variant="outline">
              <Link href={l.href}>
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
