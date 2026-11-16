"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  Building2,
  ChevronLeft,
  CircleAlert,
  Clock,
  ExternalLink,
  Languages,
  Link2Off,
  LoaderCircle,
  MessageSquareText,
  MoreVertical,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  UserPlus,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownActions, type MenuEntry } from "@/components/crm/action-menu";
import { SocialIcon } from "@/components/crm/social-icon";
import { runAction } from "@/hooks/use-action-form";
import { searchCustomersAction } from "@/app/(app)/mail/actions";
import { fillQuickReply, isChineseLang, langName, SOCIAL_MSG_STATUS } from "@/lib/inbox";
import { matrixPlatform } from "@/lib/matrix";
import { waClock, waDayKey, waDayLabel, waListTime } from "@/lib/wa-time";
import { cn } from "@/lib/utils";
import {
  archiveThreadAction,
  assignThreadAction,
  deleteFailedMessageAction,
  linkThreadAction,
  markThreadReadAction,
  retrySocialMessageAction,
  sendSocialReplyAction,
  syncThreadAccountAction,
  threadToLeadAction,
  unlinkThreadAction,
} from "./actions";

export type QuickReplyItem = { id: string; group: string | null; title: string; body: string; shared: boolean };

export type ThreadData = {
  id: string;
  platform: string;
  peerName: string;
  peerHandle: string | null;
  peerUrl: string | null;
  peerLang: string | null;
  archived: boolean;
  unread: number;
  leadId: string | null;
  customer: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  account: { name: string; status: string; inboxSync: boolean; syncedAt: string | null };
  messages: {
    id: string;
    fromMe: boolean;
    type: string;
    body: string;
    translation: string | null;
    status: string;
    error: string | null;
    at: string;
  }[];
  quickReplies: QuickReplyItem[];
  vars: { customer: string | null; contact: string | null; me: string; company: string | null };
};

// ── 轮询：有变化才刷新 ──

export function InboxLive({ thread }: { thread?: string }) {
  const router = useRouter();
  useEffect(() => {
    const url = `/api/inbox/stamp${thread ? `?t=${encodeURIComponent(thread)}` : ""}`;
    let last: string | null = null;
    let busy = false;
    const check = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (r.ok) {
          const { s } = (await r.json()) as { s: string };
          if (last !== null && s !== last) router.refresh();
          last = s;
        }
      } catch {
        // 下一轮再问
      } finally {
        busy = false;
      }
    };
    void check();
    const t = setInterval(check, thread ? 5000 : 15000);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, thread]);
  return null;
}

