"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CornerDownLeft, Plus } from "@/components/icons";
import { TaskList, type TaskItem } from "@/components/crm/tasks";
import { NativeSelect } from "@/components/native-select";
import { runAction } from "@/hooks/use-action-form";
import { TIME_PRESETS, presetLocal, type TimePreset } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { saveTaskAction } from "../schedule/actions";
import { noAutofill } from "@/lib/no-autofill";

const DAY = 86_400_000;
const QUICK: TimePreset[] = ["h1", "eod", "tomorrow", "d2", "mon", "w1", "m1"];

/** 清单视图：顶部一行快速添加，下面按时间分组（像常见的 todo 软件） */
export function PlanList({
  tz,
  todayStart,
  open,
  done,
  chips,
  active,
}: {
  tz: string;
  todayStart: string;
  open: TaskItem[];
  done: TaskItem[];
  chips: { key: string; label: string; n: number }[];
  active: string;
}) {
  const t0 = new Date(todayStart).getTime();
  const at = (t: TaskItem) => new Date(t.dueAt).getTime();
  const sections = [
    { key: "overdue", title: "已到期", tone: "text-destructive", items: open.filter((t) => at(t) < t0) },
    { key: "today", title: "今天", tone: "", items: open.filter((t) => at(t) >= t0 && at(t) < t0 + DAY) },
    { key: "tomorrow", title: "明天", tone: "", items: open.filter((t) => at(t) >= t0 + DAY && at(t) < t0 + 2 * DAY) },
    { key: "week", title: "未来 7 天", tone: "", items: open.filter((t) => at(t) >= t0 + 2 * DAY && at(t) < t0 + 8 * DAY) },
    { key: "later", title: "以后", tone: "", items: open.filter((t) => at(t) >= t0 + 8 * DAY) },
  ].filter((s) => s.items.length || s.key === "today");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 pb-20 md:gap-4">
      <QuickAdd tz={tz} />
      {chips.length > 1 && (
        <nav aria-label="按场景筛选" className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:px-0">
          {chips.map((c) => (
            <Link
              key={c.key}
              href={c.key ? `/todo?view=list&g=${c.key}` : "/todo?view=list"}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-medium transition-colors",
                active === c.key ? "bg-brand-soft text-brand-ink" : "bg-card text-foreground/75 shadow-card hover:text-foreground",
              )}
            >
              {c.label}
              <span className="tabular-nums opacity-70">{c.n}</span>
            </Link>
          ))}
        </nav>
      )}
      {sections.map((s) => (
        <section key={s.key} className="surface px-4 pt-3 pb-1">
          <h2 className={cn("flex items-baseline gap-2 text-sm font-medium", s.tone)}>
            {s.title}
            <span className="text-xs font-normal text-muted-foreground tabular-nums">{s.items.length}</span>
          </h2>
          <TaskList tasks={s.items} tz={tz} empty="今天没有安排，在上面加一条吧" />
        </section>
      ))}
      {done.length > 0 && (
        <details className="surface group px-4 py-3">
          <summary className="cursor-pointer text-sm text-muted-foreground select-none">最近完成 {done.length}</summary>
          <div className="mt-1">
            <TaskList tasks={done} tz={tz} />
          </div>
        </details>
      )}
    </div>
  );
}

function QuickAdd({ tz }: { tz: string }) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState<TimePreset>("tomorrow");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = title.trim();
    if (!v || pending) return;
    start(async () => {
      const fd = new FormData();
      fd.set("title", v);
      fd.set("dueAt", presetLocal(when, tz));
      const r = await runAction(saveTaskAction({ ok: true }, fd));
      if (r.ok) {
        setTitle("");
        input.current?.focus();
      }
    });
  };
  return (
    <form onSubmit={submit} className="surface flex items-center gap-2 py-1.5 pr-1.5 pl-3.5">
      <Plus className="size-4 shrink-0 text-brand-ink" />
      <input
        {...noAutofill}
        ref={input}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="添加待办，回车保存"
        aria-label="待办内容"
        maxLength={200}
        className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground max-md:text-base"
      />
      <NativeSelect
        aria-label="提醒时间"
        value={when}
        onChange={(e) => setWhen(e.target.value as TimePreset)}
        className="h-8 w-auto shrink-0 border-0 bg-muted/70 text-[13px]"
      >
        {QUICK.map((p) => (
          <option key={p} value={p}>
            {TIME_PRESETS.find((x) => x.key === p)!.label}
          </option>
        ))}
      </NativeSelect>
      <button
        type="submit"
        disabled={!title.trim() || pending}
        aria-label="保存"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
      >
        <CornerDownLeft className="size-4" />
      </button>
    </form>
  );
}
