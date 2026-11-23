"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, FileText, Square } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { WorkLine, WorkSummary } from "@/components/ai/agent-bits";
import { RichText } from "@/components/ai/ai-visual";
import { AiMascot } from "@/components/ai/ai-look";
import { noAutofill } from "@/lib/no-autofill";
import { DOC_TYPES, TEMPLATES, isFieldKey, type DocData, type DocPatch, type DocType } from "@/lib/trade-docs/schema";
import type { DocCard, DocEvent } from "@/server/doc-ai";
import { cn } from "@/lib/utils";
import { FieldInput } from "./doc-form";

export const AI_NAME = "车车AI";

export type ChatCard = DocCard & { done?: boolean; values?: Record<string, string> };
export type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  card?: ChatCard;
  steps?: string[];
  ms?: number;
  error?: string;
};

/** 发给模型的历史：卡片折成一句话，思考过程不带 */
function historyOf(msgs: ChatMsg[]) {
  return msgs
    .map((m) => {
      let text = m.text.trim();
      if (m.card) {
        const asked = m.card.fields.map((f) => f.label).join("、");
        text += `${text ? "\n" : ""}[已发填写卡片「${m.card.title}」：${asked}]`;
      }
      if (m.error && !text) text = `[出错：${m.error}]`;
      return { role: m.role, text };
    })
    .filter((m) => m.text);
}

const typeByLabel = (v: string): DocType | null => {
  const s = v.trim().toLowerCase();
  return (
    DOC_TYPES.find((t) => t === s || TEMPLATES[t].name === v.trim() || TEMPLATES[t].short.toLowerCase() === s || TEMPLATES[t].en.toLowerCase() === s) ?? null
  );
};

// ── 填写卡片 ──

function CardView({ card, live, onSubmit }: { card: ChatCard; live: boolean; onSubmit: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(card.fields.map((f) => [f.key, card.values?.[f.key] ?? f.value ?? ""])),
  );
  const done = !!card.done;
  const missing = card.fields.filter((f) => f.required && !values[f.key]?.trim());
  return (
    <div className="ac-rise max-w-[34rem] rounded-2xl border border-line bg-card p-3.5 shadow-e1">
      <div className="mb-2.5 flex items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-brand" />
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">{card.title}</p>
          {card.note && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{card.note}</p>}
        </div>
        {done && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[12px] text-ok">
            <Check className="size-3.5" /> 已提交
          </span>
        )}
      </div>
      <fieldset disabled={done || !live} className="space-y-3 disabled:opacity-80">
        {card.fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <label htmlFor={`card-${f.key}`} className="flex items-center gap-1 text-[12px] text-muted-foreground">
              {f.label}
              {f.required && <span className="text-amber-600">*</span>}
            </label>
            <FieldInput
              id={`card-${f.key}`}
              meta={{ label: f.label, kind: f.key === "doc_type" ? "select" : f.kind, options: f.key === "doc_type" && !f.options ? DOC_TYPES.map((t) => TEMPLATES[t].name) : f.options, placeholder: f.placeholder }}
              value={values[f.key] ?? ""}
              onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
            />
          </div>
        ))}
      </fieldset>
      {!done && live && (
        <div className="mt-3 flex items-center gap-2">
          <Button type="button" size="sm" variant="brand" disabled={missing.length > 0} onClick={() => onSubmit(values)}>
            填好了，继续
          </Button>
          {missing.length > 0 && <span className="text-[12px] text-muted-foreground">还有 {missing.length} 项必填</span>}
          <button type="button" className="ml-auto text-[12px] text-muted-foreground hover:text-foreground" onClick={() => onSubmit({})}>
            先跳过
          </button>
        </div>
      )}
    </div>
  );
}

// ── 一条消息 ──

function Thinking({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? live;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && shown && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text, live, shown]);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!shown)}
        aria-expanded={shown}
        className="-ml-2 inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {live ? <span className="ai-shimmer">正在深度思考</span> : "思考过程"}
        <ChevronDown className={cn("size-3.5 transition-transform", shown && "rotate-180")} />
      </button>
      {shown && (
        <div
          ref={box}
          className="mt-1 max-h-48 overflow-y-auto border-l-2 border-line2 pl-3 text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
        >
          {text}
        </div>
      )}
    </div>
  );
}

