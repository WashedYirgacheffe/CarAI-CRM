"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, ChevronLeft, Clock, Link2, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AiWriter } from "@/components/ai/ai-writer";
import { WaMedia, waCaption, type WaMediaInfo } from "@/components/crm/wa-media";
import { runAction } from "@/hooks/use-action-form";
import { formatDateTime } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { searchCustomersAction } from "@/app/(app)/mail/actions";
import { linkChatAction, markChatReadAction, retryWaMessageAction, sendWaMessageAction, startChatAction } from "./actions";

type Msg = { id: string; fromMe: boolean; body: string; media: WaMediaInfo; status: "QUEUED" | "SENT" | "FAILED" | "RECEIVED"; error: string | null; timestamp: string };

export function ChatView({
  chat,
  messages,
  tz,
  backHref,
  connected,
  canAi,
}: {
  chat: { id: string; name: string | null; phone: string | null; unread: number; customer: { id: string; name: string } | null };
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
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button asChild variant="ghost" size="icon-sm" className="md:hidden" aria-label="返回">
          <Link href={backHref}>
            <ChevronLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{chat.name || (chat.phone ? `+${chat.phone}` : "未知号码")}</p>
          <p className="truncate text-xs text-muted-foreground">
            {chat.phone && `+${chat.phone}`}
            {chat.customer && (
              <>
                {" · "}
                <Link href={`/customers/${chat.customer.id}`} className="hover:text-primary">
                  客户：{chat.customer.name}
                </Link>
              </>
            )}
          </p>
        </div>
        {!chat.customer && (
          <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
            <Link2 /> 关联客户
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efeae2]/50 px-4 py-3">
        {messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">还没有消息，发一条打个招呼吧</p>}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-xs",
                m.fromMe ? "bg-[#d9fdd3] text-foreground" : "bg-white text-foreground",
                m.status === "FAILED" && "ring-1 ring-rose-300",
              )}
            >
              <WaMedia id={m.id} media={m.media} />
              {waCaption(m.body, m.media) && <p className="whitespace-pre-wrap break-words">{waCaption(m.body, m.media)}</p>}
              <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground tabular-nums">
                {formatDateTime(m.timestamp, tz)}
                {m.fromMe && m.status === "QUEUED" && <Clock className="size-3" aria-label="发送中" />}
                {m.fromMe && m.status === "SENT" && <Check className="size-3" aria-label="已发送" />}
                {m.status === "FAILED" && (
                  <button type="button" className="inline-flex items-center gap-0.5 text-rose-600" title={m.error ?? ""} onClick={() => runAction(retryWaMessageAction(m.id))}>
                    <AlertCircle className="size-3" /> 发送失败，点击重试
                  </button>
                )}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div className="space-y-2 border-t p-3">
        {!connected && <p className="text-xs text-amber-700">WhatsApp 未连接，消息暂时发不出去。</p>}
        {canAi && <AiWriter channel="whatsapp" compact original={lastIncoming || undefined} getDraft={() => text} onApply={setText} />}
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="min-h-10 resize-none"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button onClick={send} disabled={sending || !text.trim()} aria-label="发送">
            <Send />
          </Button>
        </div>
      </div>

      <Dialog open={linking} onOpenChange={setLinking}>
        <DialogContent>{linking && <LinkChat chatId={chat.id} onDone={() => setLinking(false)} />}</DialogContent>
      </Dialog>
    </div>
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
