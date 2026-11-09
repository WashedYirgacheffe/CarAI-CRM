"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Download, Forward, Languages, Reply, ReplyAll, Sparkles, Star, UserPlus, Link2, MailOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runAction } from "@/hooks/use-action-form";
import { formatDateTime } from "@/lib/crm";
import { MAIL_INTENT_LABELS, MAIL_PRIORITY_LABELS } from "@/lib/mail";
import { cn } from "@/lib/utils";
import { aiWriteAction } from "@/app/(app)/ai/actions";
import { analyzeMailAction, linkMailAction, mailToLeadAction, searchCustomersAction, setSeenAction, setStarredAction } from "./actions";

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
};

const fmtAddr = (a: Addr) => (a.name ? `${a.name} <${a.address}>` : a.address);

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
  const [starred, setStarred] = useState(m.starred);
  const [analyzing, setAnalyzing] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (!m.seen) void setSeenAction(m.id, true);
  }, [m.id, m.seen]);

  const srcDoc = useMemo(() => {
    if (!m.html) return null;
    return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2328;margin:0;padding:4px 2px;word-break:break-word}img{max-width:100%;height:auto}blockquote{border-left:3px solid #d0d7de;margin:0 0 0 4px;padding-left:10px;color:#57606a}</style></head><body>${m.html}</body></html>`;
  }, [m.html]);

  const intent = m.aiIntent ? MAIL_INTENT_LABELS[m.aiIntent] : null;
  const priority = m.aiPriority ? MAIL_PRIORITY_LABELS[m.aiPriority] : null;

  async function translate() {
    setTranslating(true);
    const r = await aiWriteAction({ mode: "translate", draft: m.text ?? "", language: "简体中文", channel: "email" });
    setTranslating(false);
    if (r.ok) setTranslation(r.text);
    else toast.error(r.message);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-2 md:px-3">
        <Button asChild variant="ghost" size="icon-sm" className="lg:hidden" aria-label="返回列表">
          <Link href={backHref}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`/mail/compose?reply=${m.id}`}>
            <Reply /> 回复
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/mail/compose?reply=${m.id}&all=1`}>
            <ReplyAll /> <span className="max-sm:sr-only">回复全部</span>
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/mail/compose?forward=${m.id}`}>
            <Forward /> <span className="max-sm:sr-only">转发</span>
          </Link>
        </Button>
        <span className="ml-auto flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={starred ? "取消星标" : "加星标"}
            onClick={() => {
              setStarred(!starred);
              void setStarredAction(m.id, !starred);
            }}
          >
            <Star className={cn(starred && "fill-amber-400 text-amber-400")} />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="标为未读" title="标为未读" onClick={() => runAction(setSeenAction(m.id, false))}>
            <MailOpen />
          </Button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 border-b px-4 py-4 md:px-5">
          <h2 className="text-lg font-semibold">{m.subject || "(无主题)"}</h2>
          <div className="space-y-0.5 text-sm break-words">
            <p>
              <span className="font-medium">{m.fromName || m.fromAddr}</span>{" "}
              <span className="text-muted-foreground">&lt;{m.fromAddr}&gt;</span>
              <span className="float-right text-xs text-muted-foreground tabular-nums">{formatDateTime(m.date, tz)}</span>
            </p>
            <p className="text-xs text-muted-foreground">收件人：{m.to.map(fmtAddr).join(", ") || "—"}</p>
            {m.cc.length > 0 && <p className="text-xs text-muted-foreground">抄送：{m.cc.map(fmtAddr).join(", ")}</p>}
          </div>

          {/* 归档 */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {m.customer ? (
              <Link href={`/customers/${m.customer.id}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs hover:text-primary">
                已归档到客户：{m.customer.name}
              </Link>
            ) : (
              <>
                {m.lead ? (
                  <Link href={`/leads?q=${encodeURIComponent(m.fromAddr)}&tab=all`} className="rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
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

          {/* AI */}
          {(m.aiSummary || canAi) && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="size-3.5 text-violet-600" />
                <span className="text-xs font-medium text-violet-700">AI 摘要</span>
                {intent && <span className={cn("rounded border px-1.5 text-[11px]", intent.cls)}>{intent.label}</span>}
                {priority && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className={cn("size-1.5 rounded-full", priority.cls)} />
                    {priority.label}
                  </span>
                )}
                {canAi && (
                  <span className="ml-auto flex gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={analyzing}
                      onClick={async () => {
                        setAnalyzing(true);
                        await runAction(analyzeMailAction(m.id));
                        setAnalyzing(false);
                      }}
                    >
                      {analyzing ? "分析中…" : m.aiSummary ? "重新分析" : "分析这封邮件"}
                    </Button>
                    {m.text && (
                      <Button size="xs" variant="ghost" disabled={translating} onClick={translate}>
                        <Languages /> {translating ? "翻译中…" : "翻译成中文"}
                      </Button>
                    )}
                  </span>
                )}
              </div>
              {m.aiSummary && <p className="mt-1 text-foreground/90">{m.aiSummary}</p>}
            </div>
          )}
          {translation && (
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap">
              <p className="mb-1 text-xs font-medium text-muted-foreground">中文译文</p>
              {translation}
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
      </div>

      <Dialog open={linking} onOpenChange={setLinking}>
        <DialogContent>
          {linking && <LinkCustomer messageId={m.id} hint={m.folder === "INBOX" ? m.fromAddr.split("@")[1] : m.to[0]?.address.split("@")[1]} onDone={() => setLinking(false)} />}
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
