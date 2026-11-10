import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskList, type TaskItem } from "@/components/crm/tasks";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { ownedWhere } from "@/server/scope";
import { cn } from "@/lib/utils";
import { dayRange } from "@/lib/crm";
import { REMINDER_GROUPS } from "@/lib/reminders";
import type { Prisma } from "@/generated/prisma/client";
import { NewTaskButton } from "./new-task-button";

export const metadata: Metadata = { title: "日程与提醒" };

export default async function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  const user = await requirePermission("customer.view");
  const sp = await searchParams;
  const group = REMINDER_GROUPS.find((g) => g.key === sp.g);
  const db = tenantDb(user.tenantId);
  const { start, end } = dayRange(user.timezone);
  const mine: Prisma.TaskWhereInput = { ownerId: user.id, ...(group ? { kind: { in: group.kinds.map((k) => k.key) } } : {}) };
  const include = { customer: { select: { name: true } } };

  const [overdue, today, upcoming, done, customers, openKinds] = await Promise.all([
    db.task.findMany({ where: { ...mine, done: false, dueAt: { lt: start } }, orderBy: { dueAt: "asc" }, include }),
    db.task.findMany({ where: { ...mine, done: false, dueAt: { gte: start, lt: end } }, orderBy: { dueAt: "asc" }, include }),
    db.task.findMany({ where: { ...mine, done: false, dueAt: { gte: end } }, orderBy: { dueAt: "asc" }, take: 50, include }),
    db.task.findMany({ where: { ...mine, done: true }, orderBy: { doneAt: "desc" }, take: 20, include }),
    db.customer.findMany({ where: await ownedWhere(user), orderBy: { updatedAt: "desc" }, select: { id: true, name: true }, take: 500 }),
    db.task.groupBy({ by: ["kind"], where: { ownerId: user.id, done: false }, _count: true }),
  ]);

  const map = (rows: typeof today): TaskItem[] =>
    rows.map((t) => ({
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
    }));

  const sections = [
    { title: "已到期", items: map(overdue), tone: "text-destructive", empty: "没有到期未处理的" },
    { title: "今天", items: map(today), tone: "", empty: "今天没有安排" },
    { title: "接下来", items: map(upcoming), tone: "", empty: "没有待办" },
    { title: "最近完成", items: map(done), tone: "text-muted-foreground", empty: "还没有完成的日程" },
  ];
  const openTotal = openKinds.reduce((n, k) => n + k._count, 0);
  const groupCount = (keys: string[]) => openKinds.filter((k) => k.kind && keys.includes(k.kind)).reduce((n, k) => n + k._count, 0);
  const chips = [
    { key: "", label: "全部", n: openTotal },
    ...REMINDER_GROUPS.map((g) => ({ key: g.key, label: g.label, n: groupCount(g.kinds.map((k) => k.key)) })).filter((c) => c.n > 0 || c.key === group?.key),
  ];

  return (
    <>
      <PageHeader
        title="日程与提醒"
        description="等工厂报价、等船期、催尾款……设个提醒，到点铃铛会响；还在等就一键推迟"
        actions={<NewTaskButton tz={user.timezone} customers={customers} />}
      />
      {chips.length > 1 && (
        <nav aria-label="按场景筛选" className="-mx-3 mb-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:mb-4 md:px-0">
          {chips.map((c) => (
            <Link
              key={c.key}
              href={c.key ? `/schedule?g=${c.key}` : "/schedule"}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors",
                (group?.key ?? "") === c.key ? "bg-primary text-primary-foreground" : "bg-card text-foreground/75 shadow-card hover:text-foreground",
              )}
            >
              {c.label}
              <span className="tabular-nums opacity-70">{c.n}</span>
            </Link>
          ))}
        </nav>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {sections
          .filter((s) => s.title !== "已到期" || s.items.length)
          .map((s) => (
            <Card key={s.title}>
              <CardHeader>
                <CardTitle className={`text-base ${s.tone}`}>
                  {s.title} <span className="text-sm font-normal text-muted-foreground tabular-nums">{s.items.length}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TaskList tasks={s.items} tz={user.timezone} empty={s.empty} />
              </CardContent>
            </Card>
          ))}
      </div>
    </>
  );
}
