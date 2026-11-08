import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { can, requirePermission } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { aiConfigured } from "@/server/ai";
import { formatDateTime } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { ChatView, NewChatButton, StartFromParams } from "./chat-view";

export const metadata: Metadata = { title: "WhatsApp" };

export default async function WhatsappPage({ searchParams }: PageProps<"/whatsapp">) {
  const user = await requirePermission("whatsapp.use");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const account = await prisma.waAccount.findUnique({ where: { userId: user.id } });

  if (!account) {
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-card p-10 text-center">
        <MessageCircle className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="font-medium">还没有绑定 WhatsApp</p>
        <p className="mt-1 text-sm text-muted-foreground">用手机扫码登录后，就能在这里和客户聊天。</p>
        <Button asChild className="mt-4">
          <Link href="/settings/whatsapp">去扫码绑定</Link>
        </Button>
      </div>
    );
  }

  const db = tenantDb(user.tenantId);
  const q = s("q").trim();
  const chatId = s("chat");
  const contains = { contains: q, mode: "insensitive" as const };
  const [chats, chat] = await Promise.all([
    db.waChat.findMany({
      where: {
        accountId: account.id,
        lastMessageAt: { not: null },
        ...(q ? { OR: [{ name: contains }, { phone: { contains: q.replace(/\D/g, "") || q } }, { customer: { name: contains } }] } : {}),
      },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
      include: { customer: { select: { name: true } } },
    }),
    chatId
      ? db.waChat.findFirst({ where: { id: chatId, accountId: account.id }, include: { customer: { select: { id: true, name: true } } } })
      : null,
  ]);
  const messages = chat
    ? (await db.waMessage.findMany({ where: { chatId: chat.id }, orderBy: { timestamp: "desc" }, take: 200 })).reverse()
    : [];
  const href = (id: string | null) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (id) p.set("chat", id);
    return `/whatsapp${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="flex h-[calc(100svh-5.5rem)] min-h-[32rem] overflow-hidden rounded-xl border bg-card md:h-[calc(100svh-6.5rem)]">
      {s("phone") && <StartFromParams phone={s("phone")} customerId={s("customerId") || undefined} />}
      <section className={cn("flex w-full min-w-0 flex-col border-r md:w-80 md:shrink-0", chat && "hidden md:flex")}>
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center gap-2">
            <span
              className={cn("size-2 rounded-full", account.status === "CONNECTED" ? "bg-emerald-500" : account.enabled ? "bg-amber-400" : "bg-slate-300")}
            />
            <span className="min-w-0 flex-1 truncate text-sm">
              {account.status === "CONNECTED" ? `+${account.phone}` : account.enabled ? "连接中…" : "未连接"}
            </span>
            {account.status !== "CONNECTED" && (
              <Button asChild size="xs" variant="outline">
                <Link href="/settings/whatsapp">去连接</Link>
              </Button>
            )}
            <NewChatButton />
          </div>
          <form action="/whatsapp">
            <Input name="q" defaultValue={q} placeholder="搜索姓名、号码、客户" className="h-8" />
          </form>
        </div>
        <ul className="flex-1 divide-y overflow-y-auto">
          {chats.length === 0 && <li className="py-16 text-center text-sm text-muted-foreground">还没有聊天</li>}
          {chats.map((c) => (
            <li key={c.id}>
              <Link href={href(c.id)} className={cn("block px-3 py-2.5 hover:bg-muted/60", chat?.id === c.id && "bg-sidebar-accent")}>
                <div className="flex items-center gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-sm", c.unread > 0 && "font-semibold")}>{c.name || (c.phone ? `+${c.phone}` : "未知号码")}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{c.lastMessageAt && formatDateTime(c.lastMessageAt, user.timezone)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{c.lastText}</p>
                  {c.unread > 0 && <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] font-medium text-white tabular-nums">{c.unread}</span>}
                </div>
                {c.customer && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">客户：{c.customer.name}</p>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className={cn("min-w-0 flex-1 flex-col", chat ? "flex" : "hidden md:flex")}>
        {chat ? (
          <ChatView
            key={chat.id}
            tz={user.timezone}
            backHref={href(null)}
            connected={account.status === "CONNECTED"}
            canAi={can(user, "ai.use") && aiConfigured()}
            chat={{ id: chat.id, name: chat.name, phone: chat.phone, unread: chat.unread, customer: chat.customer }}
            messages={messages.map((m) => ({
              id: m.id,
              fromMe: m.fromMe,
              body: m.body,
              status: m.status,
              error: m.error,
              timestamp: m.timestamp.toISOString(),
            }))}
          />
        ) : (
          <div className="m-auto text-center text-sm text-muted-foreground">
            <MessageCircle className="mx-auto mb-2 size-8 opacity-40" />
            选择一个聊天
          </div>
        )}
      </section>
    </div>
  );
}
