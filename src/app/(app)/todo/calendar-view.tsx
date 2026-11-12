"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "@/components/icons";
import { TaskForm, TaskList, type TaskItem } from "@/components/crm/tasks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { STATUS_COLORS } from "@/lib/crm";
import { REMINDER_KINDS } from "@/lib/reminders";
import { cn } from "@/lib/utils";

type CalTask = TaskItem & { day: string; time: string };

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];
const DOT: Record<string, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
};
const colorOf = (t: TaskItem) => (t.kind && REMINDER_KINDS[t.kind]?.color) || "slate";

/** 月历视图：每天显示前几条安排，点某天在右侧（手机在下方）看详情、直接在这天新建 */
export function CalendarView({
  tz,
  month,
  prev,
  next,
  today,
  days,
  tasks,
  customers,
}: {
  tz: string;
  month: string;
  prev: string;
  next: string;
  today: string;
  days: string[];
  tasks: CalTask[];
  customers: { id: string; name: string }[];
}) {
  const [picked, setPicked] = useState(() => (today.startsWith(month) ? today : `${month}-01`));
  const [adding, setAdding] = useState(false);
  const byDay = new Map<string, CalTask[]>();
  for (const t of tasks) byDay.set(t.day, [...(byDay.get(t.day) ?? []), t]);
  const [y, m] = month.split("-").map(Number);
  const dayTasks = byDay.get(picked) ?? [];
  const [, pm, pd] = picked.split("-").map(Number);
  const weekday = WEEK[(new Date(Date.UTC(Number(picked.slice(0, 4)), pm - 1, pd)).getUTCDay() + 6) % 7];

  return (
    <div className="flex flex-col gap-3 pb-20 md:gap-4 lg:flex-row lg:items-start">
      <section className="surface min-w-0 flex-1 p-2 md:p-3">
        <header className="flex items-center gap-1 px-1 pb-2">
          <h2 className="mr-auto text-base font-semibold tabular-nums">
            {y} 年 {m} 月
          </h2>
          {!today.startsWith(month) && (
            <Link href="/todo?view=calendar" className="mr-1 rounded-[10px] px-3 py-1 text-[13px] text-brand-ink hover:bg-brand-soft">
              今天
            </Link>
          )}
          <Link
            href={`/todo?view=calendar&m=${prev}`}
            aria-label="上个月"
            className="flex size-8 items-center justify-center rounded-full hover:bg-muted"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <Link
            href={`/todo?view=calendar&m=${next}`}
            aria-label="下个月"
            className="flex size-8 items-center justify-center rounded-full hover:bg-muted"
          >
            <ChevronRight className="size-4" />
          </Link>
        </header>
        <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
          {WEEK.map((w) => (
            <div key={w} className="pb-1.5">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl bg-border/60">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const inMonth = d.startsWith(month);
            const isToday = d === today;
            const sel = d === picked;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setPicked(d)}
                onDoubleClick={() => {
                  setPicked(d);
                  setAdding(true);
                }}
                aria-label={`${d}，${list.length} 项安排`}
                aria-pressed={sel}
                className={cn(
                  "flex min-h-14 flex-col items-stretch gap-0.5 p-1 text-left transition-colors md:min-h-24 md:p-1.5",
                  inMonth ? "bg-card" : "bg-muted/40",
                  sel ? "bg-brand-soft/60" : "hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center self-center rounded-full text-xs tabular-nums md:self-start",
                    !inMonth && "text-muted-foreground/60",
                    isToday && "bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {Number(d.slice(8))}
                </span>
                {/* 手机：彩色小圆点 */}
                <span className="flex flex-wrap justify-center gap-0.5 md:hidden">
                  {list.slice(0, 4).map((t) => (
                    <span key={t.id} className={cn("size-1.5 rounded-full", t.done ? "bg-muted-foreground/30" : DOT[colorOf(t)])} />
                  ))}
                </span>
                {/* 电脑：前三条安排 */}
                <span className="hidden flex-col gap-0.5 md:flex">
                  {list.slice(0, 3).map((t) => (
                    <span
                      key={t.id}
                      className={cn(
                        "truncate rounded-md border px-1.5 py-px text-[11px] leading-4",
                        t.done ? "border-transparent bg-muted text-muted-foreground line-through" : STATUS_COLORS[colorOf(t)],
                      )}
                    >
                      <span className="tabular-nums opacity-70">{t.time}</span> {t.title}
                    </span>
                  ))}
                  {list.length > 3 && <span className="px-1 text-[11px] text-muted-foreground">还有 {list.length - 3} 项</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="surface flex flex-col px-4 pt-3 pb-1 lg:sticky lg:top-20 lg:w-80 lg:shrink-0">
        <header className="flex items-center gap-2">
          <h2 className="mr-auto text-sm font-medium">
            {pm} 月 {pd} 日 周{weekday}
            {picked === today && <span className="ml-1.5 text-xs font-normal text-brand-ink">今天</span>}
          </h2>
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus /> 在这天新建
          </Button>
        </header>
        <TaskList tasks={dayTasks} tz={tz} empty="这天没有安排" />
      </aside>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-lg">
          {adding && <TaskForm key={picked} tz={tz} customers={customers} defaultDue={`${picked}T09:00`} onDone={() => setAdding(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