function Message({
  m,
  live,
  status,
  since,
  canCard,
  onCard,
}: {
  m: ChatMsg;
  live: boolean;
  status: string;
  since?: number;
  canCard: boolean;
  onCard: (values: Record<string, string>) => void;
}) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[18px] bg-[var(--own-bubble)] px-3.5 py-[7px] text-[14px] leading-6 break-words whitespace-pre-wrap">
          {m.text.length > 1200 ? `${m.text.slice(0, 1200)}…（共 ${m.text.length} 字）` : m.text}
        </p>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <AiMascot size="xs" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2 text-[14px] leading-6">
        {m.thinking && <Thinking text={m.thinking} live={live && !m.text && !m.card} />}
        {m.text && <RichText text={m.text} />}
        {m.error && <p className="text-[13px] text-destructive">{m.error}</p>}
        {m.card && <CardView card={m.card} live={canCard} onSubmit={onCard} />}
        {live && <WorkLine status={status || "正在思考"} since={since} />}
        {!live && !!m.steps?.length && <WorkSummary name={AI_NAME} steps={m.steps} ms={m.ms} />}
      </div>
    </div>
  );
}

// ── 对话面板 ──

const SUGGESTIONS: { label: string; text: string; send?: boolean }[] = [
  { label: "按订单出一套单据", text: "帮我按最近一张订单做形式发票，再告诉我还能接着出哪些单据", send: true },
  { label: "贴信用证出全套议付单据", text: "下面是信用证原文，请按 L/C 要求帮我做全套议付单据：\n\n" },
  { label: "做装箱单", text: "我要做一份装箱单", send: true },
  { label: "做订舱托书", text: "帮我做一份订舱托书（Booking Note）", send: true },
  { label: "做受益人证明", text: "帮我按信用证 46A 做受益人证明", send: true },
];

