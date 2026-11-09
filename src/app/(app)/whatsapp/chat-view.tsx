"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Building2, Check, ChevronLeft, Clock, Link2, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AiWriter } from "@/components/ai/ai-writer";
import { WaMedia, waCaption, type WaMediaInfo } from "@/components/crm/wa-media";
import { runAction } from "@/hooks/use-action-form";
import { waClock, waDayKey, waDayLabel } from "@/lib/wa-time";
import { WaAvatar } from "@/components/crm/wa-avatar";
import { cn } from "@/lib/utils";
import { searchCustomersAction } from "@/app/(app)/mail/actions";
import { linkChatAction, markChatReadAction, retryWaMessageAction, sendWaMessageAction, startChatAction } from "./actions";

type Msg = { id: string; fromMe: boolean; body: string; media: WaMediaInfo; status: "QUEUED" | "SENT" | "FAILED" | "RECEIVED"; error: string | null; timestamp: string };

/** 定时刷新服务端数据（同步中、等新消息） */
export function LiveRefresh({ ms }: { ms: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}

/** 同一个人 5 分钟内的连续消息归成一组：组内只有第一条带小尾巴，间距更紧 */
const GROUP_GAP = 5 * 60_000;

export function ChatView({
  chat,
  messages,
  tz,
  backHref,
  connected,
  canAi,
}: {
  chat: { id: string; name: string | null; phone: string | null; unread: number; avatar: string | null; customer: { id: string; name: string } | null };
  messages: Msg[];
  tz: string;
  backHref: string;
  connected: boolean;
  canAi: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [linking, setLinking] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const title = chat.name || (chat.phone ? `+${chat.phone}` : "未知号码");

  // 打开会话时清未读；每 4 秒拉一次新消息
  useEffect(() => {
    if (chat.unread) void markChatReadAction(chat.id);
  }, [chat.id, chat.unread]);
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [router]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    const r = await sendWaMessageAction(chat.id, text);
    setSending(false);
    if (r.ok) {
      setText("");
      router.refresh();
    } else toast.error(r.message);
  }

  const lastIncoming = messages
    .filter((m) => !m.fromMe)
    .slice(-6)
    .map((m) => m.body)
    .join("\n");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border/70 px-4 py-2.5">
        <Button asChild variant="ghost" size="icon-sm" className="-ml-1 md:hidden" aria-label="返回">
          <Link href={backHref}>
            <ChevronLeft />
          </Link>
        </Button>
        <WaAvatar src={chat.avatar} name={chat.name} phone={chat.phone} className="size-10 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {chat.phone && <span className="tabular-nums">+{chat.phone}</span>}
            {chat.customer && (
              <>
                {chat.phone && " · "}
                <Link href={`/customers/${chat.customer.id}`} className="text-primary hover:underline">
                  {chat.customer.name}
                </Link>
              </>
            )}
          </p>
        </div>
        {chat.customer ? (
          <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex xl:hidden">
            <Link href={`/customers/${chat.customer.id}`}>
              <Building2 /> 客户详情
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
            <Link2 /> 关联客户
          </Button>
        )}
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-8"
        style={{
          backgroundColor: "#efeae2",
          backgroundImage: "radial-gradient(oklch(0.55 0.03 80 / 0.09) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        {messages.length === 0 && (
          <div className="mx-auto mt-10 max-w-xs rounded-xl bg-[#fff8c5] px-4 py-3 text-center text-xs text-[#54656f] shadow-xs">
            还没有消息。发一条打个招呼吧，消息会从你的 WhatsApp 号码发出。
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const day = waDayKey(m.timestamp, tz);
          const newDay = !prev || waDayKey(prev.timestamp, tz) !== day;
          const grouped = !newDay && prev.fromMe === m.fromMe && Date.parse(m.timestamp) - Date.parse(prev.timestamp) < GROUP_GAP;
          const caption = waCaption(m.body, m.media);
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="sticky top-0 z-10 flex justify-center py-2">
                  <span className="rounded-lg bg-white/95 px-3 py-1 text-xs text-[#54656f] shadow-xs">{waDayLabel(day, tz)}</span>
                </div>
              )}
              <div className={cn("flex", m.fromMe ? "justify-end" : "justify-start", grouped ? "mt-0.5" : "mt-2.5")}>
                <div
                  className={cn(
                    "relative max-w-[min(75%,36rem)] rounded-xl px-2.5 pt-1.5 pb-1 text-[14.5px] leading-snug text-[#111b21] shadow-[0_1px_0.5px_oklch(0_0_0/0.13)]",
                    m.fromMe ? "bg-[#d9fdd3]" : "bg-white",
                    !grouped && (m.fromMe ? "rounded-tr-none" : "rounded-tl-none"),
                    m.status === "FAILED" && "ring-1 ring-rose-300",
                  )}
                >
                  {!grouped && <BubbleTail fromMe={m.fromMe} />}
                  <WaMedia id={m.id} media={m.media} />
                  {caption && <span className="break-words whitespace-pre-wrap">{caption}</span>}
                  <span
                    className={cn(
                      "float-right ml-2.5 inline-flex translate-y-1 items-center gap-0.5 text-[11px] text-[#667781] tabular-nums",
                      !caption && "mt-1",
                    )}
                  >
                    {waClock(m.timestamp, tz)}
                    {m.fromMe && m.status === "QUEUED" && <Clock className="size-3" aria-label="发送中" />}
                    {m.fromMe && m.status === "SENT" && <Check className="size-3.5" aria-label="已发送" />}
                  </span>
                  {m.status === "FAILED" && (
                    <button
                      type="button"
                      className="clear-both flex items-center gap-1 pt-1 text-xs text-rose-600 hover:underline"
                      title={m.error ?? ""}
                      onClick={() => runAction(retryWaMessageAction(m.id))}
                    >
                      <AlertCircle className="size-3.5" /> 发送失败，点击重试
                    </button>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
        <div ref={bottom} className="h-1" />
      </div>

      <footer className="space-y-2 border-t border-border/70 bg-[#f7f8fa] px-3 py-3 sm:px-4">
        {!connected && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700">
            <AlertCircle className="size-3.5" /> WhatsApp 未连接，消息暂时发不出去。
          </p>
        )}
        {canAi && <AiWriter channel="whatsapp" compact original={lastIncoming || undefined} getDraft={() => text} onApply={setText} />}
        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 items-end rounded-3xl bg-card px-4 py-2 shadow-xs ring-1 ring-border/70 focus-within:ring-primary/40">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={1}
              className="field-sizing-content max-h-40 min-h-6 w-full resize-none bg-transparent text-[14.5px] leading-6 outline-none placeholder:text-muted-foreground"
              placeholder="输入消息"
              title="Enter 发送，Shift+Enter 换行"
              aria-label="消息"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
          </div>
          <Button onClick={send} disabled={sending || !text.trim()} size="icon" className="size-10 shrink-0 rounded-full" aria-label="发送">
            <Send />
          </Button>
        </div>
      </footer>

      <Dialog open={linking} onOpenChange={setLinking}>
        <DialogContent>{linking && <LinkChat chatId={chat.id} onDone={() => setLinking(false)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

/** 气泡顶角的小尾巴（WhatsApp 样式） */
function BubbleTail({ fromMe }: { fromMe: boolean }) {
  return (
    <svg
      viewBox="0 0 8 13"
      className={cn("absolute top-0 h-[13px] w-2", fromMe ? "-right-2 fill-[#d9fdd3]" : "-left-2 -scale-x-100 fill-white")}
      aria-hidden
    >
      <path d="M0 0h8L1.5 9.5C1 10.3 0 10 0 9V0z" />
    </svg>
  );
}

function LinkChat({ chatId, onDone }: { chatId: string; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; name: string; domain: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => setRows(await searchCustomersAction(q)), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <DialogHeader>
        <DialogTitle>关联到客户</DialogTitle>
        <DialogDescription>这个号码会写进客户的联系人，以后的聊天自动归到该客户。</DialogDescription>
      </DialogHeader>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索客户名称、域名" />
      <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
        {rows.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">没有找到客户</li>}
        {rows.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={busy}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={async () => {
                setBusy(true);
                const r = await runAction(linkChatAction(chatId, c.id));
                setBusy(false);
                if (r.ok) onDone();
              }}
            >
              <span className="truncate font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.domain}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function NewChatButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button size="icon-sm" variant="ghost" aria-label="新建聊天" title="新建聊天" onClick={() => setOpen(true)}>
        <Plus />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await startChatAction(phone);
              setBusy(false);
              if (r.ok && r.id) {
                setOpen(false);
                router.push(`/whatsapp?chat=${r.id}`);
              } else toast.error(r.message);
            }}
          >
            <DialogHeader>
              <DialogTitle>新建聊天</DialogTitle>
              <DialogDescription>输入对方带国家码的 WhatsApp 号码。</DialogDescription>
            </DialogHeader>
            <Input className="my-4" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" />
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                开始聊天
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** /whatsapp?phone=...&customerId=... 从客户页跳过来时，自动打开（或新建）会话 */
export function StartFromParams({ phone, customerId }: { phone: string; customerId?: string }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void startChatAction(phone, customerId).then((r) => {
      if (r.ok && r.id) router.replace(`/whatsapp?chat=${r.id}`);
      else {
        toast.error(r.message);
        router.replace("/whatsapp");
      }
    });
  }, [phone, customerId, router]);
  return null;
}
