"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, Check, Clock, Mail, MessageCircle, Reply, type LucideIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KindTag } from "@/components/crm/tasks";
import { runAction } from "@/hooks/use-action-form";
import { snoozeTaskAction, toggleTaskAction } from "@/app/(app)/schedule/actions";
import { setMailDoneAction } from "@/app/(app)/mail/actions";
import { markChatReadAction } from "@/app/(app)/whatsapp/actions";
import { snoozeTodoAction } from "./actions";
import { ActionSheet, SwipeRow } from "@/components/crm/swipe-row";
import { MAIL_INTENT_LABELS } from "@/lib/mail";
import { SNOOZE_PRESETS, TIME_PRESETS, type TimePreset } from "@/lib/reminders";
import { formatDateTime } from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/action";

export type TodoItem = {
  kind: "task" | "mail" | "wa";
  id: string;
  title: string;
  /** 邮件发件人 / 会话里的联系人 */
  who?: string;
  detail: string;
  at: string;
  href: string | null;
  /** 回复入口（邮件写信页 / 聊天窗口） */
  reply?: string;
  /** 提醒场景 / 邮件意图 */
  tag?: string | null;
  high?: boolean;
  unread?: boolean;
  overdue?: boolean;
  count?: number;
};

const KINDS: { key: TodoItem["kind"]; label: string; icon: LucideIcon; tone: string }[] = [
  { key: "task", label: "提醒", icon: AlarmClock, tone: "bg-brand-soft text-brand-ink" },
  { key: "mail", label: "邮件", icon: Mail, tone: "bg-muted text-foreground/80" },
  { key: "wa", label: "WhatsApp", icon: MessageCircle, tone: "bg-emerald-100 text-emerald-700" },
];

/** 先急后缓：到期的提醒 → 高优先邮件 → WhatsApp → 其余；同一档里提醒按到期时间，消息按新到旧 */
const rank = (i: TodoItem) => (i.overdue ? 0 : i.high ? 1 : i.kind === "wa" ? 2 : 3);

function ago(iso: string, now: number) {
  const m = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

export function TodoInbox({ items, tz }: { items: TodoItem[]; tz: string }) {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const [filter, setFilter] = useState<TodoItem["kind"] | "">("");
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [, startTransition] = useTransition();

  const live = items.filter((i) => !gone.has(`${i.kind}:${i.id}`));
  const shown = live
    .filter((i) => !filter || i.kind === filter)
    .sort(
      (a, b) => rank(a) - rank(b) || (a.kind === "task" && b.kind === "task" ? +new Date(a.at) - +new Date(b.at) : +new Date(b.at) - +new Date(a.at)),
    );

  // 先从列表里拿掉，失败了再放回来
  const act = async (i: TodoItem, p: () => Promise<ActionState>) => {
    const key = `${i.kind}:${i.id}`;
    setGone((s) => new Set(s).add(key));
    const r = await runAction(p());
    if (!r.ok)
      setGone((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    startTransition(() => router.refresh());
  };
  const done = (i: TodoItem) =>
    act(i, () =>
      i.kind === "task"
        ? toggleTaskAction(i.id, true)
        : i.kind === "mail"
          ? setMailDoneAction(i.id, true)
          : markChatReadAction(i.id).then((r) => (r.ok ? { ...r, message: "已标为已读" } : r)),
    );
  const snooze = (i: TodoItem, p: TimePreset) => act(i, () => (i.kind === "task" ? snoozeTaskAction(i.id, p) : snoozeTodoAction(i.kind, i.id, p)));

  const chips = [
    { key: "" as const, label: "全部", n: live.length },
    ...KINDS.map((k) => ({ key: k.key, label: k.label, n: live.filter((i) => i.kind === k.key).length })),
  ];

  return (
    <>
      <nav aria-label="按类型筛选" className="-mx-3 mb-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:mb-4 md:px-0">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            aria-pressed={filter === c.key}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors",
              filter === c.key ? "bg-brand-soft text-brand-ink" : "bg-card text-foreground/75 shadow-card hover:text-foreground",
            )}
          >
            {c.label}
            <span className="tabular-nums opacity-70">{c.n}</span>
          </button>
        ))}
      </nav>

      {shown.length === 0 ? (
        <div className="surface flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-full border border-dashed border-foreground/25 text-foreground/70">
            <Check className="size-6" />
          </span>
          <p className="font-medium">都处理完了</p>
          <p className="text-sm text-muted-foreground">新的提醒、重要邮件和 WhatsApp 消息到了会出现在这里</p>
        </div>
      ) : (
        <ul className="surface mb-20 divide-y overflow-hidden">
          {shown.map((i) => (
            <Row key={`${i.kind}:${i.id}`} item={i} now={now} tz={tz} onDone={() => done(i)} onSnooze={(p) => snooze(i, p)} />
          ))}
        </ul>
      )}
    </>
  );
}

