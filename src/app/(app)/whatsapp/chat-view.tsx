"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  BellPlus,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Forward,
  Image as ImageIcon,
  Languages,
  Link2,
  Link2Off,
  LoaderCircle,
  MailOpen,
  Maximize2,
  MoreVertical,
  NotebookPen,
  Package,
  PanelRight,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Reply,
  RotateCcw,
  Send,
  Star,
  StarOff,
  Trash2,
  X,
} from "@/components/icons";
import { toast } from "sonner";
import { TaskForm } from "@/components/crm/tasks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AiWriter } from "@/components/ai/ai-writer";
import { WaMedia, waCaption, type WaMediaInfo } from "@/components/crm/wa-media";
import { WaLightbox, type LightboxImage } from "@/components/crm/wa-lightbox";
import { ContextActions, DropdownActions, type MenuEntry } from "@/components/crm/action-menu";
import { runAction } from "@/hooks/use-action-form";
import { waClock, waDayKey, waDayLabel } from "@/lib/wa-time";
import { WaAvatar } from "@/components/crm/wa-avatar";
import { cn } from "@/lib/utils";
import {
  chatOpAction,
  forwardWaMessageAction,
  listChatsAction,
  logMessageFollowUpAction,
  markChatReadAction,
  messageOpAction,
  retryWaMessageAction,
  sendWaMediaAction,
  sendWaMessageAction,
  startChatAction,
  translateWaAction,
  translateWaOutAction,
  unlinkChatAction,
} from "./actions";
import { looksChinese, looksForeign } from "@/lib/lang";
import { ChatPanel, type PanelData, type PanelTab } from "./chat-panel";
import { LinkChatDialog } from "./link-chat";

export type Quoted = { id: string; fromMe: boolean; body: string; type: string } | null;
const TR_IN_KEY = "crm-wa-tr";
const TR_OUT_KEY = "crm-wa-tr-out";

export type Msg = {
  id: string;
  fromMe: boolean;
  body: string;
  type: string;
  media: WaMediaInfo;
  status: "QUEUED" | "SENT" | "FAILED" | "RECEIVED";
  error: string | null;
  timestamp: string;
  starred: boolean;
  /** 对方消息的中文译文：null 还没翻，"" 不用翻 */
  translation?: string | null;
  quoted: Quoted;
};

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
const MAX_FILE = 45 * 1024 * 1024;
const TYPE_LABEL: Record<string, string> = { image: "图片", video: "视频", audio: "语音", document: "文件", sticker: "表情" };

