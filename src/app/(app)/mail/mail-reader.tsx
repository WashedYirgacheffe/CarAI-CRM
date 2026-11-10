"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronDown,
  Download,
  Forward,
  Languages,
  LoaderCircle,
  Reply,
  ReplyAll,
  RotateCw,
  Sparkles,
  Star,
  UserPlus,
  Link2,
  MailOpen,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runAction } from "@/hooks/use-action-form";
import { formatDateTime } from "@/lib/crm";
import { MAIL_INTENT_LABELS, MAIL_PRIORITY_LABELS } from "@/lib/mail";
import { QuickReminder } from "@/components/crm/tasks";
import { looksForeign } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { streamAiWrite } from "@/components/ai/stream-write";
import {
  analyzeMailAction,
  linkMailAction,
  mailToLeadAction,
  searchCustomersAction,
  setMailDoneAction,
  setSeenAction,
  setStarredAction,
} from "./actions";
import { useHotkeys } from "@/hooks/use-hotkeys";

type Addr = { name?: string | null; address: string };

export type ReaderMessage = {
  id: string;
  folder: "INBOX" | "SENT";
  accountEmail: string;
  fromAddr: string;
  fromName: string | null;
  to: Addr[];
  cc: Addr[];
  subject: string;
  text: string | null;
  html: string | null;
  date: string;
  seen: boolean;
  starred: boolean;
  attachments: { id: string; filename: string; size: number }[];
  customer: { id: string; name: string } | null;
  lead: { id: string; status: string } | null;
  aiSummary: string | null;
  aiIntent: string | null;
  aiPriority: string | null;
  /** 从系统发出、带追踪的邮件才有 */
  track?: {
    openCount: number;
    openedAt: string | null;
    lastOpenAt: string | null;
    clickCount: number;
    bouncedAt: string | null;
    events: { type: string; url: string | null; at: string }[];
  } | null;
};

const fmtAddr = (a: Addr) => (a.name ? `${a.name} <${a.address}>` : a.address);

/** 正文（没有纯文本就从 HTML 里取字） */
function bodyText(m: { text: string | null; html: string | null }) {
  if (m.text?.trim()) return m.text;
  if (!m.html || typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(m.html, "text/html");
  doc.querySelectorAll("style,script,head").forEach((n) => n.remove());
  return (doc.body.textContent ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** 只翻译对方这次写的：去掉引用的历史邮件 */
function freshPart(text: string) {
  const cut = text.search(/^(>|On .{4,200}wrote:|-{2,}\s*Original Message|From: .+\n(Sent|Date): |发件人[:：]|在 .{4,80}写道[:：])/im);
  return (cut > 40 ? text.slice(0, cut) : text).trim().slice(0, 6000);
}

const TR_KEY = "crm-mail-tr";
function cachedTranslation(id: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(TR_KEY) ?? "{}") as Record<string, string>)[id] ?? null;
  } catch {
    return null;
  }
}
function cacheTranslation(id: string, text: string) {
  try {
    const all = JSON.parse(localStorage.getItem(TR_KEY) ?? "{}") as Record<string, string>;
    delete all[id];
    all[id] = text;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete all[k];
    localStorage.setItem(TR_KEY, JSON.stringify(all));
  } catch {}
}