export function DocChat({
  type,
  data,
  messages,
  setMessages,
  enabled,
  onPatch,
  onType,
  onTurnEnd,
}: {
  type: DocType | null;
  data: DocData;
  messages: ChatMsg[];
  setMessages: (f: (m: ChatMsg[]) => ChatMsg[]) => void;
  enabled: boolean;
  onPatch: (p: DocPatch) => void;
  onType: (t: DocType) => void;
  onTurnEnd: () => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [since, setSince] = useState<number>();
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const latest = useRef({ type, data, messages });
  useLayoutEffect(() => {
    latest.current = { type, data, messages };
  });

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);
  useEffect(() => () => abort.current?.abort(), []);

  const update = (f: (m: ChatMsg) => ChatMsg) =>
    setMessages((ms) => {
      const last = ms.at(-1);
      return last?.role === "assistant" ? [...ms.slice(0, -1), f(last)] : ms;
    });

  async function send(raw: string, opts?: { type?: DocType | null; data?: DocData }) {
    const message = raw.trim();
    if (!message || busy || !enabled) return;
    const history = historyOf(latest.current.messages);
    const started = Date.now();
    stick.current = true;
    setInput("");
    setBusy(true);
    setStatus("正在思考");
    setSince(started);
    setMessages((ms) => [...ms, { role: "user", text: message }, { role: "assistant", text: "", steps: [] }]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await fetch("/api/ai/doc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: opts?.type !== undefined ? opts.type : latest.current.type,
          data: opts?.data ?? latest.current.data,
          message,
          history,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => "")) || `请求失败（${res.status}）`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const handle = (e: DocEvent) => {
        switch (e.t) {
          case "thinking":
            update((m) => ({ ...m, thinking: (m.thinking ?? "") + e.text }));
            break;
          case "text":
            setStatus("正在回复");
            update((m) => ({ ...m, text: m.text + e.text }));
            break;
          case "status":
            setStatus(e.text);
            update((m) => ({ ...m, steps: [...(m.steps ?? []), e.text] }));
            break;
          case "type":
            onType(e.type);
            break;
          case "patch":
            onPatch(e.patch);
            break;
          case "card":
            update((m) => ({ ...m, card: e.card }));
            break;
          case "error":
            update((m) => ({ ...m, error: e.message }));
            break;
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            handle(JSON.parse(line) as DocEvent);
          } catch {
            /* 半行或坏行跳过 */
          }
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted) update((m) => ({ ...m, error: (err as Error).message || "网络出错了，请重试" }));
      else update((m) => ({ ...m, text: m.text || "（已停止）" }));
    } finally {
      abort.current = null;
      setBusy(false);
      setStatus("");
      update((m) => ({ ...m, text: m.text.trim(), ms: Date.now() - started }));
      // 工作台在这一轮的状态落地后再保存
      onTurnEnd();
    }
  }

  /** 卡片提交：能对上字段的直接写进单据，再把填了什么告诉 AI 让它接着做 */
  function submitCard(idx: number, values: Record<string, string>) {
    const card = messages[idx]?.card;
    if (!card) return;
    setMessages((ms) => ms.map((m, j) => (j === idx && m.card ? { ...m, card: { ...m.card, done: true, values } } : m)));
    const set: Record<string, string> = {};
    const lines: string[] = [];
    let nextType: DocType | null | undefined;
    for (const f of card.fields) {
      const v = (values[f.key] ?? "").trim();
      if (!v) continue;
      if (f.key === "doc_type") {
        const t = typeByLabel(v);
        if (t) {
          nextType = t;
          onType(t);
        }
      } else if (isFieldKey(f.key)) set[f.key] = f.kind === "date" ? v : v.toUpperCase();
      lines.push(`- ${f.label}：${v}`);
    }
    let nextData = latest.current.data;
    if (Object.keys(set).length) {
      const patch = { set };
      onPatch(patch);
      nextData = { ...nextData, ...set };
    }
    const msg = lines.length ? `我填好了：\n${lines.join("\n")}` : "这些先跳过，按现有信息继续，用默认值的地方标出来。";
    void send(msg, { type: nextType ?? latest.current.type, data: nextData });
  }

  const empty = messages.length === 0;
  const lastCardIdx = messages.findLastIndex((m) => !!m.card);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {empty ? (
          <div className="ac-rise pt-4">
            <div className="flex items-center gap-2.5">
              <AiMascot size="sm" />
              <p className="text-[15px] font-medium">我是{AI_NAME}，告诉我要做什么单据</p>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              说订单号、客户名，或者直接贴信用证、客户邮件、装箱数据。我会从 CRM 里查能查到的，缺的发卡片让你点选补全，版式照公司样本排好，右边随时可改。
            </p>
            <div className="mt-4 flex flex-col items-start gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  disabled={!enabled}
                  onClick={() => {
                    if (s.send) void send(s.text);
                    else {
                      setInput(s.text);
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }
                  }}
                  className="rounded-full border border-line2 bg-card px-3 py-1 text-[13px] text-foreground/80 transition-colors hover:border-foreground/25 hover:text-foreground disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <Message
              key={i}
              m={m}
              live={busy && i === messages.length - 1}
              status={status}
              since={since}
              canCard={!busy && i === lastCardIdx}
              onCard={(v) => submitCard(i, v)}
            />
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="shrink-0 border-t border-line px-3 pt-2.5 pb-3"
      >
        {!enabled && <p className="mb-2 text-[12px] text-muted-foreground">AI 还没开通或没有使用权限，可以先用「填表」做单据。</p>}
        <div className="flex items-end gap-2 rounded-2xl border border-line2 bg-card px-3 py-1.5 shadow-e1 focus-within:border-foreground/25">
          <textarea
            {...noAutofill}
            ref={inputRef}
            value={input}
            rows={1}
            disabled={!enabled}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={type ? `跟${AI_NAME}说要改什么，或贴资料进来…` : "要做什么单据？可以直接贴信用证或订单资料"}
            aria-label={`对${AI_NAME}说`}
            className="field-sizing-content max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-6 outline-none placeholder:text-muted-foreground max-md:text-base"
          />
          {busy ? (
            <Button type="button" size="icon-sm" variant="outline" onClick={() => abort.current?.abort()} aria-label="停止" title="停止">
              <Square className="size-4 [&_rect]:fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon-sm" variant="brand" disabled={!input.trim() || !enabled} aria-label="发送" title="发送（Enter）">
              <ArrowUp />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