function Row({
  item: i,
  now,
  tz,
  onDone,
  onSnooze,
}: {
  item: TodoItem;
  now: number;
  tz: string;
  onDone: () => void;
  onSnooze: (p: TimePreset) => void;
}) {
  const k = KINDS.find((x) => x.key === i.kind)!;
  const intent = i.kind === "mail" && i.tag ? MAIL_INTENT_LABELS[i.tag] : undefined;
  const doneLabel = i.kind === "task" ? "完成" : i.kind === "mail" ? "不用回，已处理" : "标为已读";
  const [sheet, setSheet] = useState(false);
  return (
    <li>
      <SwipeRow
        contentClassName="bg-card"
        left={[{ label: i.kind === "task" ? "完成" : i.kind === "mail" ? "已处理" : "已读", icon: Check, tone: "emerald", onAction: onDone }]}
        right={[{ label: "延后", icon: Clock, tone: "amber", onAction: () => setSheet(true) }]}
      >
        <div className="group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30 max-md:active:bg-muted/50">
          <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", k.tone)} aria-label={k.label}>
            <k.icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 flex-wrap items-center gap-1.5">
              {i.high && <span className="rounded-full bg-brand px-1.5 py-px text-[11px] leading-4 text-brand-foreground">高优先</span>}
              {i.kind === "task" && <KindTag kind={i.tag} />}
              {intent && <span className={cn("rounded-full border px-1.5 py-px text-[11px] leading-4 font-medium", intent.cls)}>{intent.label}</span>}
              {i.href ? (
                <Link
                  href={i.href}
                  className={cn("min-w-0 truncate text-sm hover:text-primary max-md:after:absolute max-md:after:inset-0", i.unread && "font-medium")}
                >
                  {i.title}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-sm">{i.title}</span>
              )}
              {!!i.count && (
                <span className="rounded-full bg-destructive px-1.5 text-[11px] leading-4 font-medium text-white tabular-nums">{i.count}</span>
              )}
            </p>
            {(i.who || i.detail) && (
              <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">
                {i.who && <span className="text-foreground/80">{i.who}：</span>}
                {i.detail}
              </p>
            )}
            <p className={cn("mt-1 text-xs text-muted-foreground tabular-nums", i.overdue && "font-medium text-destructive")}>
              {i.kind === "task" ? `${formatDateTime(i.at, tz)}${i.overdue ? " 已到期" : ""}` : ago(i.at, now)}
            </p>
          </div>
          <div className="relative z-10 flex shrink-0 items-center gap-1">
            {i.reply ? (
              <Button asChild size="sm" className="rounded-full">
                <Link href={i.reply}>
                  <Reply /> <span className="max-sm:hidden">回复</span>
                </Link>
              </Button>
            ) : (
              i.href && (
                <Button asChild size="sm" variant="outline" className="rounded-full">
                  <Link href={i.href}>打开</Link>
                </Button>
              )
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* 手机上左滑「延后」 */}
                <Button variant="ghost" size="icon-sm" aria-label="延后" title="延后，到点再提醒我" className="max-md:hidden">
                  <Clock />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">延后到</DropdownMenuLabel>
                {SNOOZE_PRESETS.map((p) => (
                  <DropdownMenuItem key={p} onSelect={() => onSnooze(p)}>
                    {TIME_PRESETS.find((x) => x.key === p)!.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDone}
              aria-label={doneLabel}
              title={doneLabel}
              className="hover:bg-primary hover:text-primary-foreground"
            >
              <Check />
            </Button>
          </div>
        </div>
      </SwipeRow>
      <ActionSheet
        open={sheet}
        onOpenChange={setSheet}
        title="延后到"
        items={SNOOZE_PRESETS.map((p) => ({ label: TIME_PRESETS.find((x) => x.key === p)!.label, icon: Clock, onSelect: () => onSnooze(p) }))}
      />
    </li>
  );
}
