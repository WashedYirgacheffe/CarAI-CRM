import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/crm/empty-state";
import { Archive, ChevronLeft, LoaderCircle, MessageCircle, Search, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WaAvatar } from "@/components/crm/wa-avatar";
import { can, requirePermission } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { aiConfigured } from "@/server/ai";
import { waListTime } from "@/lib/wa-time";
import { cn } from "@/lib/utils";
import { ChatView, LiveRefresh, NewChatButton, StartFromParams } from "./chat-view";
import { ChatListItem } from "./chat-list-item";
import { loadChatView } from "./chat-data";

export const metadata: Metadata = { title: "WhatsApp" };

const FILTERS = [
  { key: "", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "customer", label: "客户" },
  { key: "unlinked", label: "未关联" },
] as const;

const avatarSrc = (id: string, key: string | null, at: Date | null) => (key ? `/api/whatsapp/avatar/${id}?v=${at?.getTime() ?? 0}` : null);
const display = (c: { name: string | null; phone: string | null }) => c.name || (c.phone ? `+${c.phone}` : "未知号码");

export default async function WhatsappPage({ searchParams }: PageProps<"/whatsapp">) {
  const user = await requirePermission("whatsapp.use");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const account = await prisma.waAccount.findUnique({ where: { userId: user.id } });

  if (!account) {
    return (
      <div className="mx-auto mt-10 max-w-md surface p-10 text-center">
        <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          <MessageCircle className="size-7" />
        </span>
        <p className="text-lg font-medium">还没有绑定 WhatsApp</p>
        <p className="mt-1.5 text-sm text-muted-foreground">用手机号配对码或扫码关联后，聊天记录会同步过来，直接在这里和客户沟通。</p>
        <Button asChild className="mt-5">
          <Link href="/settings/whatsapp">去绑定</Link>
        </Button>
      </div>
    );
  }

  const db = tenantDb(user.tenantId);
  const q = s("q").trim();
  const f = s("f");
  const chatId = s("chat");
  const contains = { contains: q, mode: "insensitive" as const };
  const base = { accountId: account.id, lastMessageAt: { not: null } };
  const [chats, view, unreadChats, archivedCount] = await Promise.all([
    db.waChat.findMany({
      where: {
        ...base,
        archived: f === "archived",
        ...(f === "unread" ? { unread: { gt: 0 } } : f === "customer" ? { customerId: { not: null } } : f === "unlinked" ? { customerId: null } : {}),
        ...(q ? { OR: [{ name: contains }, { phone: { contains: q.replace(/\D/g, "") || q } }, { customer: { name: contains } }] } : {}),
      },
      orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { lastMessageAt: "desc" }],
      take: 300,
      include: { customer: { select: { id: true, name: true } } },
    }),
    chatId ? loadChatView(user, account.id, chatId) : null,
    db.waChat.count({ where: { ...base, archived: false, unread: { gt: 0 } } }),
    db.waChat.count({ where: { ...base, archived: true } }),
  ]);
  const chat = view?.chat ?? null;

  const href = (p: { chat?: string | null; f?: string }) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    const ff = p.f ?? f;
    if (ff) u.set("f", ff);
    if (p.chat) u.set("chat", p.chat);
    return `/whatsapp${u.size ? `?${u}` : ""}`;
  };
  const connected = account.status === "CONNECTED";
  const syncing = connected && account.syncStatus === "syncing";
  const canAi = can(user, "ai.use") && aiConfigured();

  return (
    // 手机上像微信一样贴边铺满：抵消 main 的内边距，上贴顶栏、下贴标签栏（3.75rem），去掉圆角和阴影；桌面仍是白卡片
    <div className="-mx-3 -mt-3 -mb-4 flex h-[calc(100svh-6.75rem-1px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[26rem] overflow-hidden surface rounded-none shadow-none md:m-0 md:h-[calc(100svh-6.5rem)] md:min-h-[34rem] md:rounded-2xl md:shadow-[var(--card-shadow)]">
      {s("phone") && <StartFromParams phone={s("phone")} customerId={s("customerId") || undefined} />}
      {/* 会话页自己每 4 秒刷新；只看列表时，同步中刷得快一些 */}
      {!chat && <LiveRefresh ms={syncing ? 3000 : 10_000} />}

      {/* ── 会话列表 ── */}
      <section className={cn("flex w-full min-w-0 flex-col border-r border-border/70 md:w-[22rem] md:shrink-0", chat && "hidden md:flex")}>
        <header className="flex items-center gap-3 px-4 pt-4 pb-3">
          <span className="relative">
            <WaAvatar
              src={account.avatarKey ? `/api/whatsapp/avatar/me?v=${account.avatarAt?.getTime() ?? 0}` : null}
              name={account.name}
              phone={account.phone}
              className="size-10 text-sm"
            />
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-card",
                connected ? "bg-emerald-500" : account.enabled ? "bg-amber-400" : "bg-slate-300",
              )}
              aria-hidden
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{account.name || "WhatsApp"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {connected ? `+${account.phone} · 已连接` : account.enabled ? "连接中…" : "未连接"}
            </p>
          </div>
          {!connected && (
            <Button asChild size="xs" variant="outline">
              <Link href="/settings/whatsapp">去连接</Link>
            </Button>
          )}
          <NewChatButton />
        </header>

        {syncing && (
          <div className="mx-4 mb-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-emerald-900 ring-1 ring-emerald-100">
            <p className="flex items-center gap-2 text-sm font-medium">
              <LoaderCircle className="size-4 animate-spin" />
              正在从手机同步聊天记录
            </p>
            <p className="mt-0.5 pl-6 text-xs text-emerald-800/80 tabular-nums">
              已导入 {account.syncMessages} 条消息{account.syncProgress != null && ` · ${account.syncProgress}%`}，请保持手机联网
            </p>
            <div className="mt-2 ml-6 h-1 overflow-hidden rounded-full bg-emerald-100">
              {account.syncProgress != null ? (
                <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${Math.max(account.syncProgress, 4)}%` }} />
              ) : (
                <div className="h-full w-1/3 animate-[wa-sync_1.4s_ease-in-out_infinite] rounded-full bg-emerald-500" />
              )}
            </div>
          </div>
        )}

        <div className="space-y-2.5 px-4 pb-3">
          <form action="/whatsapp" className="relative">
            {f && <input type="hidden" name="f" value={f} />}
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              defaultValue={q}
              placeholder="搜索姓名、号码、客户"
              className="h-9 w-full rounded-full bg-muted/70 pr-3 pl-9 text-sm outline-none ring-1 ring-transparent transition placeholder:text-muted-foreground focus:bg-card focus:ring-primary/40"
            />
          </form>
          <nav className="flex gap-1.5" aria-label="筛选会话">
            {FILTERS.map((x) => (
              <Link
                key={x.key}
                href={href({ f: x.key })}
                aria-current={f === x.key ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  f === x.key ? "bg-emerald-100 text-emerald-800" : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {x.label}
                {x.key === "unread" && unreadChats > 0 && <span className="tabular-nums">{unreadChats}</span>}
              </Link>
            ))}
          </nav>
        </div>

        <ul className="flex-1 overflow-y-auto pb-2 md:px-2">
          {f === "archived" ? (
            <li className="mb-1 md:px-2">
              <Link
                href={href({ f: "" })}
                className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground md:rounded-xl md:px-2.5"
              >
                <ChevronLeft className="size-4" /> 已归档的聊天
              </Link>
            </li>
          ) : (
            archivedCount > 0 &&
            !q && (
              <li className="mb-1">
                <Link href={href({ f: "archived" })} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/60 md:rounded-xl md:px-2.5">
                  <span className="flex size-12 shrink-0 items-center justify-center text-emerald-600">
                    <Archive className="size-5" />
                  </span>
                  <span className="flex-1 font-medium">已归档</span>
                  <span className="text-xs text-emerald-600 tabular-nums">{archivedCount}</span>
                </Link>
              </li>
            )
          )}
          {chats.length === 0 && (
            <li>
              <EmptyState icon={MessageCircle} className="px-6 py-16">
                {syncing ? "聊天记录同步中，马上就到…" : q || f ? "没有符合条件的聊天" : "还没有聊天，点右上角 + 发起新聊天"}
              </EmptyState>
            </li>
          )}
          {chats.map((c) => (
            <ChatListItem
              key={c.id}
              backHref={href({ chat: null })}
              c={{
                id: c.id,
                href: href({ chat: c.id }),
                active: chat?.id === c.id,
                name: display(c),
                rawName: c.name,
                phone: c.phone,
                avatar: avatarSrc(c.id, c.avatarKey, c.avatarAt),
                time: c.lastMessageAt ? waListTime(c.lastMessageAt, user.timezone) : "",
                lastText: c.lastText,
                lastFromMe: c.lastFromMe,
                unread: c.unread,
                pinned: !!c.pinnedAt,
                archived: c.archived,
                customer: c.customer,
              }}
            />
          ))}
        </ul>
      </section>

      {/* ── 聊天 + 右侧客户面板 ── */}
      {chat ? (
        <ChatView key={chat.id} tz={user.timezone} backHref={href({ chat: null })} connected={connected} canAi={canAi} {...view!} />
      ) : (
        <section className="hidden min-w-0 flex-1 flex-col md:flex">
          <div className="m-auto max-w-xs px-6 text-center">
            <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              {syncing ? <LoaderCircle className="size-7 animate-spin" /> : <Smartphone className="size-7" />}
            </span>
            <p className="font-medium">{syncing ? "正在同步聊天记录" : "选择一个聊天"}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {syncing
                ? "首次关联会把手机上最近的聊天导入进来，通常 1～3 分钟，期间请保持手机联网。"
                : "消息和手机上的 WhatsApp 实时同步；右键消息或会话可以回复、转发、置顶、设提醒。"}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