/** 列表上方的下拉筛选（改地址栏参数） */
export function InboxSelect({ param, value, label, options }: { param: string; value: string; label: string; options: { value: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        const u = new URLSearchParams(sp);
        if (e.target.value) u.set(param, e.target.value);
        else u.delete(param);
        u.delete("t");
        router.push(`${pathname}${u.size ? `?${u}` : ""}`);
      }}
      className={cn(
        "h-6 max-w-36 truncate rounded-full border-0 bg-muted/70 px-2 text-xs outline-none focus:ring-1 focus:ring-primary/40",
        value ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ── 会话 ──

export function ThreadView({
  data,
  tz,
  backHref,
  members,
  canAssign,
  canLead,
}: {
  data: ThreadData;
  tz: string;
  backHref: string;
  members: { id: string; name: string }[];
  canAssign: boolean;
  canLead: boolean;
}) {
  const router = useRouter();
  const [linkOpen, setLinkOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const label = matrixPlatform(data.platform)?.label ?? data.platform;
  const foreign = !!data.peerLang && !isChineseLang(data.peerLang);

  // 打开就算已读
  useEffect(() => {
    if (data.unread > 0) void markThreadReadAction(data.id).then(() => router.refresh());
  }, [data.id, data.unread, router]);

  const items: MenuEntry[] = [
    { label: data.customer ? "更换关联客户" : "关联到客户", icon: Building2, onSelect: () => setLinkOpen(true) },
    { label: "取消关联客户", icon: Link2Off, hidden: !data.customer, onSelect: () => void runAction(unlinkThreadAction(data.id)) },
    { label: "建为线索", icon: UserPlus, hidden: !canLead || !!data.leadId || !!data.customer, onSelect: () => void runAction(threadToLeadAction(data.id)) },
    { label: "转给同事", icon: ArrowRightLeft, hidden: !canAssign, onSelect: () => setAssignOpen(true) },
    "sep",
    { label: "立即同步", icon: RefreshCw, onSelect: () => void runAction(syncThreadAccountAction(data.id)) },
    {
      label: data.archived ? "移回收件箱" : "归档",
      icon: data.archived ? ArchiveRestore : Archive,
      onSelect: () => void runAction(archiveThreadAction(data.id, !data.archived)).then((r) => r.ok && !data.archived && router.push(backHref)),
    },
  ];

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5 md:px-4">
        <Button asChild variant="ghost" size="icon" className="md:hidden" aria-label="返回">
          <Link href={backHref}>
            <ChevronLeft />
          </Link>
        </Button>
        <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
          {data.peerName.slice(0, 1).toUpperCase()}
          <SocialIcon platform={data.platform} className="absolute -right-0.5 -bottom-0.5 size-4.5 rounded-full bg-card p-0.5 ring-1 ring-border" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-medium">
            <span className="truncate">{data.peerName}</span>
            {data.peerUrl && (
              <a href={data.peerUrl} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="打开对方主页">
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </p>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {data.peerHandle && <span className="truncate">{data.peerHandle.startsWith("@") ? data.peerHandle : `@${data.peerHandle}`}</span>}
            <span className="truncate">
              {label} · {data.account.name}
            </span>
            {data.assignee && <span className="truncate">· 负责人 {data.assignee.name}</span>}
          </p>
        </div>
        {data.customer ? (
          <Link
            href={`/customers/${data.customer.id}`}
            className="hidden max-w-40 items-center gap-1 truncate rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 sm:inline-flex dark:bg-emerald-950 dark:text-emerald-300"
          >
            <Building2 className="size-3.5 shrink-0" />
            <span className="truncate">{data.customer.name}</span>
          </Link>
        ) : (
          <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => setLinkOpen(true)}>
            <Building2 />
            关联客户
          </Button>
        )}
        <DropdownActions
          items={items}
          trigger={
            <Button variant="ghost" size="icon" aria-label="更多操作">
              <MoreVertical />
            </Button>
          }
        />
      </header>

      {data.account.status !== "active" ? (
        <Notice tone="warn">这个账号已掉线，收发私信都停了。去社媒矩阵重新登录后恢复。</Notice>
      ) : !data.account.inboxSync ? (
        <Notice>这个账号没开「收私信」，新消息不会自动进来。可以在社媒矩阵的账号菜单里开启。</Notice>
      ) : null}

      <Messages data={data} tz={tz} />

      <Composer data={data} foreign={foreign} disabled={data.account.status !== "active"} />

      <LinkCustomerDialog threadId={data.id} open={linkOpen} onOpenChange={setLinkOpen} current={data.customer?.name} />
      <AssignDialog threadId={data.id} open={assignOpen} onOpenChange={setAssignOpen} members={members} current={data.assignee?.id} />
    </section>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 border-b px-4 py-2 text-xs",
        tone === "warn"
          ? "border-amber-200/70 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
          : "border-border/70 bg-muted/40 text-muted-foreground",
      )}
    >
      <CircleAlert className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}

// ── 消息 ──

function Messages({ data, tz }: { data: ThreadData; tz: string }) {
  const ref = useRef<HTMLDivElement>(null);
  /** 显示原文的消息（默认外文消息显示译文在下面，我发的显示发出去的外文） */
  const [flip, setFlip] = useState<Set<string>>(new Set());
  const last = data.messages.at(-1)?.id;
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);

  if (!data.messages.length) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        还没有读到这个会话的消息{data.account.syncedAt ? `（上次同步 ${waListTime(data.account.syncedAt, tz)}）` : ""}
      </div>
    );
  }

  return (
    <div ref={ref} className="flex-1 overflow-y-auto bg-muted/30 px-3 py-4 md:px-6">
      <ul className="mx-auto flex max-w-3xl flex-col gap-1.5">
        {data.messages.map((m, i) => {
          const day = waDayKey(m.at, tz);
          const prev = data.messages[i - 1];
          const showDay = !prev || waDayKey(prev.at, tz) !== day;
          const tight = !showDay && prev && prev.fromMe === m.fromMe;
          const shown = flip.has(m.id);
          const toggle = () =>
            setFlip((s) => {
              const n = new Set(s);
              if (n.has(m.id)) n.delete(m.id);
              else n.add(m.id);
              return n;
            });
          return (
            <Fragment key={m.id}>
              {showDay && (
                <li className="my-2 self-center rounded-full bg-card px-3 py-0.5 text-[11px] text-muted-foreground shadow-xs ring-1 ring-border/60">
                  {waDayLabel(day, tz)}
                </li>
              )}
              <li className={cn("flex max-w-[85%] flex-col md:max-w-[70%]", m.fromMe ? "items-end self-end" : "items-start self-start", !tight && "mt-1.5")}>
                <div
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-xs",
                    m.fromMe ? "rounded-br-md bg-primary/12 text-foreground ring-1 ring-primary/15" : "rounded-bl-md bg-card ring-1 ring-border/60",
                    m.status === "failed" && "ring-destructive/40",
                  )}
                >
                  {m.type !== "text" && !m.body ? <span className="text-muted-foreground italic">[{m.type === "image" ? "图片" : m.type === "video" ? "视频" : "附件"}]</span> : m.body}
                  {m.translation && (
                    <div className="mt-1.5 border-t border-foreground/10 pt-1.5 text-[13px] text-muted-foreground">
                      {shown || !m.fromMe ? (
                        <>
                          <span className="mr-1 text-[11px] text-muted-foreground/70">{m.fromMe ? "原文" : "译文"}</span>
                          {m.translation}
                        </>
                      ) : (
                        <button type="button" onClick={toggle} className="text-[11px] hover:text-foreground">
                          查看中文原文
                        </button>
                      )}
                    </div>
                  )}
                  <span className="float-right mt-1 ml-3 inline-flex items-center gap-1 text-[10.5px] text-muted-foreground tabular-nums">
                    {m.fromMe && m.status !== "sent" && m.status !== "received" && (
                      <span className={cn("inline-flex items-center gap-0.5", m.status === "failed" && "text-destructive")}>
                        {m.status === "failed" ? <CircleAlert className="size-3" /> : <Clock className="size-3" />}
                        {SOCIAL_MSG_STATUS[m.status] ?? m.status}
                      </span>
                    )}
                    {waClock(m.at, tz)}
                  </span>
                </div>
                {m.status === "failed" && (
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-destructive">
                    <span className="truncate">{m.error ?? "发送失败"}</span>
                    <button type="button" className="inline-flex items-center gap-0.5 font-medium hover:underline" onClick={() => void runAction(retrySocialMessageAction(m.id))}>
                      <RotateCcw className="size-3" />
                      重发
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-destructive"
                      onClick={() => void runAction(deleteFailedMessageAction(m.id))}
                    >
                      <Trash2 className="size-3" />
                      删除
                    </button>
                  </div>
                )}
              </li>
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}

// ── 输入框 ──

function Composer({ data, foreign, disabled }: { data: ThreadData; foreign: boolean; disabled: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [translate, setTranslate] = useState(true);
  const [pick, setPick] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);

  // 输入以 / 开头：弹出快捷回复
  const slash = /^\/(\S*)$/.exec(text);
  const matches = useMemo(() => {
    if (!slash) return [];
    const q = slash[1].toLowerCase();
    return data.quickReplies.filter((r) => !q || r.title.toLowerCase().includes(q) || (r.group ?? "").toLowerCase().includes(q) || r.body.toLowerCase().includes(q)).slice(0, 8);
  }, [slash, data.quickReplies]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const use = (body: string) => {
    setText(fillQuickReply(body, data.vars));
    setPick(0);
    box.current?.focus();
  };

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const r = await sendSocialReplyAction(data.id, t, foreign && translate);
    setBusy(false);
    if (!r.ok) {
      const { toast } = await import("sonner");
      toast.error(r.message ?? "发送失败");
      return;
    }
    setText("");
    router.refresh();
  };

  return (
    <div className="relative border-t border-border/70 bg-card px-3 py-2.5 md:px-4">
      {slash && (
        <div className="absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-xl bg-popover shadow-lg ring-1 ring-foreground/10 md:inset-x-4">
          {matches.length ? (
            <ul className="max-h-64 overflow-y-auto p-1">
              {matches.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => use(r.body)}
                    onMouseEnter={() => setPick(i)}
                    className={cn("flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left", i === pick && "bg-accent")}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {r.group && <span className="rounded bg-muted px-1 text-[10.5px] font-normal text-muted-foreground">{r.group}</span>}
                      {r.title}
                      {!r.shared && <span className="text-[10.5px] font-normal text-muted-foreground">我的</span>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{r.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground">{data.quickReplies.length ? "没有匹配的快捷回复" : "还没有快捷回复，点左上方的「话术」添加"}</p>
          )}
        </div>
      )}
      {foreign && (
        <label className="mb-1.5 inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
          <input
            type="checkbox"
            className="accent-primary"
            checked={translate}
            onChange={(e) => setTranslate(e.target.checked)}
          />
          <Languages className="size-3.5" />
          发送前译成{langName(data.peerLang)}
        </label>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          rows={1}
          value={text}
          disabled={disabled || busy}
          onChange={(e) => {
            setText(e.target.value);
            setPick(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (slash && matches.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((p) => (p + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                use(matches[pick]?.body ?? matches[0].body);
                return;
              }
            }
            if (slash && e.key === "Escape") {
              setText("");
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={disabled ? "账号掉线，暂时不能回复" : "输入回复，Enter 发送，Shift+Enter 换行，输入 / 选快捷回复"}
          className="max-h-45 min-h-10 flex-1 resize-none rounded-2xl bg-muted/70 px-3.5 py-2.5 text-sm outline-none ring-1 ring-transparent transition placeholder:text-muted-foreground focus:bg-card focus:ring-primary/40 disabled:opacity-60"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="shrink-0 rounded-full text-muted-foreground"
          aria-label="快捷回复"
          disabled={disabled}
          onClick={() => {
            setText("/");
            box.current?.focus();
          }}
        >
          <MessageSquareText />
        </Button>
        <Button type="button" size="icon" className="shrink-0 rounded-full" aria-label="发送" disabled={disabled || busy || !text.trim() || !!slash} onClick={() => void send()}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Send />}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">消息排队后由运行器在「{data.account.name}」里模拟输入发出，通常 1～3 分钟。</p>
    </div>
  );
}

// ── 弹窗 ──

function LinkCustomerDialog({ threadId, open, onOpenChange, current }: { threadId: string; open: boolean; onOpenChange: (v: boolean) => void; current?: string | null }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; name: string; domain: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => setRows(await searchCustomersAction(q)), 200);
    return () => clearTimeout(t);
  }, [q, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{current ? "更换关联客户" : "关联到客户"}</DialogTitle>
          <DialogDescription>{current ? `当前关联「${current}」。` : ""}对方主页会记进客户的社媒档案，以后这个人的私信自动归到该客户。</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索客户名称、域名、邮箱" />
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {rows.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">没有找到客户</li>}
          {rows.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={busy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={async () => {
                  setBusy(true);
                  const r = await runAction(linkThreadAction(threadId, c.id));
                  setBusy(false);
                  if (r.ok) onOpenChange(false);
                }}
              >
                <Building2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{c.domain}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  threadId,
  open,
  onOpenChange,
  members,
  current,
}: {
  threadId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: { id: string; name: string }[];
  current?: string;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = members.filter((m) => m.id !== current && (!q || m.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>转给同事</DialogTitle>
          <DialogDescription>转交后对方会收到一条待办，这个会话从你的收件箱移到对方那里。</DialogDescription>
        </DialogHeader>
        {members.length ? (
          <>
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索同事" />
            <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {rows.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">没有可选的同事</li>}
              {rows.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={busy}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={async () => {
                      setBusy(true);
                      const r = await runAction(assignThreadAction(threadId, m.id));
                      setBusy(false);
                      if (r.ok) onOpenChange(false);
                    }}
                  >
                    <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium">{m.name.slice(0, 1)}</span>
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">只有管理者能选择同事转交。</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
