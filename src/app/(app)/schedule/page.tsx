import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskList, type TaskItem } from "@/components/crm/tasks";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { ownedWhere } from "@/server/scope";
import { dayRange } from "@/lib/crm";
import { NewTaskButton } from "./new-task-button";

export const metadata: Metadata = { title: "日程" };

export default async function SchedulePage() {
  const user = await requirePermission("customer.view");
  const db = tenantDb(user.tenantId);
  const { start, end } = dayRange(user.timezone);
  const mine = { ownerId: user.id };
  const include = { customer: { select: { name: true } } };

  const [overdue, today, upcoming, done, customers] = await Promise.all([
    db.task.findMany({ where: { ...mine, done: false, dueAt: { lt: start } }, orderBy: { dueAt: "asc" }, include }),
    db.task.findMany({ where: { ...mine, done: false, dueAt: { gte: start, lt: end } }, orderBy: { dueAt: "asc" }, include }),
    db.task.findMany({ where: { ...mine, done: false, dueAt: { gte: end } }, orderBy: { dueAt: "asc" }, take: 50, include }),
    db.task.findMany({ where: { ...mine, done: true }, orderBy: { doneAt: "desc" }, take: 20, include }),
    db.customer.findMany({ where: await ownedWhere(user), orderBy: { updatedAt: "desc" }, select: { id: true, name: true }, take: 500 }),
  ]);

  const map = (rows: typeof today): TaskItem[] =>
    rows.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt.toISOString(),
      done: t.done,
      customerId: t.customerId,
      customerName: t.customer?.name ?? null,
    }));

  const sections = [
    { title: "已逾期", items: map(overdue), tone: "text-destructive", empty: "没有逾期的日程" },
    { title: "今天", items: map(today), tone: "", empty: "今天没有安排" },
    { title: "接下来", items: map(upcoming), tone: "", empty: "没有待办" },
    { title: "最近完成", items: map(done), tone: "text-muted-foreground", empty: "还没有完成的日程" },
  ];

  return (
    <>
      <PageHeader
        title="日程"
        description="写跟进时设置「下次跟进」会自动生成日程"
        actions={<NewTaskButton tz={user.timezone} customers={customers} />}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {sections
          .filter((s) => s.title !== "已逾期" || s.items.length)
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
