import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { getTodo } from "@/server/todo";
import { TodoInbox, type TodoItem } from "./todo-inbox";

export const metadata: Metadata = { title: "待办" };

export default async function TodoPage() {
  const user = await requireUser();
  const { tasks, mail, wa, now } = await getTodo(user);

  const items: TodoItem[] = [
    ...tasks.map((t): TodoItem => ({
      kind: "task",
      id: t.id,
      title: t.title,
      detail: [t.customer?.name, t.note].filter(Boolean).join(" · "),
      at: t.dueAt.toISOString(),
      href: t.link ?? (t.customerId ? `/customers/${t.customerId}` : null),
      tag: t.kind,
      overdue: t.dueAt.getTime() < now,
    })),
    ...mail.map((m): TodoItem => ({
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
    })),
    ...wa.map((c): TodoItem => ({
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
    })),
  ];

  return (
    <>
      <PageHeader title="待办" description="到期的提醒、还没回的重要邮件和 WhatsApp，都在这里一次处理完" />
      <TodoInbox items={items} tz={user.timezone} />
    </>
  );
}
