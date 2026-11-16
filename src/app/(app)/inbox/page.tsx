import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/crm/empty-state";
import { SocialIcon } from "@/components/crm/social-icon";
import { MessagesSquare, Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { can, requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { canUseInbox, revealer, threadScope } from "@/server/inbox";
import { waListTime } from "@/lib/wa-time";
import { INBOX_PLATFORMS } from "@/lib/inbox";
import { matrixPlatform } from "@/lib/matrix";
import { noAutofill } from "@/lib/no-autofill";
import { cn } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";
import { InboxLive, InboxSelect, ThreadView, type ThreadData } from "./thread-view";
import { QuickRepliesButton } from "./quick-replies";

export const metadata: Metadata = { title: "收件箱" };

type Row = {
  kind: "social" | "wa";
  id: string;
  href: string;
  name: string;
  platform: string;
  account: string;
  at: Date | null;
  lastText: string | null;
  lastFromMe: boolean;
  unread: number;
  customer: string | null;
  assignee: string | null;
};

const FLAGS = [
  { key: "", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "unlinked", label: "未关联" },
  { key: "archived", label: "已归档" },
] as const;

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const user = await requireUser();
  const social = canUseInbox(user);
  const wa = can(user, "whatsapp.use");
  if (!social) redirect(wa ? "/whatsapp" : "/forbidden");
  const manage = can(user, "matrix.manage");
  const reveal = revealer(user);

  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const ch = s("ch");
  const acc = s("acc");
  const who = s("who");
  const f = s("f");
  const q = s("q").trim();
  const tid = s("t");

  const href = (p: Partial<Record<"ch" | "acc" | "who" | "f" | "q" | "t", string | null>>) => {
    const u = new URLSearchParams();
    const cur = { ch, acc, who, f, q, t: tid };
    for (const k of ["ch", "acc", "who", "f", "q", "t"] as const) {
      const v = k in p ? p[k] : k === "t" ? null : cur[k];
      if (v) u.set(k, v);
    }
    return `/inbox${u.size ? `?${u}` : ""}`;
  };

  const contains = { contains: q, mode: "insensitive" as const };
  const where: Prisma.SocialThreadWhereInput = {
    ...threadScope(user),
    lastMessageAt: { not: null },
    archived: f === "archived",
    ...(ch && ch !== "whatsapp" ? { platform: ch } : {}),
    ...(acc ? { accountId: acc } : {}),
    ...(manage && who ? { assigneeId: who === "-" ? null : who } : {}),
    ...(f === "unread" ? { unread: { gt: 0 } } : f === "unlinked" ? { customerId: null } : {}),
    ...(q ? { OR: [{ peerName: contains }, { peerHandle: contains }, { lastText: contains }, { customer: { name: contains } }] } : {}),
  };
  const waAccount = wa && (!ch || ch === "whatsapp") && !acc && !(manage && who) ? await prisma.waAccount.findUnique({ where: { userId: user.id } }) : null;

  const [threads, chats, accounts, members, syncing] = await Promise.all([
    ch === "whatsapp"
      ? []
      : prisma.socialThread.findMany({
          where,
          orderBy: { lastMessageAt: "desc" },
          take: 200,
          include: { account: { select: { name: true } }, customer: { select: { name: true } }, assignee: { select: { name: true } } },
        }),
    waAccount
      ? prisma.waChat.findMany({
          where: {
            accountId: waAccount.id,
            lastMessageAt: { not: null },
            archived: f === "archived",
            ...(f === "unread" ? { unread: { gt: 0 } } : f === "unlinked" ? { customerId: null } : {}),
            ...(q ? { OR: [{ name: contains }, { phone: { contains: q.replace(/\D/g, "") || q } }, { customer: { name: contains } }] } : {}),
          },
          orderBy: { lastMessageAt: "desc" },
          take: 200,
          include: { customer: { select: { name: true } } },
        })
      : [],
    prisma.matrixAccount.findMany({
      where: { tenantId: user.tenantId, platform: { in: [...INBOX_PLATFORMS] }, ...(manage ? {} : { ownerId: user.id }) },
      orderBy: [{ platform: "asc" }, { name: "asc" }],
      select: { id: true, name: true, platform: true, inboxSync: true },
    }),
    prisma.user.findMany({ where: { tenantId: user.tenantId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.matrixJob.count({ where: { tenantId: user.tenantId, kind: "inbox", status: { in: ["queued", "running"] } } }),
  ]);

  const rows: Row[] = [
    ...threads.map((t) => ({
      kind: "social" as const,
      id: t.id,
      href: href({ t: t.id }),
      name: t.peerName || reveal.handle(t.peerHandle) || "未知用户",
      platform: t.platform,
      account: t.account.name,
      at: t.lastMessageAt,
      lastText: t.lastText ? reveal.text(t.lastText) : null,
      lastFromMe: t.lastFromMe,
      unread: t.unread,
      customer: t.customer?.name ?? null,
      assignee: manage ? (t.assignee?.name ?? "未分配") : null,
    })),
    ...chats.map((c) => ({
      kind: "wa" as const,
      id: c.id,
      href: `/whatsapp?chat=${c.id}`,
      name: c.name || (c.phone ? `+${c.phone}` : "未知号码"),
      platform: "whatsapp",
      account: "我的 WhatsApp",
      at: c.lastMessageAt,
      lastText: c.lastText,
      lastFromMe: c.lastFromMe,
      unread: c.unread,
      customer: c.customer?.name ?? null,
      assignee: null,
    })),
  ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  // 当前打开的会话
  let view: ThreadData | null = null;
  if (tid) {
    const t = await prisma.socialThread.findFirst({
      where: { id: tid, ...threadScope(user) },
      include: {
        account: { select: { id: true, name: true, platform: true, status: true, inboxSync: true, inboxAt: true } },
        customer: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
    });
    if (t) {
      const [msgs, replies, tenant] = await Promise.all([
        prisma.socialMessage.findMany({ where: { threadId: t.id }, orderBy: { timestamp: "desc" }, take: 200 }),
        prisma.quickReply.findMany({
          where: { tenantId: user.tenantId, OR: [{ ownerId: null }, { ownerId: user.id }] },
          orderBy: [{ group: "asc" }, { sort: "asc" }, { title: "asc" }],
          select: { id: true, group: true, title: true, body: true, ownerId: true },
        }),
        prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } }),
      ]);
      view = {
        id: t.id,
        platform: t.platform,
        peerName: t.peerName || reveal.handle(t.peerHandle) || "未知用户",
        peerHandle: reveal.handle(t.peerHandle),
        peerUrl: reveal.url(t.peerUrl),
        peerLang: t.peerLang,
        archived: t.archived,
        unread: t.unread,
        leadId: t.leadId,
        customer: t.customer,
        assignee: t.assignee,
        account: {
          name: t.account.name,
          status: t.account.status,
          inboxSync: t.account.inboxSync,
          syncedAt: t.account.inboxAt?.toISOString() ?? null,
        },
        messages: msgs.reverse().map((m) => ({
          id: m.id,
          fromMe: m.fromMe,
          type: m.type,
          body: reveal.text(m.body),
          translation: m.translation ? reveal.text(m.translation) : null,
          status: m.status,
          error: m.error,
          at: m.timestamp.toISOString(),
        })),
        quickReplies: replies.map((r) => ({ id: r.id, group: r.group, title: r.title, body: r.body, shared: !r.ownerId })),
        vars: { customer: t.customer?.name ?? null, contact: t.peerName, me: user.name, company: tenant?.name ?? null },
      };
    }
  }

  const syncOn = accounts.filter((a) => a.inboxSync).length;
  const channels = [
    { key: "", label: "全部" },
    ...(wa ? [{ key: "whatsapp", label: "WhatsApp" }] : []),
    ...INBOX_PLATFORMS.filter((p) => accounts.some((a) => a.platform === p)).map((p) => ({ key: p, label: matrixPlatform(p)?.label ?? p })),
  ];

  return (
    <div
      className={cn(
        "-mx-3 -mt-3 -mb-4 flex h-[calc(100svh-6.75rem-1px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[26rem] overflow-hidden surface rounded-none shadow-none md:m-0 md:h-[calc(100svh-6.5rem)] md:min-h-[34rem] md:rounded-2xl md:shadow-[var(--card-shadow)]",
        view && "max-md:![transform:none] max-md:!overflow-visible",
      )}
    >
      <InboxLive thread={view?.id} />

      {/* ── 会话列表 ── */}
      <section className={cn("flex w-full min-w-0 flex-col border-r border-border/70 md:w-[23rem] md:shrink-0", view && "hidden md:flex")}>
        <header className="flex items-center gap-2 px-4 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">收件箱</p>
            <p className="truncate text-xs text-muted-foreground">
              {syncOn ? `${syncOn} 个社媒账号在收私信${syncing ? " · 同步中" : ""}` : "还没有账号开启收私信"}
            </p>
          </div>
          <QuickRepliesButton manage={manage} />
        </header>

        <div className="space-y-2 px-4 pb-3">
          <form action="/inbox" className="relative">
            {ch && <input type="hidden" name="ch" value={ch} />}
            {f && <input type="hidden" name="f" value={f} />}
            {acc && <input type="hidden" name="acc" value={acc} />}
            {who && <input type="hidden" name="who" value={who} />}
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              {...noAutofill}
              name="q"
              defaultValue={q}
              placeholder="搜索名字、消息、客户"
              className="h-9 w-full rounded-full bg-muted/70 pr-3 pl-9 text-sm outline-none ring-1 ring-transparent transition placeholder:text-muted-foreground focus:bg-card focus:ring-primary/40"
            />
          </form>
          <nav className="flex gap-1.5 overflow-x-auto pb-0.5" aria-label="渠道">
            {channels.map((x) => (
              <Link
                key={x.key}
                href={href({ ch: x.key, acc: null })}
                aria-current={ch === x.key ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors",
                  ch === x.key ? "bg-primary text-primary-foreground" : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {x.key && <SocialIcon platform={x.key} className="size-3.5" />}
                {x.label}
              </Link>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-1.5">
            {FLAGS.map((x) => (
              <Link
                key={x.key}
                href={href({ f: x.key })}
                aria-current={f === x.key ? "page" : undefined}
                className={cn(
                  "inline-flex h-6 items-center rounded-full px-2.5 text-xs transition-colors",
                  f === x.key ? "bg-foreground/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {x.label}
              </Link>
            ))}
            <span className="flex-1" />
            {accounts.length > 1 && (
              <InboxSelect
                param="acc"
                value={acc}
                label="账号"
                options={[
                  { value: "", label: "全部账号" },
                  ...accounts.filter((a) => !ch || a.platform === ch).map((a) => ({ value: a.id, label: `${matrixPlatform(a.platform)?.label ?? a.platform} · ${a.name}` })),
                ]}
              />
            )}
            {manage && members.length > 1 && (
              <InboxSelect
                param="who"
                value={who}
                label="负责人"
                options={[{ value: "", label: "全部负责人" }, ...members.map((m) => ({ value: m.id, label: m.name })), { value: "-", label: "未分配" }]}
              />
            )}
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto pb-2 md:px-2">
          {rows.length === 0 && (
            <li>
              <EmptyState icon={MessagesSquare} className="px-6 py-16">
                {q || f || ch || acc || who ? (
                  "没有符合条件的会话"
                ) : syncOn ? (
                  "还没有私信，同步到的新消息会出现在这里"
                ) : (
                  <span className="flex flex-col items-center gap-3">
                    在社媒矩阵里给已登录的账号开启「收私信」，私信每 10 分钟同步进来。
                    <Button asChild size="sm" variant="outline">
                      <Link href="/social/matrix">去社媒矩阵</Link>
                    </Button>
                  </span>
                )}
              </EmptyState>
            </li>
          )}
          {rows.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <Link
                href={r.href}
                aria-current={r.kind === "social" && r.id === view?.id ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60 md:rounded-xl md:px-2.5",
                  r.kind === "social" && r.id === view?.id && "bg-muted",
                )}
              >
                <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                  {r.name.slice(0, 1).toUpperCase()}
                  <SocialIcon platform={r.platform} className="absolute -right-0.5 -bottom-0.5 size-4.5 rounded-full bg-card p-0.5 ring-1 ring-border" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn("min-w-0 flex-1 truncate text-sm", r.unread ? "font-semibold" : "font-medium")}>{r.name}</span>
                    <span className={cn("shrink-0 text-[11px] tabular-nums", r.unread ? "text-primary" : "text-muted-foreground")}>
                      {r.at ? waListTime(r.at, user.timezone) : ""}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className={cn("min-w-0 flex-1 truncate text-xs", r.unread ? "text-foreground" : "text-muted-foreground")}>
                      {r.lastFromMe && "我："}
                      {r.lastText ?? ""}
                    </span>
                    {r.unread > 0 && (
                      <span className="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
                        {r.unread > 99 ? "99+" : r.unread}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                    <span className="truncate">{r.account}</span>
                    {r.customer && <span className="truncate rounded bg-emerald-50 px-1 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{r.customer}</span>}
                    {r.assignee && <span className="truncate">· {r.assignee}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 会话 ── */}
      {view ? (
        <ThreadView
          key={view.id}
          data={view}
          tz={user.timezone}
          backHref={href({ t: null })}
          members={members}
          canAssign={manage || view.assignee?.id === user.id}
          canLead={can(user, "lead.create")}
        />
      ) : (
        <section className="hidden min-w-0 flex-1 flex-col md:flex">
          <div className="m-auto max-w-xs px-6 text-center">
            <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <MessagesSquare className="size-7" />
            </span>
            <p className="font-medium">选择一个会话</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              TikTok、Instagram、Facebook、LinkedIn、X 的私信和你的 WhatsApp 都在这里。外文消息自动译成中文，回复可以自动译成对方的语言。
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