function sizeLabel(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function MailReader({
  message: m,
  tz,
  backHref,
  canAi,
  canLead,
}: {
  message: ReaderMessage;
  tz: string;
  backHref: string;
  canAi: boolean;
  canLead: boolean;
}) {
  const router = useRouter();
  const [starred, setStarred] = useState(m.starred);
  const [analyzing, setAnalyzing] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showTr, setShowTr] = useState(true);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (!m.seen) void setSeenAction(m.id, true);
    // 只在打开时标已读；之后手动「标为未读」不要又被标回来
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);

  const toggleStar = () => {
    setStarred(!starred);
    void setStarredAction(m.id, !starred);
  };
  const markUnread = async () => {
    const r = await runAction(setSeenAction(m.id, false));
    if (r.ok) router.push(backHref, { scroll: false });
  };
  // 阅读区快捷键（列表切换 j/k 在 MailShortcuts）
  useHotkeys({
    r: () => router.push(`/mail/compose?reply=${m.id}`),
    a: () => router.push(`/mail/compose?reply=${m.id}&all=1`),
    f: () => router.push(`/mail/compose?forward=${m.id}`),
    s: toggleStar,
    u: () => void markUnread(),
    e: () => void runAction(setMailDoneAction(m.id, true)),
  });

  async function analyze(manual: boolean) {
    setAnalyzing(true);
    const r = manual ? await runAction(analyzeMailAction(m.id)) : await analyzeMailAction(m.id);
    setAnalyzing(false);
    if (r.ok) router.refresh();
  }

  async function translate() {
    const src = freshPart(bodyText(m));
    if (!src) return;
    setShowTr(true);
    setTranslating(true);
    const r = await streamAiWrite({ mode: "translate", draft: src, language: "简体中文", channel: "email" }, setTranslation);
    setTranslating(false);
    if (r.ok) {
      setTranslation(r.text);
      cacheTranslation(m.id, r.text);
    } else {
      setTranslation(null);
      toast.error(r.message);
    }
  }

  // 打开收到的邮件：还没分析就分析，外文就直接翻译，不用再点按钮
  useEffect(() => {
    if (!canAi || m.folder !== "INBOX") return;
    const t = setTimeout(() => {
      if (!m.aiSummary) void analyze(false);
      const cached = cachedTranslation(m.id);
      if (cached) setTranslation(cached);
      else if (looksForeign(bodyText(m))) void translate();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const srcDoc = useMemo(() => {
    if (!m.html) return null;
    return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2328;margin:0;padding:4px 2px;word-break:break-word}img{max-width:100%;height:auto}blockquote{border-left:3px solid #d0d7de;margin:0 0 0 4px;padding-left:10px;color:#57606a}</style></head><body>${m.html.replace(/<img[^>]+\/api\/t\/o\/[^>]*>/g, "")}</body></html>`;
  }, [m.html]);

  const intent = m.aiIntent ? MAIL_INTENT_LABELS[m.aiIntent] : null;
  const priority = m.aiPriority ? MAIL_PRIORITY_LABELS[m.aiPriority] : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-2 md:px-3">
        <Button asChild variant="ghost" size="icon-sm" className="lg:hidden" aria-label="返回列表">
          <Link href={backHref}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/mail/compose?reply=${m.id}`} title="回复（r）">
            <Reply /> 回复
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/mail/compose?reply=${m.id}&all=1`} title="回复全部（a）">
            <ReplyAll /> <span className="max-sm:sr-only">回复全部</span>
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/mail/compose?forward=${m.id}`} title="转发（f）">
            <Forward /> <span className="max-sm:sr-only">转发</span>
          </Link>
        </Button>
        <span className="ml-auto flex items-center gap-1">
          <QuickReminder
            tz={tz}
            context="mail"
            customerId={m.customer?.id}
            link={`/mail?box=${m.folder === "SENT" ? "sent" : "inbox"}&id=${m.id}`}
            subject={m.subject ? `「${m.subject.slice(0, 40)}」` : undefined}
            variant="ghost"
            className="max-sm:px-2"
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={starred ? "取消星标" : "加星标"}
            title={starred ? "取消星标（s）" : "加星标（s）"}
            onClick={toggleStar}
          >
            <Star className={cn(starred && "fill-amber-400 text-amber-400")} />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="标为未读" title="标为未读（u）" onClick={markUnread}>
            <MailOpen />
          </Button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 border-b px-4 py-4 md:px-5">
          <h2 className="text-lg font-semibold">{m.subject || "(无主题)"}</h2>
          <div className="space-y-0.5 text-sm break-words">
            <p>
              <span className="font-medium">{m.fromName || m.fromAddr}</span> <span className="text-muted-foreground">&lt;{m.fromAddr}&gt;</span>
              <span className="float-right text-xs text-muted-foreground tabular-nums">{formatDateTime(m.date, tz)}</span>
            </p>
            <p className="text-xs text-muted-foreground">收件人：{m.to.map(fmtAddr).join(", ") || "—"}</p>
            {m.cc.length > 0 && <p className="text-xs text-muted-foreground">抄送：{m.cc.map(fmtAddr).join(", ")}</p>}
          </div>

          {m.track && <TrackPanel track={m.track} tz={tz} />}

          {/* 归档 */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {m.customer ? (
              <Link
                href={`/customers/${m.customer.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs hover:text-primary"
              >
                已归档到客户：{m.customer.name}
              </Link>
            ) : (
              <>
                {m.lead ? (
                  <Link
                    href={`/leads?q=${encodeURIComponent(m.fromAddr)}&tab=all`}
                    className="rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                  >
                    已建为线索，去处理
                  </Link>
                ) : (
                  canLead &&
                  m.folder === "INBOX" && (
                    <Button size="xs" variant="outline" onClick={() => runAction(mailToLeadAction(m.id))}>
                      <UserPlus /> 建为线索
                    </Button>
                  )
                )}
                <Button size="xs" variant="outline" onClick={() => setLinking(true)}>
                  <Link2 /> 归档到客户
                </Button>
              </>
            )}
          </div>

          {/* AI：打开就自动分析、外文自动翻译 */}
          {canAi && m.folder === "INBOX" && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/70 px-3.5 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="size-4 text-violet-600" />
                <span className="text-xs font-semibold text-violet-700">AI 摘要</span>
                {priority && m.aiPriority !== "low" && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      m.aiPriority === "high" ? "bg-rose-500 text-white" : "bg-amber-100 text-amber-800",
                    )}
                  >
                    {m.aiPriority === "high" ? "高优先 · 尽快回复" : "中优先"}
                  </span>
                )}
                {intent && <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", intent.cls)}>{intent.label}</span>}
                <span className="ml-auto flex gap-1">
                  {m.aiSummary && !analyzing && (
                    <Button size="icon-xs" variant="ghost" onClick={() => void analyze(true)} aria-label="重新分析" title="重新分析">
                      <RotateCw />
                    </Button>
                  )}
                  {!translation && !translating && bodyText(m) && (
                    <Button size="xs" variant="ghost" onClick={translate}>
                      <Languages /> 翻译成中文
                    </Button>
                  )}
                </span>
              </div>
              {analyzing && !m.aiSummary ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" /> AI 正在读这封邮件…
                </p>
              ) : (
                m.aiSummary && <p className="mt-1 leading-relaxed text-foreground/90">{m.aiSummary}</p>
              )}
            </div>
          )}
          {!canAi && m.aiSummary && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/70 px-3.5 py-2.5 text-sm">
              <span className="text-xs font-semibold text-violet-700">AI 摘要</span>
              <p className="mt-1 text-foreground/90">{m.aiSummary}</p>
            </div>
          )}
          {(translation || translating) && (
            <div className="rounded-xl border bg-muted/40 px-3.5 py-2.5 text-sm">
              <button
                type="button"
                onClick={() => setShowTr(!showTr)}
                className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground"
              >
                <Languages className="size-3.5" /> 中文译文
                {translating && <LoaderCircle className="size-3.5 animate-spin" />}
                <ChevronDown className={cn("ml-auto size-4 transition-transform", !showTr && "-rotate-90")} />
              </button>
              {showTr && <p className="mt-1.5 leading-relaxed whitespace-pre-wrap">{translation || "翻译中…"}</p>}
            </div>
          )}
        </div>

        <div className="px-4 py-4 md:px-5">
          {srcDoc ? (
            <iframe
              title="邮件正文"
              srcDoc={srcDoc}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              className="h-[60vh] w-full rounded border-0 bg-white"
            />
          ) : (
            <pre className="font-sans text-sm whitespace-pre-wrap">{m.text || "（没有正文）"}</pre>
          )}
        </div>

        {m.attachments.length > 0 && (
          <div className="border-t px-4 py-3 md:px-5">
            <p className="mb-2 text-xs text-muted-foreground">附件（{m.attachments.length}）</p>
            <div className="flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <a
                  key={a.id}
                  href={`/api/mail/attachments/${m.id}/${a.id}`}
                  className="inline-flex max-w-xs items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  <Download className="size-3.5 shrink-0" />
                  <span className="truncate">{a.filename}</span>
                  <span className="shrink-0 text-muted-foreground">{sizeLabel(a.size)}</span>
                </a>
              ))}
            </div>
          </div>
        )}
        {/* 读完就能回：不用回到顶部找按钮 */}
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-4 md:px-5">
          <Button asChild>
            <Link href={`/mail/compose?reply=${m.id}`}>
              <Reply /> 回复{m.folder === "INBOX" ? ` ${m.fromName || m.fromAddr}` : ""}
            </Link>
          </Button>
          {canAi && m.folder === "INBOX" && (
            <Button
              variant="outline"
              onClick={() => window.dispatchEvent(new CustomEvent("crm:ai-ask", { detail: { message: "帮我起草这封邮件的回复" } }))}
            >
              <Sparkles className="text-violet-600" /> 让 AI 起草回复
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href={`/mail/compose?forward=${m.id}`}>
              <Forward /> 转发
            </Link>
          </Button>
        </div>
      </div>

      <Dialog open={linking} onOpenChange={setLinking}>
        <DialogContent>
          {linking && (
            <LinkCustomer
              messageId={m.id}
              hint={m.folder === "INBOX" ? m.fromAddr.split("@")[1] : m.to[0]?.address.split("@")[1]}
              onDone={() => setLinking(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LinkCustomer({ messageId, hint, onDone }: { messageId: string; hint?: string; onDone: () => void }) {
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
        <DialogTitle>归档到客户</DialogTitle>
        <DialogDescription>对方邮箱会加为该客户的联系人，以后和他的往来邮件自动归档。{hint && `（对方域名：${hint}）`}</DialogDescription>
      </DialogHeader>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索客户名称、域名、联系人邮箱" />
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
                const r = await runAction(linkMailAction(messageId, c.id));
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

function TrackPanel({ track: t, tz }: { track: NonNullable<ReaderMessage["track"]>; tz: string }) {
  const tone = t.bouncedAt ? "border-rose-200 bg-rose-50/60" : t.openCount ? "border-emerald-200 bg-emerald-50/60" : "border-border bg-muted/40";
  return (
    <div className={cn("rounded-lg border px-3 py-2 text-sm", tone)}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{t.bouncedAt ? "退信，对方没有收到" : t.openCount ? `对方已打开 ${t.openCount} 次` : "对方还没打开"}</span>
        {t.openedAt && <span className="text-xs text-muted-foreground">首次 {formatDateTime(t.openedAt, tz)}</span>}
        {t.lastOpenAt && t.openCount > 1 && <span className="text-xs text-muted-foreground">最近 {formatDateTime(t.lastOpenAt, tz)}</span>}
        {t.clickCount > 0 && <span className="text-xs text-muted-foreground">点击链接 {t.clickCount} 次</span>}
      </p>
      {t.events.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
          {t.events.slice(0, 6).map((e, i) => (
            <li key={i} className="truncate tabular-nums">
              {formatDateTime(e.at, tz)} · {e.type === "click" ? `点击 ${e.url}` : "打开"}
            </li>
          ))}
        </ul>
      )}
      {!t.bouncedAt && !t.openCount && <p className="mt-1 text-xs text-muted-foreground">部分邮箱默认不加载图片，没打开不代表没看。</p>}
    </div>
  );
}
