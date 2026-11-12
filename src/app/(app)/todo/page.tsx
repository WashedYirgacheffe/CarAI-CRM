import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Inbox, ListChecks, type LucideIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import type { TaskItem } from "@/components/crm/tasks";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { ownedWhere } from "@/server/scope";
import { getTodo } from "@/server/todo";
import { dayRange, parseLocalInput, toLocalInput } from "@/lib/crm";
import { REMINDER_GROUPS } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";
import { NewTaskButton } from "../schedule/new-task-button";
import { TodoInbox, type TodoItem } from "./todo-inbox";
import { PlanList } from "./plan-list";
import { CalendarView } from "./calendar-view";

export const metadata: Metadata = { title: "待办" };

type View = "inbox" | "list" | "calendar";
const VIEWS: { key: View; label: string; icon: LucideIcon }[] = [
  { key: "inbox", label: "今日处理", icon: Inbox },
  { key: "list", label: "清单", icon: ListChecks },
  { key: "calendar", label: "日历", icon: CalendarDays },
];

const include = { customer: { select: { name: true } } } as const;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof include }>;
const toItem = (t: TaskRow): TaskItem => ({
  id: t.id,
  title: t.title,
  dueAt: t.dueAt.toISOString(),
  done: t.done,
  customerId: t.customerId,
  customerName: t.customer?.name ?? null,
  kind: t.kind,
  note: t.note,
  link: t.link,
  snoozeCount: t.snoozeCount,
});

export default async function TodoPage({ searchParams }: PageProps<"/todo">) {
  const user = await requireUser();
  const sp = await searchParams;
  const view: View = sp.view === "list" || sp.view === "calendar" ? sp.view : "inbox";
  const customers = can(user, "customer.view")
    ? await tenantDb(user.tenantId).customer.findMany({
        where: await ownedWhere(user),
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true },
        take: 500,
      })
    : [];

  return (
    <>
      <PageHeader
        title="待办"
        description="今天要处理的提醒、邮件和 WhatsApp，以及接下来的全部计划"
        actions={<NewTaskButton tz={user.timezone} customers={customers} />}
      />
      <nav aria-label="视图" className="mb-3 inline-flex rounded-full bg-muted/70 p-1 md:mb-4">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "inbox" ? "/todo" : `/todo?view=${v.key}`}
            aria-current={view === v.key ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors",
              view === v.key ? "bg-card text-foreground shadow-card" : "text-foreground/65 hover:text-foreground",
            )}
          >
            <v.icon className="size-4" />
            {v.label}
          </Link>
        ))}
      </nav>
      {view === "inbox" ? (
        <InboxView user={user} />
      ) : view === "list" ? (
        <ListView user={user} group={typeof sp.g === "string" ? sp.g : ""} />
      ) : (
        <CalendarSection user={user} month={typeof sp.m === "string" ? sp.m : ""} customers={customers} />
      )}
    </>
  );
}

async function InboxView({ user }: { user: CurrentUser }) {
  const { tasks, mail, wa, now } = await getTodo(user);
  const items: TodoItem[] = [
    ...tasks.map(
      (t): TodoItem => ({
        kind: "task",
        id: t.id,
        title: t.title,
        detail: [t.customer?.name, t.note].filter(Boolean).join(" · "),
        at: t.dueAt.toISOString(),
        href: t.link ?? (t.customerId ? `/customers/${t.customerId}` : null),
        tag: t.kind,
        overdue: t.dueAt.getTime() < now,
      }),
    ),
    ...mail.map(
      (m): TodoItem => ({
        kind: "mail",
        id: m.id,
        title: m.subject || "(无主题)",
        who: m.customer?.name ?? m.fromName ?? m.fromAddr,
        detail: m.aiSummary || m.snippet,
        at: m.date.toISOString(),
        href: `/mail?id=${m.id}`,
        reply: `/mail/compose?reply=${m.id}`,
        tag: m.aiIntent,
        high: m.aiPriority === "high",
        unread: !m.seen,
      }),
    ),
    ...wa.map(
      (c): TodoItem => ({
        kind: "wa",
        id: c.id,
        title: c.customer?.name ?? c.name ?? c.phone ?? "WhatsApp 会话",
        who: c.customer && c.name && c.name !== c.customer.name ? c.name : undefined,
        detail: c.lastText ?? "",
        at: (c.lastMessageAt ?? new Date()).toISOString(),
        href: `/whatsapp?chat=${c.id}`,
        reply: `/whatsapp?chat=${c.id}`,
        count: c.unread,
        unread: true,
      }),
    ),
  ];
  return <TodoInbox items={items} tz={user.timezone} />;
}

