"use client";

import { useState } from "react";
import Link from "next/link";
import { BellPlus, Check, ChevronDown, Clock, ExternalLink, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { STATUS_COLORS, formatDateTime } from "@/lib/crm";
import { CONTEXT_KINDS, REMINDER_GROUPS, REMINDER_KINDS, SNOOZE_PRESETS, TIME_PRESETS, presetLocal, type TimePreset } from "@/lib/reminders";
import { deleteTaskAction, saveTaskAction, snoozeTaskAction, toggleTaskAction } from "@/app/(app)/schedule/actions";
import { EmptyState } from "@/components/crm/empty-state";
import { confettiFrom } from "@/components/agentes/sky";
import { ActionSheet, SwipeRow } from "@/components/crm/swipe-row";

export type TaskItem = {
  id: string;
  title: string;
  dueAt: string;
  done: boolean;
  customerId: string | null;
  customerName: string | null;
  ownerName?: string | null;
  kind?: string | null;
  note?: string | null;
  link?: string | null;
  snoozeCount?: number;
};

export type ReminderContext = keyof typeof CONTEXT_KINDS;

/**
 * 新建提醒 / 日程。先点场景（等工厂报价、催尾款…）自动带出内容和提醒时间，
 * 再点快捷时间微调，两下就能设好。
 */
export function TaskForm({
  customerId,
  customers,
  tz,
  onDone,
  context = "customer",
  link,
  subject,
  defaultKind,
  defaultDue,
}: {
  customerId?: string | null;
  customers?: { id: string; name: string }[];
  tz: string;
  onDone: () => void;
  /** 打开的页面，决定优先展示哪些场景 */
  context?: ReminderContext;
  /** 来源页面，提醒里可一键跳回 */
  link?: string;
  /** 关联的单据 / 邮件主题，附在提醒内容后面 */
  subject?: string;
  defaultKind?: string;
  /** 默认时间（YYYY-MM-DDTHH:mm），日历上点某天新建时用 */
  defaultDue?: string;
}) {
  const [state, submit, pending] = useActionForm(saveTaskAction, onDone);
  const initial = defaultKind ? REMINDER_KINDS[defaultKind] : undefined;
  const withSubject = (t: string) => (subject ? `${t} · ${subject}` : t);
  const [kind, setKind] = useState(initial?.key ?? "");
  const [title, setTitle] = useState(initial ? withSubject(initial.title) : "");
  const [when, setWhen] = useState<TimePreset | "">(defaultDue ? "" : (initial?.when ?? "tomorrow"));
  const [due, setDue] = useState(() => defaultDue ?? presetLocal(initial?.when ?? "tomorrow", tz));
  const [showAll, setShowAll] = useState(false);
  const suggested = CONTEXT_KINDS[context] ?? CONTEXT_KINDS.customer;
  const k = kind ? REMINDER_KINDS[kind] : undefined;

  function pick(key: string) {
    if (key === kind) {
      setKind("");
      return;
    }
    const next = REMINDER_KINDS[key];
    // 内容没改过（空或是上一个场景的默认内容）才替换
    if (!title.trim() || (k && title === withSubject(k.title))) setTitle(withSubject(next.title));
    setKind(key);
    setWhen(next.when);
    setDue(presetLocal(next.when, tz));
  }

  const chip = (key: string, label: string) => {
    const on = kind === key;
    const color = REMINDER_KINDS[key]?.color ?? "slate";
    return (
      <button
        key={key}
        type="button"
        onClick={() => pick(key)}
        aria-pressed={on}
        className={cn(
          "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
          on ? STATUS_COLORS[color] : "border-border/80 text-foreground/80 hover:bg-muted",
          on && "ring-2 ring-current/20",
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>设置跟进提醒</DialogTitle>
        <DialogDescription>选一个场景，内容和时间自动填好；到点后右上角铃铛会提醒你</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="kind" value={kind} />
      {link && <input type="hidden" name="link" value={link} />}
      <FieldGroup className="gap-4 py-4">
        <FormMessage state={state} />
        <div>
          <p className="mb-2 text-sm font-medium">场景</p>
          <div className="flex flex-wrap gap-1.5">
            {suggested.map((key) => chip(key, REMINDER_KINDS[key].label))}
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={showAll}
            >
              更多场景 <ChevronDown className={cn("size-3.5 transition-transform", showAll && "rotate-180")} />
            </button>
          </div>
          {showAll && (
            <div className="mt-2 max-h-60 space-y-2 overflow-y-auto rounded-xl bg-muted/50 p-3">
              {REMINDER_GROUPS.map((g) => (
                <div key={g.key} className="flex gap-2">
                  <span className="w-16 shrink-0 pt-1 text-xs text-muted-foreground">{g.label}</span>
                  <div className="flex flex-wrap gap-1.5">{g.kinds.map((x) => chip(x.key, x.label))}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <Field>
          <FieldLabel htmlFor="t-title">提醒内容</FieldLabel>
          <Input
            id="t-title"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如：工厂报价回来后发给客户"
            required
          />
          <FieldErrors state={state} name="title" />
        </Field>
        <Field>
          <FieldLabel htmlFor="t-note">备注（可选）</FieldLabel>
          <Textarea id="t-note" name="note" rows={2} placeholder={k?.hint ?? "在等谁、等什么，回来后要做什么"} />
        </Field>
        <Field>
          <FieldLabel htmlFor="t-due">什么时候提醒</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {TIME_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={when === p.key}
                onClick={() => {
                  setWhen(p.key);
                  setDue(presetLocal(p.key, tz));
                }}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs transition-colors",
                  when === p.key ? "bg-primary font-medium text-primary-foreground" : "bg-muted text-foreground/80 hover:bg-muted/70",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Input
            id="t-due"
            name="dueAt"
            type="datetime-local"
            value={due}
            onChange={(e) => {
              setDue(e.target.value);
              setWhen("");
            }}
            required
            className="mt-1 w-auto"
          />
          <FieldErrors state={state} name="dueAt" />
        </Field>
        {customerId ? (
          <input type="hidden" name="customerId" value={customerId} />
        ) : (
          customers && (
            <Field>
              <FieldLabel htmlFor="t-customer">关联客户（可选）</FieldLabel>
              <NativeSelect id="t-customer" name="customerId" defaultValue="">
                <option value="">不关联</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : "设置提醒"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** 各页面上的「设提醒」按钮 */
export function QuickReminder({
  tz,
  customerId,
  context,
  link,
  subject,
  label = "设提醒",
  variant = "outline",
  size = "sm",
  className,
}: {
  tz: string;
  customerId?: string | null;
  context?: ReminderContext;
  link?: string;
  subject?: string;
  label?: string;
  variant?: "outline" | "ghost" | "default" | "secondary";
  size?: "sm" | "xs" | "icon-sm";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)} aria-label={label} title="设置跟进提醒">
        <BellPlus />
        {size !== "icon-sm" && label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {open && <TaskForm tz={tz} customerId={customerId} context={context} link={link} subject={subject} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function KindTag({ kind, className }: { kind?: string | null; className?: string }) {
  const k = kind ? REMINDER_KINDS[kind] : undefined;
  if (!k) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-1.5 py-px text-[11px] leading-4 font-medium whitespace-nowrap",
        STATUS_COLORS[k.color],
        className,
      )}
    >
      {k.label}
    </span>
  );
}

export function SnoozeMenu({ id, className }: { id: string; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={className} aria-label="推迟提醒" title="还在等？推迟提醒">
          <Clock />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs">还在等？推迟到</DropdownMenuLabel>
        {SNOOZE_PRESETS.map((p) => (
          <DropdownMenuItem key={p} onSelect={() => runAction(snoozeTaskAction(id, p))}>
            {TIME_PRESETS.find((x) => x.key === p)!.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskList({
  tasks,
  tz,
  showCustomer = true,
  empty = "没有日程",
}: {
  tasks: TaskItem[];
  tz: string;
  showCustomer?: boolean;
  empty?: string;
}) {
  const [now] = useState(() => Date.now());
  if (!tasks.length) return <EmptyState compact>{empty}</EmptyState>;
  return (
    <ul className="divide-y">
      {tasks.map((t) => (
        <TaskRow key={t.id} t={t} tz={tz} now={now} showCustomer={showCustomer} />
      ))}
    </ul>
  );
}

function TaskRow({ t, tz, now, showCustomer }: { t: TaskItem; tz: string; now: number; showCustomer: boolean }) {
  const [sheet, setSheet] = useState(false);
  const overdue = !t.done && new Date(t.dueAt).getTime() < now;
  return (
    <li>
      {/* 手机：右滑完成，左滑推迟 / 删除 */}
      <SwipeRow
        contentClassName="bg-card"
        left={[
          {
            label: t.done ? "未完成" : "完成",
            icon: Check,
            tone: "emerald",
            onAction: () => void runAction(toggleTaskAction(t.id, !t.done)),
          },
        ]}
        right={[
          { label: "删除", icon: Trash2, tone: "destructive", onAction: () => void runAction(deleteTaskAction(t.id)) },
          { label: "推迟", icon: Clock, tone: "amber", hidden: t.done, onAction: () => setSheet(true) },
        ]}
      >
        <div className="group flex items-start gap-3 py-2.5">
          <Checkbox
            className="mt-0.5"
            checked={t.done}
            aria-label={t.done ? "标记为未完成" : "标记为完成"}
            onClick={(e) => {
              // 做完一件事：撒一把像素彩纸
              if (!t.done) confettiFrom(e.currentTarget);
            }}
            onCheckedChange={(v) => runAction(toggleTaskAction(t.id, !!v))}
          />
          <div className="min-w-0 flex-1">
            <p className={cn("flex min-w-0 items-center gap-1.5 text-sm", t.done && "text-muted-foreground line-through")}>
              {!t.done && <KindTag kind={t.kind} />}
              <span className="truncate">{t.title}</span>
            </p>
            {t.note && <p className="mt-0.5 line-clamp-2 text-xs text-foreground/70">{t.note}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className={cn("tabular-nums", overdue && "font-medium text-destructive")}>
                {formatDateTime(t.dueAt, tz)}
                {overdue && " 已到期"}
              </span>
              {!!t.snoozeCount && ` · 推迟过 ${t.snoozeCount} 次`}
              {showCustomer && t.customerId && (
                <>
                  {" · "}
                  <Link href={`/customers/${t.customerId}`} className="hover:text-primary hover:underline">
                    {t.customerName}
                  </Link>
                </>
              )}
              {t.ownerName && ` · ${t.ownerName}`}
              {t.link && (
                <>
                  {" · "}
                  <Link href={t.link} className="inline-flex items-center gap-0.5 hover:text-primary hover:underline">
                    查看来源 <ExternalLink className="size-3" />
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center max-md:hidden">
            {!t.done && <SnoozeMenu id={t.id} className={cn(!overdue && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")} />}
            <Button
              variant="ghost"
              size="icon-sm"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label="删除日程"
              onClick={() => runAction(deleteTaskAction(t.id))}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </SwipeRow>
      <ActionSheet
        open={sheet}
        onOpenChange={setSheet}
        title="还在等？推迟到"
        items={SNOOZE_PRESETS.map((p) => ({
          label: TIME_PRESETS.find((x) => x.key === p)!.label,
          icon: Clock,
          onSelect: () => void runAction(snoozeTaskAction(t.id, p)),
        }))}
      />
    </li>
  );
}
