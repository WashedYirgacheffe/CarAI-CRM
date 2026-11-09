import { waMediaOf } from "@/components/crm/wa-media";
import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Check, Clock, ExternalLink, Image as ImageIcon, LoaderCircle, MessageCircle, Phone, Search, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WaAvatar } from "@/components/crm/wa-avatar";
import { can, requirePermission } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { aiConfigured } from "@/server/ai";
import { waListTime } from "@/lib/wa-time";
import { countryName } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { ChatView, LiveRefresh, NewChatButton, StartFromParams } from "./chat-view";

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
        <p className="text-lg font-semibold">还没有绑定 WhatsApp</p>
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
  const [chats, chat, unreadChats] = await Promise.all([
    db.waChat.findMany({
      where: {
        ...base,
        ...(f === "unread" ? { unread: { gt: 0 } } : f === "customer" ? { customerId: { not: null } } : f === "unlinked" ? { customerId: null } : {}),
        ...(q ? { OR: [{ name: contains }, { phone: { contains: q.replace(/\D/g, "") || q } }, { customer: { name: contains } }] } : {}),
      },
      orderBy: { lastMessageAt: "desc" },
      take: 300,
      include: { customer: { select: { name: true } } },
    }),
    chatId
      ? db.waChat.findFirst({
          where: { id: chatId, accountId: account.id },
          include: {
            customer: { select: { id: true, name: true, country: true, status: { select: { name: true } } } },
            contact: { select: { name: true, title: true, email: true } },
          },
        })
      : null,
    db.waChat.count({ where: { ...base, unread: { gt: 0 } } }),
  ]);
  const [messages, media, msgCount] = chat
    ? await Promise.all([
        db.waMessage.findMany({ where: { chatId: chat.id }, orderBy: { timestamp: "desc" }, take: 300 }).then((r) => r.reverse()),
        db.waMessage.findMany({
          where: { chatId: chat.id, mediaKey: { not: null }, type: { in: ["image", "video"] } },
          orderBy: { timestamp: "desc" },
          take: 9,
          select: { id: true, type: true },
        }),
        db.waMessage.count({ where: { chatId: chat.id } }),
      ])
    : [[], [], 0];

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

  return (
    <div className="flex h-[calc(100svh-5.5rem)] min-h-[34rem] overflow-hidden surface md:h-[calc(100svh-6.5rem)]">
      {s("phone") && <StartFromParams phone={s("phone")} customerId={s("customerId") || undefined} />}
      {/* 会话页自己每 4 秒刷新；只看列表时，同步中刷得快一些 */}
      {!chat && <LiveRefresh ms={syncing ? 3000 : 10_000} />}

      {/* ── 会话列表 ── */}
      <section className={cn("flex w-full min-w-0 flex-col border-r border-border/70 md:w-[22rem] md:shrink-0", chat && "hidden md:flex")}>
        <header className="flex items-center gap-3 px-4 pt-4 pb-3">
          <span className="relative">
            <WaAvatar src={account.avatarKey ? `/api/whatsapp/avatar/me?v=${account.avatarAt?.getTime() ?? 0}` : null} name={account.name} phone={account.phone} className="size-10 text-sm" />
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-card",
                connected ? "bg-emerald-500" : account.enabled ? "bg-amber-400" : "bg-slate-300",
              )}
              aria-hidden
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{account.name || "WhatsApp"}</p>
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

        <ul className="flex-1 overflow-y-auto px-2 pb-2">
          {chats.length === 0 && (
            <li className="px-6 py-16 text-center text-sm text-muted-foreground">
              {syncing ? "聊天记录同步中，马上就到…" : q || f ? "没有符合条件的聊天" : "还没有聊天，点右上角 + 发起新聊天"}
            </li>
          )}
          {chats.map((c) => {
            const active = chat?.id === c.id;
            return (
              <li key={c.id}>
                <Link
                  href={href({ chat: c.id })}
                  className={cn("flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors", active ? "bg-accent" : "hover:bg-muted/60")}
                >
                  <WaAvatar src={avatarSrc(c.id, c.avatarKey, c.avatarAt)} name={c.name} phone={c.phone} className="size-12" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={cn("min-w-0 flex-1 truncate text-[15px]", c.unread > 0 ? "font-semibold" : "font-medium")}>{display(c)}</span>
                      <span className={cn("shrink-0 text-xs tabular-nums", c.unread > 0 ? "font-medium text-emerald-600" : "text-muted-foreground")}>
                        {c.lastMessageAt && waListTime(c.lastMessageAt, user.timezone)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {c.lastFromMe && <Check className="size-3.5 shrink-0 text-muted-foreground" aria-label="我发出的" />}
                      <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{c.lastText || " "}</p>
                      {c.unread > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-white tabular-nums">
                          {c.unread > 99 ? "99+" : c.unread}
                        </span>
                      )}
                    </div>
                    {c.customer && (
                      <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-primary/8 px-2 py-0.5 text-[11px] text-primary">
                        <Building2 className="size-3 shrink-0" />
                        <span className="truncate">{c.customer.name}</span>
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── 聊天 ── */}
      <section className={cn("min-w-0 flex-1 flex-col", chat ? "flex" : "hidden md:flex")}>
        {chat ? (
          <ChatView
            key={chat.id}
            tz={user.timezone}
            backHref={href({ chat: null })}
            connected={connected}
            canAi={can(user, "ai.use") && aiConfigured()}
            chat={{
              id: chat.id,
              name: chat.name,
              phone: chat.phone,
              unread: chat.unread,
              avatar: avatarSrc(chat.id, chat.avatarKey, chat.avatarAt),
              customer: chat.customer ? { id: chat.customer.id, name: chat.customer.name } : null,
            }}
            messages={messages.map((m) => ({
              id: m.id,
              fromMe: m.fromMe,
              body: m.body,
              media: waMediaOf(m),
              status: m.status,
              error: m.error,
              timestamp: m.timestamp.toISOString(),
            }))}
          />
        ) : (
          <div className="m-auto max-w-xs px-6 text-center">
            <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              {syncing ? <LoaderCircle className="size-7 animate-spin" /> : <Smartphone className="size-7" />}
            </span>
            <p className="font-semibold">{syncing ? "正在同步聊天记录" : "选择一个聊天"}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {syncing
                ? "首次关联会把手机上最近的聊天导入进来，通常 1～3 分钟，期间请保持手机联网。"
                : "消息和手机上的 WhatsApp 实时同步；发给客户的消息会自动记成跟进。"}
            </p>
          </div>
        )}
      </section>

      {/* ── 联系人信息 ── */}
      {chat && (
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-border/70 xl:flex">
          <div className="flex flex-col items-center px-5 pt-8 pb-5 text-center">
            <WaAvatar src={avatarSrc(chat.id, chat.avatarKey, chat.avatarAt)} name={chat.name} phone={chat.phone} className="size-24 text-3xl" />
            <p className="mt-3 text-lg font-semibold">{display(chat)}</p>
            {chat.phone && <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">+{chat.phone}</p>}
            {chat.phone && (
              <Button asChild size="sm" variant="outline" className="mt-3">
                <a href={`https://wa.me/${chat.phone}`} target="_blank" rel="noreferrer">
                  <ExternalLink /> 在 WhatsApp 打开
                </a>
              </Button>
            )}
          </div>

          <div className="space-y-4 px-4 pb-6">
            <InfoBlock title="关联客户">
              {chat.customer ? (
                <Link href={`/customers/${chat.customer.id}`} className="group block rounded-xl bg-muted/50 p-3 transition-colors hover:bg-accent">
                  <p className="flex items-center gap-1.5 font-medium group-hover:text-primary">
                    <Building2 className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{chat.customer.name}</span>
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {[chat.customer.status?.name, chat.customer.country && countryName(chat.customer.country), chat.contact && `联系人：${chat.contact.name}${chat.contact.title ? `（${chat.contact.title}）` : ""}`]
                      .filter(Boolean)
                      .join(" · ") || "查看客户详情"}
                  </p>
                </Link>
              ) : (
                <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">还没关联客户。在聊天顶部点「关联客户」，以后的消息会自动记到客户跟进里。</p>
              )}
            </InfoBlock>

            <InfoBlock title="联系信息">
              <dl className="space-y-2 text-sm">
                <Row icon={Phone} label="号码" value={chat.phone ? `+${chat.phone}` : "未知"} />
                <Row icon={MessageCircle} label="消息" value={`${msgCount} 条`} />
                <Row icon={Clock} label="首次沟通" value={messages[0] ? waListTime(messages[0].timestamp, user.timezone) : "—"} />
              </dl>
            </InfoBlock>

            <InfoBlock title={`图片和视频${media.length ? `（${media.length}）` : ""}`}>
              {media.length ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {media.map((m) => (
                    <a key={m.id} href={`/api/whatsapp/media/${m.id}`} target="_blank" rel="noreferrer" className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                      {m.type === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口
                        <img src={`/api/whatsapp/media/${m.id}`} alt="" loading="lazy" className="size-full object-cover transition-transform hover:scale-105" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-xs text-muted-foreground">视频</span>
                      )}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ImageIcon className="size-3.5" /> 暂无
                </p>
              )}
            </InfoBlock>
          </div>
        </aside>
      )}
    </div>
  );
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Row({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-right tabular-nums">{value}</dd>
    </div>
  );
}
