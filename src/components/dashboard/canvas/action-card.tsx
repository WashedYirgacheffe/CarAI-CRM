"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CircleAlert, LoaderCircle, Send } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { runAiActionAction } from "@/app/(app)/dashboard/ai-actions";
import type { ActionCard, ActionResult } from "@/lib/ai-actions";
import { cn } from "@/lib/utils";

export type CardState = {
  card: ActionCard;
  params: Record<string, string>;
  state: "pending" | "running" | "done" | "failed" | "cancelled";
  result?: ActionResult;
};

/** 一张卡片在历史里的说法：让 AI 下一轮知道用户确认了没有 */
export const cardSummary = (c: CardState) =>
  `（起草了「${c.card.title}」：${
    c.state === "done"
      ? `用户已确认，${c.result?.message}`
      : c.state === "failed"
        ? `执行失败：${c.result?.message}`
        : c.state === "cancelled"
          ? "用户取消了"
          : "用户还没确认"
  }）`;

/** AI 起草的操作：先给用户看、可以改，确认后才执行 */
export function ActionCardView({
  value,
  onChange,
  agentName = "AI 助手",
}: {
  value: CardState;
  onChange: (patch: Partial<CardState>) => void;
  agentName?: string;
}) {
  const { card, params, state, result } = value;
  const [confirmOutward, setConfirmOutward] = useState(false);
  const locked = state !== "pending" && state !== "failed";

  const run = async () => {
    onChange({ state: "running" });
    try {
      const r = await runAiActionAction(card.kind, params);
      onChange({ state: r.ok ? "done" : "failed", result: r });
      if (r.ok) window.dispatchEvent(new Event("crm:widgets-refresh"));
    } catch {
      onChange({ state: "failed", result: { ok: false, message: "执行失败，请重试" } });
    }
  };

  const chip =
    state === "done"
      ? { label: "已执行", cls: "bg-ok/12 text-ok" }
      : state === "cancelled"
        ? { label: "已取消", cls: "bg-muted text-muted-foreground" }
        : state === "failed"
          ? { label: "没成功", cls: "bg-destructive/10 text-destructive" }
          : state === "running"
            ? { label: "执行中", cls: "bg-brand-soft text-brand-ink" }
            : card.outward
              ? { label: "等你确认 · 会发给对方", cls: "bg-warn-soft text-warn" }
              : { label: "等你确认", cls: "bg-brand-soft text-brand-ink" };

  return (
    <div
      data-state={state}
      className={cn(
        "relative max-w-[40rem] overflow-hidden rounded-[10px] rounded-bl-[2px] border border-line bg-card p-4 shadow-e1",
        state === "cancelled" && "opacity-60",
      )}
    >
      {/* 顶部一条淡淡的天色：等你拍板的事和普通消息区分开 */}
      {(state === "pending" || state === "running") && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--agent)_9%,transparent),transparent)]"
        />
      )}
      <div className="relative mb-2.5 flex items-center gap-2">
        <span className="text-[13px] text-muted-foreground">
          <b className="font-semibold text-foreground">{agentName}</b> {state === "done" ? "已经做好" : "想要"}
        </span>
        <span className={cn("ml-auto shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-medium", chip.cls)}>{chip.label}</span>
      </div>
      <h4 className="relative mb-2.5 text-[15px] leading-snug font-semibold tracking-[-0.005em]">{card.title}</h4>

      {card.fields.length > 0 && (
        <dl className="relative mb-3 grid grid-cols-[minmax(4rem,auto)_1fr] gap-x-3 gap-y-1 text-sm">
          {card.fields.map((f, i) => (
            <div key={i} className="contents">
              <dt className="truncate text-muted-foreground">{f.label}</dt>
              <dd className="min-w-0 break-words tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.edit?.map((e) => (
        <label key={e.key} className="mb-2 block">
          <span className="mb-1 block text-xs text-muted-foreground">{e.label}</span>
          {e.multiline ? (
            <Textarea
              value={params[e.key] ?? ""}
              disabled={locked}
              onChange={(ev) => onChange({ params: { ...params, [e.key]: ev.target.value } })}
              rows={Math.min(10, Math.max(3, (params[e.key] ?? "").split("\n").length + 1))}
              className="text-sm"
            />
          ) : (
            <Input value={params[e.key] ?? ""} disabled={locked} onChange={(ev) => onChange({ params: { ...params, [e.key]: ev.target.value } })} />
          )}
        </label>
      ))}

      {result && (
        <p className={cn("mb-2 flex items-start gap-1.5 text-sm", result.ok ? "text-ok" : "text-destructive")}>
          {result.ok ? <Check className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
          {result.message}
        </p>
      )}

      <div className="relative flex flex-wrap items-center gap-2">
        {state === "done" ? (
          result?.href && (
            <Button asChild size="xs" variant="outline">
              <Link href={result.href}>
                {result.hrefLabel ?? "打开"} <ArrowRight />
              </Link>
            </Button>
          )
        ) : state === "cancelled" ? null : card.outward && !confirmOutward ? (
          <Button size="sm" disabled={state === "running"} onClick={() => setConfirmOutward(true)}>
            <Send /> {card.confirm}
          </Button>
        ) : (
          <>
            {card.outward && <span className="text-xs text-warn">确认后会立即发给对方，无法撤回</span>}
            <Button size="sm" disabled={state === "running"} onClick={run}>
              {state === "running" ? <LoaderCircle /> : <Check />}
              {card.outward ? `确认${card.confirm}` : card.confirm}
            </Button>
          </>
        )}
        {(state === "pending" || state === "failed") && (
          <Button size="sm" variant="ghost" onClick={() => onChange({ state: "cancelled" })}>
            取消
          </Button>
        )}
        {card.alt && state !== "done" && state !== "cancelled" && (
          <Button asChild size="xs" variant="ghost" className="ml-auto">
            <Link href={card.alt.href}>
              {card.alt.label} <ArrowRight />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