/** 清单：按时间分组（已到期 / 今天 / 明天 / 7 天内 / 以后 / 最近完成） */
async function ListView({ user, group: g }: { user: CurrentUser; group: string }) {
  const db = tenantDb(user.tenantId);
  const group = REMINDER_GROUPS.find((x) => x.key === g);
  const mine: Prisma.TaskWhereInput = { ownerId: user.id, ...(group ? { kind: { in: group.kinds.map((k) => k.key) } } : {}) };
  const [open, done, openKinds] = await Promise.all([
    db.task.findMany({ where: { ...mine, done: false }, orderBy: { dueAt: "asc" }, take: 300, include }),
    db.task.findMany({ where: { ...mine, done: true }, orderBy: { doneAt: "desc" }, take: 20, include }),
    db.task.groupBy({ by: ["kind"], where: { ownerId: user.id, done: false }, _count: true }),
  ]);
  const openTotal = openKinds.reduce((n, k) => n + k._count, 0);
  const groupCount = (keys: string[]) => openKinds.filter((k) => k.kind && keys.includes(k.kind)).reduce((n, k) => n + k._count, 0);
  const chips = [
    { key: "", label: "全部", n: openTotal },
    ...REMINDER_GROUPS.map((x) => ({ key: x.key, label: x.label, n: groupCount(x.kinds.map((k) => k.key)) })).filter(
      (c) => c.n > 0 || c.key === group?.key,
    ),
  ];
  const { start } = dayRange(user.timezone);
  return (
    <PlanList
      tz={user.timezone}
      todayStart={start.toISOString()}
      open={open.map(toItem)}
      done={done.map(toItem)}
      chips={chips}
      active={group?.key ?? ""}
    />
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

async function CalendarSection({ user, month, customers }: { user: CurrentUser; month: string; customers: { id: string; name: string }[] }) {
  const tz = user.timezone;
  const today = toLocalInput(new Date(), tz, false);
  const ym = /^\d{4}-\d{2}$/.test(month) ? month : today.slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  // 6 周的网格，周一开头
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const gridStart = new Date(first.getTime() - lead * 86_400_000);
  const key = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const days = Array.from({ length: 42 }, (_, i) => key(new Date(gridStart.getTime() + i * 86_400_000)));
  const from = parseLocalInput(`${days[0]}T00:00`, tz)!;
  const to = new Date(parseLocalInput(`${days[41]}T00:00`, tz)!.getTime() + 86_400_000);
  const rows = await tenantDb(user.tenantId).task.findMany({
    where: { ownerId: user.id, dueAt: { gte: from, lt: to } },
    orderBy: { dueAt: "asc" },
    take: 600,
    include,
  });
  const shift = (d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
  };
  return (
    <CalendarView
      key={ym}
      tz={tz}
      month={ym}
      prev={shift(-1)}
      next={shift(1)}
      today={today}
      days={days}
      tasks={rows.map((t) => ({ ...toItem(t), day: toLocalInput(t.dueAt, tz, false), time: toLocalInput(t.dueAt, tz).slice(11, 16) }))}
      customers={customers}
    />
  );
}
