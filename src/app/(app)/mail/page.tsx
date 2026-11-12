import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/crm/empty-state";
import { Inbox, Mail, Paperclip, PenSquare, Search, Send, Star, UserRound, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { WaAvatar } from "@/components/crm/wa-avatar";
import { waListTime } from "@/lib/wa-time";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { aiConfigured } from "@/server/ai";
import { asAddresses, asAttachments } from "@/server/mail/store";
import { formatDateTime } from "@/lib/crm";
import { MAIL_INTENT_LABELS } from "@/lib/mail";
import { cn } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";
import { MailReader } from "./mail-reader";
import { MailShortcuts } from "./mail-shortcuts";
import { SyncButton } from "./sync-button";
import { MailSwipe } from "./mail-swipe";
import { noAutofill } from "@/lib/no-autofill";

export const metadata: Metadata = { title: "邮件" };

const BOXES = [
  { key: "inbox", label: "收件箱", icon: Inbox },
  { key: "sent", label: "已发送", icon: Send },
  { key: "starred", label: "星标邮件", icon: Star },
] as const;

const TAGS = [
  { key: "", label: "全部" },
  { key: "high", label: "高优先" },
  { key: "unread", label: "未读" },
  { key: "customer", label: "客户来信" },
  { key: "lead", label: "询盘线索" },
  { key: "none", label: "未归档" },
] as const;

const PAGE = 50;

export default async function MailPage({ searchParams }: PageProps<"/mail">) {
  const user = await requirePermission("mail.use");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const box = BOXES.find((b) => b.key === s("box"))?.key ?? "inbox";
  const tag = TAGS.find((t) => t.key === s("tag"))?.key ?? "";
  const acc = s("acc");
  const q = s("q").trim();
  const page = Math.max(1, Number(s("page")) || 1);
  const selectedId = s("id");

  const db = tenantDb(user.tenantId);
  const accounts = await db.mailAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  const accountIds = acc && accounts.some((a) => a.id === acc) ? [acc] : accounts.map((a) => a.id);

  const href = (patch: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string> = { box, tag, acc, q, page: String(page), id: selectedId };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v !== null && v !== "" && !(k === "page" && v === "1")) p.set(k, String(v));
    return `/mail${p.size ? `?${p}` : ""}`;
  };

  if (!accounts.length) {
    return (
      <div className="mx-auto max-w-md surface p-10 text-center">
        <Mail className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="font-medium">还没有绑定邮箱</p>
        <p className="mt-1 text-sm text-muted-foreground">绑定工作邮箱后，就能在这里收发邮件，往来邮件自动归档到客户。</p>
        <Button asChild className="mt-4">
          <Link href="/settings/mailboxes">去绑定邮箱</Link>
        </Button>
      </div>
    );
  }

  const contains = { contains: q, mode: "insensitive" as const };
  const where: Prisma.MailMessageWhereInput = {
    accountId: { in: accountIds },
    ...(box === "inbox" ? { folder: "INBOX" } : box === "sent" ? { folder: "SENT" } : { starred: true }),
    ...(tag === "unread" ? { seen: false } : {}),
    ...(tag === "customer" ? { customerId: { not: null } } : {}),
    ...(tag === "lead" ? { leadId: { not: null } } : {}),
    ...(tag === "high" ? { aiPriority: "high" } : {}),
    ...(tag === "none" ? { customerId: null, leadId: null } : {}),
    ...(q ? { OR: [{ subject: contains }, { fromAddr: contains }, { fromName: contains }, { snippet: contains }] } : {}),
  };

  const inboxOf = { accountId: { in: accountIds }, folder: "INBOX" as const };
  const [total, rows, unread, urgent, selected] = await Promise.all([
    db.mailMessage.count({ where }),
    db.mailMessage.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      select: {
        id: true,
        folder: true,
        fromAddr: true,
        fromName: true,
        toList: true,
        subject: true,
        snippet: true,
        date: true,
        seen: true,
        starred: true,
        attachments: true,
        aiIntent: true,
        aiPriority: true,
        aiSummary: true,
        customer: { select: { name: true } },
        leadId: true,
        trackId: true,
        openCount: true,
        clickCount: true,
        bouncedAt: true,
      },
    }),
    db.mailMessage.count({ where: { accountId: { in: accounts.map((a) => a.id) }, folder: "INBOX", seen: false } }),
    db.mailMessage.count({ where: { ...inboxOf, seen: false, aiPriority: "high" } }),
    selectedId
      ? db.mailMessage.findFirst({
          where: { id: selectedId, accountId: { in: accounts.map((a) => a.id) } },
          include: {
            customer: { select: { id: true, name: true } },
            lead: { select: { id: true, status: true } },
            account: { select: { email: true } },
            events: { orderBy: { createdAt: "desc" }, take: 12, select: { type: true, url: true, createdAt: true } },
          },
        })
      : null,
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const errored = accounts.filter((a) => a.status === "ERROR");

  return (
    <div className="-mx-3 -mt-3 -mb-4 flex h-[calc(100svh-6.75rem-1px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[26rem] overflow-hidden surface rounded-none shadow-none md:m-0 md:h-[calc(100svh-6.5rem)] md:min-h-[32rem] md:rounded-2xl md:shadow-[var(--card-shadow)]">
      {/* 文件夹 */}
      <aside className="hidden w-52 shrink-0 flex-col gap-4 border-r p-3 xl:flex">
        <Button asChild>
          <Link href="/mail/compose">
            <PenSquare /> 写邮件
          </Link>
        </Button>
        <nav className="space-y-0.5">
          {BOXES.map((b) => (
            <Link
              key={b.key}
              href={href({ box: b.key, page: 1, id: null })}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm",
                box === b.key ? "bg-sidebar-accent font-medium" : "hover:bg-muted",
              )}
            >
              <b.icon className="size-4" /> {b.label}
              {b.key === "inbox" && unread > 0 && (
                <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] leading-5 font-medium text-primary-foreground tabular-nums">
                  {unread}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div>
          <p className="mb-1 px-2 text-xs text-muted-foreground">邮箱</p>
          <div className="space-y-0.5">
            <Link
              href={href({ acc: null, page: 1, id: null })}
              className={cn("block truncate rounded-full px-3 py-1 text-sm", !acc ? "bg-sidebar-accent font-medium" : "hover:bg-muted")}
            >
              全部邮箱
            </Link>
            {accounts.map((a) => (
              <Link
                key={a.id}
                href={href({ acc: a.id, page: 1, id: null })}
                title={a.lastError ?? a.email}
                className={cn(
                  "flex items-center gap-1.5 truncate rounded-full px-3 py-1 text-sm",
                  acc === a.id ? "bg-sidebar-accent font-medium" : "hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    a.status === "ERROR" ? "bg-rose-500" : a.status === "PAUSED" ? "bg-slate-300" : "bg-emerald-500",
                  )}
                />
                <span className="truncate">{a.email}</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="mt-auto space-y-2">
          {errored.length > 0 && (
            <Link href="/settings/mailboxes" className="block rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
              {errored.length} 个邮箱连接失败，点此处理
            </Link>
          )}
          <SyncButton />
        </div>
      </aside>

      {/* 列表 */}
      <section className={cn("flex w-full min-w-0 flex-col border-r lg:w-[24rem] lg:shrink-0", selected && "hidden lg:flex")}>
        <div className="space-y-2 border-b p-3">
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] xl:hidden">
            <Button asChild size="sm" className="shrink-0">
              <Link href="/mail/compose">
                <PenSquare /> 写邮件
              </Link>
            </Button>
            {BOXES.map((b) => (
              <Button key={b.key} asChild size="sm" variant={box === b.key ? "secondary" : "ghost"} className="shrink-0">
                <Link href={href({ box: b.key, page: 1, id: null })}>{b.label}</Link>
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <form action="/mail" className="relative flex flex-1 gap-2">
              {box !== "inbox" && <input type="hidden" name="box" value={box} />}
              {acc && <input type="hidden" name="acc" value={acc} />}
              {tag && <input type="hidden" name="tag" value={tag} />}
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                {...noAutofill}
                name="q"
                defaultValue={q}
                placeholder="搜索主题、发件人、内容"
                className="h-9 w-full rounded-full bg-muted/70 pr-3 pl-9 text-sm outline-none ring-1 ring-transparent transition placeholder:text-muted-foreground focus:bg-card focus:ring-primary/40"
              />
            </form>
            <MailShortcuts list={rows.map((m) => ({ id: m.id, href: href({ id: m.id }) }))} selectedId={selectedId} listHref={href({ id: null })} />
          </div>
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] lg:flex-wrap">
            {TAGS.map((t) => (
              <Link
                key={t.key}
                href={href({ tag: t.key || null, page: 1, id: null })}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[13px] lg:h-auto lg:px-2 lg:py-0.5 lg:text-xs",
                  tag === t.key
                    ? "border-brand-soft bg-brand-soft text-brand-ink"
                    : t.key === "high" && urgent > 0
                      ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                      : "hover:bg-muted",
                )}
              >
                {t.label}
                {t.key === "unread" && unread > 0 && <span className="ml-1 font-medium tabular-nums">{unread}</span>}
                {t.key === "high" && urgent > 0 && <span className="ml-1 font-medium tabular-nums">{urgent}</span>}
              </Link>
            ))}
          </div>
        </div>
        <ul className="flex-1 divide-y overflow-y-auto">
          {rows.length === 0 && (
            <li>
              <EmptyState icon={Inbox} className="py-16">
                没有邮件
              </EmptyState>
            </li>
          )}
          {rows.map((m) => {
            const peer =
              m.folder === "SENT"
                ? asAddresses(m.toList)
                    .map((a) => a.name || a.address)
                    .join(", ")
                : m.fromName || m.fromAddr;
            const intent = m.aiIntent ? MAIL_INTENT_LABELS[m.aiIntent] : null;
            return (
              <li key={m.id}>
                <MailSwipe id={m.id} seen={m.seen} starred={m.starred} inbox={m.folder === "INBOX"}>
                  <Link
                    href={href({ id: m.id })}
                    scroll={false}
                    data-mail-id={m.id}
                    className={cn(
                      "relative flex gap-3 px-4 py-3 hover:bg-muted/60 lg:block lg:px-3 lg:py-2.5",
                      !m.seen && "bg-primary/[0.035] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary",
                      selectedId === m.id && "bg-sidebar-accent",
                    )}
                  >
                    <WaAvatar src={null} name={peer || null} phone={null} className="size-10 text-sm lg:hidden" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {!m.seen && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="未读" />}
                        {m.aiPriority === "high" && m.folder === "INBOX" && (
                          <span
                            className="shrink-0 rounded-full bg-rose-500 px-1.5 text-[10px] leading-4 font-medium text-white"
                            title="AI 判断：高优先，尽快回复"
                          >
                            高优先
                          </span>
                        )}
                        <span className={cn("min-w-0 flex-1 truncate text-[15px] lg:text-sm", !m.seen && "font-medium")}>
                          {m.folder === "SENT" && <span className="text-muted-foreground">发给 </span>}
                          {peer || "—"}
                        </span>
                        {m.starred && <Star className="size-3 fill-amber-400 text-amber-400" />}
                        {asAttachments(m.attachments).length > 0 && <Paperclip className="size-3 text-muted-foreground" />}
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          <span className="lg:hidden">{waListTime(m.date, user.timezone)}</span>
                          <span className="hidden lg:inline">{formatDateTime(m.date, user.timezone)}</span>
                        </span>
                      </div>
                      <p className={cn("mt-0.5 truncate text-sm", !m.seen ? "font-medium" : "text-foreground/90")}>{m.subject || "(无主题)"}</p>
                      {m.aiSummary && m.folder === "INBOX" ? (
                        <p className="line-clamp-2 text-xs text-foreground/75" title={m.snippet ?? undefined}>
                          <Sparkles className="mr-0.5 inline size-3 -translate-y-px text-brand" />
                          {m.aiSummary}
                        </p>
                      ) : (
                        <p className="truncate text-xs text-muted-foreground">{m.snippet}</p>
                      )}
                      {m.folder === "SENT" && m.trackId && <TrackChip opens={m.openCount} clicks={m.clickCount} bounced={!!m.bouncedAt} />}
                      {(m.customer || m.leadId || intent) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {m.customer && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">
                              <UserRound className="size-3" />
                              {m.customer.name}
                            </span>
                          )}
                          {!m.customer && m.leadId && <span className="rounded-full bg-brand-soft px-1.5 text-[11px] text-brand-ink">线索</span>}
                          {intent && (
                            <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 text-[11px]", intent.cls)}>{intent.label}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </Link>
                </MailSwipe>
              </li>
            );
          })}
        </ul>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span>
              共 {total} 封 · 第 {page}/{pages} 页
            </span>
            <span className="flex gap-1">
              {page > 1 && (
                <Button asChild size="sm" variant="outline" className="lg:h-6 lg:px-2 lg:text-xs">
                  <Link href={href({ page: page - 1, id: null })}>上一页</Link>
                </Button>
              )}
              {page < pages && (
                <Button asChild size="sm" variant="outline" className="lg:h-6 lg:px-2 lg:text-xs">
                  <Link href={href({ page: page + 1, id: null })}>下一页</Link>
                </Button>
              )}
            </span>
          </div>
        )}
      </section>

      {/* 阅读 */}
      <section className={cn("min-w-0 flex-1 flex-col", selected ? "flex" : "hidden lg:flex")}>
        {selected ? (
          <MailReader
            key={selected.id}
            tz={user.timezone}
            backHref={href({ id: null })}
            canAi={can(user, "ai.use") && aiConfigured()}
            canLead={can(user, "lead.create")}
            message={{
              id: selected.id,
              folder: selected.folder,
              accountEmail: selected.account.email,
              fromAddr: selected.fromAddr,
              fromName: selected.fromName,
              to: asAddresses(selected.toList),
              cc: asAddresses(selected.ccList),
              subject: selected.subject,
              text: selected.text,
              html: selected.html,
              date: selected.date.toISOString(),
              seen: selected.seen,
              starred: selected.starred,
              attachments: asAttachments(selected.attachments),
              customer: selected.customer,
              lead: selected.lead,
              aiSummary: selected.aiSummary,
              aiIntent: selected.aiIntent,
              aiPriority: selected.aiPriority,
              track: selected.trackId
                ? {
                    openCount: selected.openCount,
                    openedAt: selected.openedAt?.toISOString() ?? null,
                    lastOpenAt: selected.lastOpenAt?.toISOString() ?? null,
                    clickCount: selected.clickCount,
                    bouncedAt: selected.bouncedAt?.toISOString() ?? null,
                    events: selected.events.map((e) => ({ type: e.type, url: e.url, at: e.createdAt.toISOString() })),
                  }
                : null,
            }}
          />
        ) : (
          <div className="m-auto text-center text-sm text-muted-foreground">
            <Mail className="mx-auto mb-2 size-8 opacity-40" />
            选择一封邮件阅读
          </div>
        )}
      </section>
    </div>
  );
}

/** 已发送邮件的追踪状态 */
function TrackChip({ opens, clicks, bounced }: { opens: number; clicks: number; bounced: boolean }) {
  if (bounced) return <span className="mt-1 inline-flex rounded bg-rose-50 px-1.5 text-[11px] text-rose-700">退信</span>;
  return (
    <span
      className={cn(
        "mt-1 inline-flex items-center gap-1 rounded px-1.5 text-[11px]",
        opens ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground",
      )}
    >
      {opens ? `已打开 ${opens} 次` : "未打开"}
      {clicks > 0 && <span>· 点击 {clicks}</span>}
    </span>
  );
}