/** 引用块、提醒标题里用的一行摘要 */
function snippet(m: { body: string; type: string }, n = 80) {
  const t = m.body.replace(/^\[(图片|视频|语音|表情)\]\s*/, "").trim();
  const label = TYPE_LABEL[m.type];
  const s = t || (label ? `[${label}]` : "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function download(id: string) {
  const a = document.createElement("a");
  a.href = `/api/whatsapp/media/${id}?download`;
  a.click();
}

const isWide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;

type ChatInfo = {
  id: string;
  name: string | null;
  phone: string | null;
  unread: number;
  avatar: string | null;
  pinned: boolean;
  archived: boolean;
  customer: { id: string; name: string } | null;
};

export function ChatView({
  chat,
  messages,
  tz,
  backHref,
  connected,
  canAi,
  panel,
}: {
  chat: ChatInfo;
  messages: Msg[];
  tz: string;
  backHref: string;
  connected: boolean;
  canAi: boolean;
  panel: PanelData;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [linking, setLinking] = useState(false);
  const [forwarding, setForwarding] = useState<Msg | null>(null);
  const [reminding, setReminding] = useState<Msg | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("follow");
  const [sheet, setSheet] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastCount = useRef(0);
  const title = chat.name || (chat.phone ? `+${chat.phone}` : "未知号码");

  // ── 自动翻译：对方的外文消息译成中文；可选「中文写、发前译成客户的语言」──
  const [trOn, setTrOn] = useState(true);
  const [outTr, setOutTr] = useState(false);
  const [trPending, setTrPending] = useState<Set<string>>(() => new Set());
  const [trFrom, setTrFrom] = useState<{ zh: string; lang: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const trAsked = useRef(new Set<string>());
  useEffect(() => {
    const t = setTimeout(() => {
      setTrOn(localStorage.getItem(TR_IN_KEY) !== "0");
      setOutTr(localStorage.getItem(TR_OUT_KEY) === "1");
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const toggleTrOn = () => {
    setTrOn(!trOn);
    localStorage.setItem(TR_IN_KEY, trOn ? "0" : "1");
  };
  const toggleOutTr = () => {
    setOutTr(!outTr);
    localStorage.setItem(TR_OUT_KEY, outTr ? "0" : "1");
    if (outTr) setTrFrom(null);
  };
  useEffect(() => {
    if (!canAi || !trOn) return;
    const ids = messages
      .filter((m) => !m.fromMe && m.translation == null && !trAsked.current.has(m.id) && looksForeign(waCaption(m.body, m.media), 2))
      .slice(-20)
      .map((m) => m.id);
    if (!ids.length) return;
    const mark = (on: boolean) =>
      setTrPending((s) => {
        const n = new Set(s);
        ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
        return n;
      });
    // 放进定时器：开发模式下 effect 会先跑一次再清掉，避免重复请求或一次都不发
    const t = setTimeout(() => {
      ids.forEach((id) => trAsked.current.add(id));
      mark(true);
      void translateWaAction(chat.id, ids).then((r) => {
        mark(false);
        if (r.ok && r.count) router.refresh();
      });
    }, 0);
    return () => clearTimeout(t);
  }, [messages, trOn, canAi, chat.id, router]);

  // 打开会话时清未读；每 4 秒拉一次新消息
  useEffect(() => {
    if (chat.unread) void markChatReadAction(chat.id);
  }, [chat.id, chat.unread]);
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [router]);

  // 打开时滚到底；之后只有本来就在底部、或是自己刚发的，才跟着滚（翻历史时不被打断）
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = lastCount.current === 0;
    const grew = messages.length > lastCount.current;
    lastCount.current = messages.length;
    if (first || (grew && (atBottom || messages.at(-1)?.fromMe))) el.scrollTop = el.scrollHeight;
  }, [messages, atBottom]);

  const toBottom = () => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`m-${id}`);
    if (!el) {
      toast.info("这条消息比较早，还没加载到当前页面");
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlight(id);
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1800);
  }, []);

  const images: LightboxImage[] = messages
    .filter((m) => m.media?.type === "image")
    .map((m) => ({
      id: m.id,
      caption: waCaption(m.body, m.media) || undefined,
      meta: `${m.fromMe ? "我" : title} · ${waDayLabel(waDayKey(m.timestamp, tz), tz)} ${waClock(m.timestamp, tz)}`,
    }));
  const openImage = (id: string) => {
    const i = images.findIndex((x) => x.id === id);
    setSheet(false);
    setLightbox(i >= 0 ? { images, index: i } : { images: [{ id }], index: 0 });
  };

  function startReply(m: Msg) {
    setReplyTo(m);
    requestAnimationFrame(() => input.current?.focus());
  }

  const willTranslate = canAi && outTr && !trFrom && looksChinese(text);

  async function send() {
    if (!text.trim() || translating) return;
    // 中文写的：先译成客户的语言放回输入框，看过再按一次发送
    if (willTranslate) {
      setTranslating(true);
      const r = await translateWaOutAction(chat.id, text);
      setTranslating(false);
      if (!r.ok || !r.text) return void toast.error(r.message ?? "翻译失败，请重试");
      setTrFrom({ zh: text, lang: r.lang ?? "外文" });
      setText(r.text);
      requestAnimationFrame(() => input.current?.focus());
      return;
    }
    setSending(true);
    const r = await sendWaMessageAction(chat.id, text, replyTo?.id);
    setSending(false);
    if (r.ok) {
      setText("");
      setTrFrom(null);
      setReplyTo(null);
      router.refresh();
    } else toast.error(r.message);
  }

  function addFiles(list: FileList | File[] | null) {
    const arr = Array.from(list ?? []);
    const big = arr.find((f) => f.size > MAX_FILE);
    if (big) toast.error(`「${big.name}」超过 45MB，发不了`);
    const ok = arr.filter((f) => f.size > 0 && f.size <= MAX_FILE).slice(0, 10);
    if (ok.length) setFiles(ok);
  }

  function openSend(tab: PanelTab) {
    setPanelTab(tab);
    if (!isWide()) setSheet(true);
  }

  const messageMenu = (m: Msg): MenuEntry[] => {
    const caption = waCaption(m.body, m.media);
    return [
      { label: "回复", icon: Reply, onSelect: () => startReply(m) },
      {
        label: "复制",
        icon: Copy,
        hidden: !caption,
        onSelect: () => void navigator.clipboard.writeText(caption).then(() => toast.success("已复制")),
      },
      { label: "转发", icon: Forward, onSelect: () => setForwarding(m) },
      {
        label: m.starred ? "取消星标" : "加星标",
        icon: m.starred ? StarOff : Star,
        onSelect: () => void runAction(messageOpAction(m.id, m.starred ? "unstar" : "star")),
      },
      "sep",
      { label: "查看大图", icon: Maximize2, hidden: m.media?.type !== "image", onSelect: () => openImage(m.id) },
      { label: "下载", icon: Download, hidden: !m.media, onSelect: () => download(m.id) },
      "sep",
      { label: "记到客户跟进", icon: NotebookPen, hidden: !chat.customer, onSelect: () => void runAction(logMessageFollowUpAction(m.id)) },
      { label: "设提醒", icon: BellPlus, onSelect: () => setReminding(m) },
      "sep",
      { label: "重新发送", icon: RotateCcw, hidden: m.status !== "FAILED", onSelect: () => void runAction(retryWaMessageAction(m.id)) },
      {
        label: "删除",
        hint: "仅本系统",
        icon: Trash2,
        destructive: true,
        onSelect: () => {
          if (confirm("从本系统里删除这条消息？手机和对方那边不受影响。")) void runAction(messageOpAction(m.id, "hide"));
        },
      },
    ];
  };

  const chatMenu: MenuEntry[] = [
    { label: chat.customer ? "更换关联客户" : "关联客户", icon: Link2, onSelect: () => setLinking(true) },
    {
      label: "取消关联客户",
      icon: Link2Off,
      hidden: !chat.customer,
      onSelect: () => {
        if (chat.customer && confirm(`取消与「${chat.customer.name}」的关联？已记录的跟进会保留，之后的消息不再记到这个客户。`))
          void runAction(unlinkChatAction(chat.id));
      },
    },
    { label: "客户详情", icon: Building2, hidden: !chat.customer, onSelect: () => chat.customer && router.push(`/customers/${chat.customer.id}`) },
    "sep",
    {
      label: chat.pinned ? "取消置顶" : "置顶聊天",
      icon: chat.pinned ? PinOff : Pin,
      onSelect: () => void runAction(chatOpAction(chat.id, chat.pinned ? "unpin" : "pin")),
    },
    {
      label: "标记为未读",
      icon: MailOpen,
      onSelect: async () => {
        const r = await runAction(chatOpAction(chat.id, "unread"));
        if (r.ok) router.push(backHref);
      },
    },
    {
      label: chat.archived ? "取消归档" : "归档聊天",
      icon: chat.archived ? ArchiveRestore : Archive,
      onSelect: async () => {
        const r = await runAction(chatOpAction(chat.id, chat.archived ? "unarchive" : "archive"));
        if (r.ok && !chat.archived) router.push(backHref);
      },
    },
    "sep",
    {
      label: "在 WhatsApp 打开",
      icon: ExternalLink,
      hidden: !chat.phone,
      onSelect: () => window.open(`https://wa.me/${chat.phone}`, "_blank", "noreferrer"),
    },
  ];

  const attachMenu: MenuEntry[] = [
    { label: "照片和视频", icon: ImageIcon, onSelect: () => photoInput.current?.click() },
    { label: "文件", icon: FileText, onSelect: () => fileInput.current?.click() },
    "sep",
    { label: "商品", icon: Package, onSelect: () => openSend("send") },
    { label: "报价单", icon: ClipboardList, hint: chat.customer ? undefined : "需关联客户", onSelect: () => openSend("send") },
    { label: "表单", icon: NotebookPen, onSelect: () => openSend("send") },
  ];

  const lastIncoming = messages
    .filter((m) => !m.fromMe)
    .slice(-6)
    .map((m) => m.body)
    .join("\n");

  const panelEl = (
    <ChatPanel
      data={panel}
      tz={tz}
      canAi={canAi}
      tab={panelTab}
      onTab={setPanelTab}
      onLink={() => {
        setSheet(false);
        setLinking(true);
      }}
      onOpenImage={openImage}
      onJump={(id) => {
        setSheet(false);
        jumpTo(id);
      }}
    />
  );

  return (
    <>
      <section
        className="relative flex min-w-0 flex-1 flex-col"
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes("Files")) setDragging(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <header className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4">
          <Button asChild variant="ghost" size="icon-sm" className="-ml-1 md:hidden" aria-label="返回">
            <Link href={backHref}>
              <ChevronLeft />
            </Link>
          </Button>
          <button type="button" onClick={() => openSend("info")} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="查看资料">
            <WaAvatar src={chat.avatar} name={chat.name} phone={chat.phone} className="size-10 text-sm" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium">{title}</span>
                {chat.pinned && <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label="已置顶" />}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {chat.phone && <span className="tabular-nums">+{chat.phone}</span>}
                {chat.customer && (
                  <>
                    {chat.phone && " · "}
                    <span className="text-primary">{chat.customer.name}</span>
                  </>
                )}
              </span>
            </span>
          </button>
          {!chat.customer && (
            <Button size="sm" variant="outline" onClick={() => setLinking(true)} className="hidden sm:inline-flex">
              <Link2 /> 关联客户
            </Button>
          )}
          {canAi && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={toggleTrOn}
              aria-pressed={trOn}
              aria-label="自动翻译对方消息"
              title={trOn ? "自动翻译已开：对方的外文消息显示中文（点击关闭）" : "自动翻译已关（点击开启）"}
              className={cn(trOn && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}
            >
              <Languages />
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            className="xl:hidden"
            onClick={() => setSheet(true)}
            aria-label="客户面板"
            title="跟进、待办、快捷发送"
          >
            <PanelRight />
          </Button>
          <DropdownActions
            items={chatMenu}
            trigger={
              <Button size="icon-sm" variant="ghost" aria-label="更多操作" title="更多操作">
                <MoreVertical />
              </Button>
            }
          />
        </header>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
          }}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-8"
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
            const items = messageMenu(m);
            const bubbleBg = m.fromMe ? "bg-[#d9fdd3]" : "bg-white";
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="sticky top-0 z-10 flex justify-center py-2">
                    <span className="rounded-lg bg-white/95 px-3 py-1 text-xs text-[#54656f] shadow-xs">{waDayLabel(day, tz)}</span>
                  </div>
                )}
                <div id={`m-${m.id}`} className={cn("flex scroll-my-20", m.fromMe ? "justify-end" : "justify-start", grouped ? "mt-0.5" : "mt-2.5")}>
                  <ContextActions items={items}>
                    <div
                      onDoubleClick={(e) => {
                        if (!(e.target as HTMLElement).closest("a,button,video,audio")) startReply(m);
                      }}
                      className={cn(
                        "group/msg relative max-w-[min(78%,36rem)] rounded-xl px-2.5 pt-1.5 pb-1 text-[14.5px] leading-snug text-[#111b21] shadow-[0_1px_0.5px_oklch(0_0_0/0.13)] transition-shadow duration-300",
                        bubbleBg,
                        !grouped && (m.fromMe ? "rounded-tr-none" : "rounded-tl-none"),
                        m.status === "FAILED" && "ring-1 ring-rose-300",
                        highlight === m.id && "ring-4 ring-amber-300/80",
                      )}
                    >
                      {!grouped && <BubbleTail fromMe={m.fromMe} />}
                      <DropdownActions
                        items={items}
                        trigger={
                          <button
                            type="button"
                            aria-label="消息操作"
                            className={cn(
                              "absolute top-0.5 right-0.5 z-[1] flex size-6 items-center justify-center rounded-full text-[#667781] opacity-0 transition-opacity group-hover/msg:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
                              bubbleBg,
                            )}
                          >
                            <ChevronDown className="size-4" />
                          </button>
                        }
                      />
                      {m.quoted && (
                        <button
                          type="button"
                          onClick={() => jumpTo(m.quoted!.id)}
                          className={cn(
                            "mb-1 flex w-full min-w-40 flex-col rounded-md border-l-4 px-2 py-1 text-left text-[13px]",
                            m.fromMe ? "bg-[#cfe9c7]" : "bg-[#f0f2f5]",
                            m.quoted.fromMe ? "border-emerald-600" : "border-violet-500",
                          )}
                        >
                          <span className={cn("text-xs font-medium", m.quoted.fromMe ? "text-emerald-700" : "text-violet-600")}>
                            {m.quoted.fromMe ? "你" : title}
                          </span>
                          <span className="line-clamp-2 text-[#54656f]">{snippet(m.quoted, 120) || "消息"}</span>
                        </button>
                      )}
                      <WaMedia id={m.id} media={m.media} onOpen={() => openImage(m.id)} />
                      {caption &&
                        (trOn && !m.fromMe && m.translation ? (
                          <>
                            <span className="break-words whitespace-pre-wrap">{m.translation}</span>
                            <span className="mt-1 block border-t border-black/5 pt-1 text-[12.5px] leading-snug break-words whitespace-pre-wrap text-[#667781]">
                              {caption}
                            </span>
                          </>
                        ) : (
                          <span className="break-words whitespace-pre-wrap">{caption}</span>
                        ))}
                      {trOn && trPending.has(m.id) && (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[#667781]">
                          <LoaderCircle className="size-3 animate-spin" /> 正在翻译…
                        </span>
                      )}
                      <span
                        className={cn(
                          "float-right ml-2.5 inline-flex translate-y-1 items-center gap-0.5 text-[11px] text-[#667781] tabular-nums",
                          !caption && "mt-1",
                        )}
                      >
                        {m.starred && <Star className="size-3 fill-current" aria-label="星标" />}
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
                  </ContextActions>
                </div>
              </Fragment>
            );
          })}
          <div className="h-1" />
        </div>

        {!atBottom && (
          <button
            type="button"
            onClick={toBottom}
            aria-label="回到最新消息"
            className="absolute right-5 bottom-24 z-10 flex size-10 items-center justify-center rounded-full bg-white text-[#54656f] shadow-md ring-1 ring-black/5 transition hover:bg-[#f5f6f6]"
          >
            <ChevronDown className="size-5" />
          </button>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-emerald-50/85 backdrop-blur-[1px]">
            <div className="rounded-2xl border-2 border-dashed border-emerald-500 px-10 py-8 text-center text-emerald-800">
              <Paperclip className="mx-auto mb-2 size-7" />
              <p className="font-medium">松开发送给 {title}</p>
              <p className="mt-1 text-xs text-emerald-700/80">图片、视频、PDF 等文件，单个不超过 45MB</p>
            </div>
          </div>
        )}

        <footer className="space-y-2 border-t border-border/70 bg-[#f7f8fa] px-3 py-3 sm:px-4">
          {!connected && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700">
              <AlertCircle className="size-3.5" /> WhatsApp 未连接，消息暂时发不出去。
            </p>
          )}
          {canAi && <AiWriter channel="whatsapp" compact original={lastIncoming || undefined} getDraft={() => text} onApply={setText} />}
          {trFrom && (
            <div className="flex items-center gap-2 rounded-xl bg-primary/5 px-3 py-1.5 text-xs ring-1 ring-primary/20">
              <Languages className="size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-foreground/80">
                已译成 {trFrom.lang}，看一下再按发送 · 原文：{trFrom.zh}
              </span>
              <button
                type="button"
                className="shrink-0 font-medium text-primary hover:underline"
                onClick={() => {
                  setText(trFrom.zh);
                  setTrFrom(null);
                }}
              >
                改回中文
              </button>
            </div>
          )}
          {replyTo && (
            <div className="flex items-stretch gap-2 rounded-xl bg-card p-1.5 shadow-xs ring-1 ring-border/70">
              <div
                className={cn(
                  "min-w-0 flex-1 rounded-lg border-l-4 bg-muted/60 px-2.5 py-1.5",
                  replyTo.fromMe ? "border-emerald-600" : "border-violet-500",
                )}
              >
                <p className={cn("text-xs font-medium", replyTo.fromMe ? "text-emerald-700" : "text-violet-600")}>
                  回复 {replyTo.fromMe ? "你自己" : title}
                </p>
                <p className="truncate text-[13px] text-muted-foreground">{snippet(replyTo, 140) || "消息"}</p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                className="self-center"
                onClick={() => setReplyTo(null)}
                aria-label="取消回复"
                title="取消回复（Esc）"
              >
                <X />
              </Button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <DropdownActions
              items={attachMenu}
              align="start"
              trigger={
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-10 shrink-0 rounded-full text-muted-foreground"
                  aria-label="附件"
                  title="发送图片、文件、商品、报价单"
                >
                  <Plus className="size-5" />
                </Button>
              }
            />
            <div className="flex min-w-0 flex-1 items-end rounded-3xl bg-card px-4 py-2 shadow-xs ring-1 ring-border/70 focus-within:ring-primary/40">
              <textarea
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={1}
                className="field-sizing-content max-h-40 min-h-6 w-full resize-none bg-transparent text-[14.5px] leading-6 outline-none placeholder:text-muted-foreground"
                placeholder={canAi && outTr ? "用中文写，发送前自动译成客户的语言" : "输入消息"}
                title="Enter 发送，Shift+Enter 换行，可直接粘贴图片"
                aria-label="消息"
                onPaste={(e) => {
                  if (e.clipboardData.files.length) {
                    e.preventDefault();
                    addFiles(e.clipboardData.files);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && replyTo) {
                    e.preventDefault();
                    setReplyTo(null);
                  }
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {canAi && (
                <button
                  type="button"
                  onClick={toggleOutTr}
                  aria-pressed={outTr}
                  title="开启后，用中文写的消息会先按客户的语言翻译好放回输入框，确认后再发送"
                  className={cn(
                    "mb-0.5 ml-2 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap transition-colors",
                    outTr ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  中→外
                </button>
              )}
            </div>
            <Button
              onClick={send}
              disabled={sending || translating || !text.trim()}
              size="icon"
              className="size-10 shrink-0 rounded-full"
              aria-label={willTranslate ? "翻译" : "发送"}
              title={willTranslate ? "先译成客户的语言（不会直接发出）" : "发送"}
            >
              {sending || translating ? <LoaderCircle className="animate-spin" /> : willTranslate ? <Languages /> : <Send />}
            </Button>
          </div>
          <input
            ref={photoInput}
            type="file"
            hidden
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </footer>
      </section>

      <aside className="hidden w-[22rem] shrink-0 flex-col border-l border-border/70 bg-muted/20 xl:flex">{panelEl}</aside>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-sm">
          <SheetTitle className="sr-only">客户面板</SheetTitle>
          {sheet && panelEl}
        </SheetContent>
      </Sheet>

      <LinkChatDialog chatId={chat.id} open={linking} onOpenChange={setLinking} current={chat.customer?.name} />
      <ForwardDialog msg={forwarding} onClose={() => setForwarding(null)} currentChat={chat.id} />
      <SendFilesDialog
        key={files.map((f) => f.name + f.size).join("|")}
        files={files}
        title={title}
        replyTo={replyTo}
        onClose={() => setFiles([])}
        onSent={() => {
          setFiles([]);
          setReplyTo(null);
          router.refresh();
        }}
        chatId={chat.id}
      />
      <Dialog open={!!reminding} onOpenChange={(v) => !v && setReminding(null)}>
        <DialogContent className="sm:max-w-lg">
          {reminding && (
            <TaskForm
              tz={tz}
              context="whatsapp"
              customerId={chat.customer?.id}
              link={`/whatsapp?chat=${chat.id}`}
              subject={`${chat.customer ? "" : `${title}：`}「${snippet(reminding, 40)}」`}
              onDone={() => setReminding(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <WaLightbox
        images={lightbox?.images ?? []}
        index={lightbox?.index ?? null}
        onIndex={(i) => setLightbox((l) => (l ? { ...l, index: i } : l))}
        onClose={() => setLightbox(null)}
      />
    </>
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

/** 转发：选最多 5 个聊天 */
function ForwardDialog({ msg, onClose, currentChat }: { msg: Msg | null; onClose: () => void; currentChat: string }) {
  return (
    <Dialog open={!!msg} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>{msg && <ForwardBody msg={msg} onClose={onClose} currentChat={currentChat} />}</DialogContent>
    </Dialog>
  );
}

function ForwardBody({ msg, onClose, currentChat }: { msg: Msg; onClose: () => void; currentChat: string }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listChatsAction>>>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => setRows(await listChatsAction(q)), 200);
    return () => clearTimeout(t);
  }, [q]);
  const toggle = (id: string) =>
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      if (p.length >= 5) {
        toast.info("一次最多转发给 5 个聊天");
        return p;
      }
      return [...p, id];
    });
  return (
    <>
      <DialogHeader>
        <DialogTitle>转发消息</DialogTitle>
        <DialogDescription className="line-clamp-2">「{snippet(msg, 100) || "消息"}」</DialogDescription>
      </DialogHeader>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索姓名、号码、客户" />
      <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
        {rows.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">没有找到聊天</li>}
        {rows.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted">
              <Checkbox checked={picked.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {c.name || (c.phone ? `+${c.phone}` : "未知号码")}
                {c.id === currentChat && <span className="ml-1 text-xs font-normal text-muted-foreground">（当前）</span>}
              </span>
              {c.customer && <span className="max-w-32 shrink-0 truncate text-xs text-primary">{c.customer.name}</span>}
            </label>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button
          disabled={!picked.length || busy}
          onClick={async () => {
            setBusy(true);
            const r = await runAction(forwardWaMessageAction(msg.id, picked));
            setBusy(false);
            if (r.ok) onClose();
          }}
        >
          <Forward /> 转发{picked.length ? `（${picked.length}）` : ""}
        </Button>
      </DialogFooter>
    </>
  );
}

/** 选好 / 拖进 / 粘贴的文件：预览 + 说明文字，确认后上传并发送 */
function SendFilesDialog({
  files,
  title,
  chatId,
  replyTo,
  onClose,
  onSent,
}: {
  files: File[];
  title: string;
  chatId: string;
  replyTo: Msg | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const urls = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : "")), [files]);
  useEffect(() => () => urls.forEach((x) => x && URL.revokeObjectURL(x)), [urls]);

  async function sendAll() {
    for (const [i, f] of files.entries()) {
      setBusy(`${i + 1}/${files.length}`);
      const res = await fetch("/api/upload/wa", {
        method: "POST",
        headers: { "content-type": f.type || "application/octet-stream", "x-file-name": encodeURIComponent(f.name) },
        body: f,
      }).catch(() => null);
      const j = res
        ? ((await res.json().catch(() => ({}))) as { key?: string; mime?: string; name?: string; size?: number; error?: string })
        : { error: "网络错误" };
      if (!res?.ok || !j.key) {
        toast.error(`「${f.name}」上传失败：${j.error ?? "请重试"}`);
        setBusy(null);
        return;
      }
      const r = await sendWaMediaAction(
        chatId,
        { key: j.key, mime: j.mime!, name: j.name!, size: j.size! },
        i === 0 ? caption : "",
        i === 0 ? replyTo?.id : null,
      );
      if (!r.ok) {
        toast.error(r.message ?? "发送失败");
        setBusy(null);
        return;
      }
    }
    setBusy(null);
    onSent();
  }

  const single = files.length === 1 ? files[0] : null;
  return (
    <Dialog open={files.length > 0} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>发送给 {title}</DialogTitle>
          <DialogDescription>
            {files.length > 1 ? `${files.length} 个文件，说明文字附在第一个上` : "图片和视频会直接显示在对方聊天里"}
          </DialogDescription>
        </DialogHeader>
        {single && urls[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- 本地预览
          <img src={urls[0]} alt="" className="mx-auto max-h-80 rounded-lg object-contain" />
        ) : (
          <ul className={cn("grid gap-2", files.length > 1 ? "grid-cols-3" : "grid-cols-1")}>
            {files.map((f, i) => (
              <li
                key={i}
                className="flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-lg bg-muted p-2 text-center"
              >
                {urls[i] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 本地预览
                  <img src={urls[i]} alt="" className="size-full rounded object-cover" />
                ) : (
                  <>
                    <FileText className="size-7 text-muted-foreground" />
                    <span className="line-clamp-2 text-[11px] break-all">{f.name}</span>
                    <span className="text-[11px] text-muted-foreground">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <Input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="添加说明（可选）"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && !busy) {
              e.preventDefault();
              void sendAll();
            }
          }}
          autoFocus
        />
        <DialogFooter>
          <Button onClick={sendAll} disabled={!!busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Send />}
            {busy ? `发送中 ${files.length > 1 ? busy : ""}` : "发送"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
