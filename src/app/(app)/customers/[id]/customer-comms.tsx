"use client";

import { WaMedia, waCaption, type WaMediaInfo } from "@/components/crm/wa-media";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, LoaderCircle, Paperclip, PenSquare, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { customerInsightAction } from "../ai-actions";
import { PaneEmpty, PaneToolbar, Panel } from "./detail-ui";

export type CustomerMailRow = {
  id: string;
  folder: "INBOX" | "SENT";
  peer: string;
  subject: string;
  snippet: string;
  text: string | null;
  date: string;
  attachments: { id: string; filename: string }[];
  mine: boolean;
};

export type CustomerWaRow = { id: string; fromMe: boolean; body: string; media: WaMediaInfo; timestamp: string; chatId: string; mine: boolean };

export function CustomerMails({ rows, tz, composeHref }: { rows: CustomerMailRow[]; tz: string; composeHref: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <PaneToolbar
        action={
          composeHref && (
            <Button size="sm" variant="outline" asChild>
              <Link href={composeHref}>
                <PenSquare /> 写邮件
              </Link>
            </Button>
          )
        }
      >
        {rows.length > 0 && <span className="tabular-nums">共 {rows.length} 封往来邮件，点击展开正文</span>}
      </PaneToolbar>
      {rows.length === 0 ? (
        <PaneEmpty>还没有往来邮件。绑定邮箱后，和该客户联系人的邮件会自动归档到这里。</PaneEmpty>
      ) : (
        <ul className="divide-y divide-border/70">
          {rows.map((m) => (
            <li key={m.id} className="py-2.5">
              <button type="button" className="w-full text-left" onClick={() => setOpen(open === m.id ? null : m.id)}>
                <div className="flex items-center gap-2 text-sm">
                  {m.folder === "SENT" ? (
                    <ArrowUpRight className="size-3.5 shrink-0 text-primary" aria-label="发出" />
                  ) : (
                    <ArrowDownLeft className="size-3.5 shrink-0 text-emerald-600" aria-label="收到" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{m.subject || "(无主题)"}</span>
                  {m.attachments.length > 0 && <Paperclip className="size-3 text-muted-foreground" />}
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDateTime(m.date, tz)}</span>
                </div>
                <p className="truncate pl-5 text-xs text-muted-foreground">
                  {m.peer} · {m.snippet}
                </p>
              </button>
              {open === m.id && (
                <div className="mt-2 ml-5 space-y-2 rounded-xl bg-muted/50 p-3">
                  <pre className="max-h-96 overflow-y-auto font-sans text-sm whitespace-pre-wrap">{m.text || m.snippet}</pre>
                  {m.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {m.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={`/api/mail/attachments/${m.id}/${a.id}`}
                          className="rounded-full bg-background px-2.5 py-0.5 text-xs ring-1 ring-border hover:bg-muted"
                        >
                          {a.filename}
                        </a>
                      ))}
                    </div>
                  )}
                  {m.mine && (
                    <div className="flex gap-2">
                      <Button size="xs" variant="outline" asChild>
                        <Link href={`/mail/compose?reply=${m.id}`}>回复</Link>
                      </Button>
                      <Button size="xs" variant="ghost" asChild>
                        <Link href={`/mail?id=${m.id}${m.folder === "SENT" ? "&box=sent" : ""}`}>在邮件中打开</Link>
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CustomerWhatsapp({ rows, tz, chatHref }: { rows: CustomerWaRow[]; tz: string; chatHref: string | null }) {
  return (
    <div>
      <PaneToolbar
        action={
          chatHref && (
            <Button size="sm" variant="outline" asChild>
              <Link href={chatHref}>打开聊天</Link>
            </Button>
          )
        }
      >
        {rows.length > 0 && <span className="tabular-nums">最近 {rows.length} 条 WhatsApp 消息</span>}
      </PaneToolbar>
      {rows.length === 0 ? (
        <PaneEmpty>还没有 WhatsApp 聊天记录。</PaneEmpty>
      ) : (
        <div className="max-h-[32rem] space-y-1.5 overflow-y-auto rounded-xl bg-[#efeae2]/50 p-3">
          {rows.map((m) => (
            <div key={m.id} className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[80%] rounded-lg px-2.5 py-1 text-sm shadow-xs", m.fromMe ? "bg-[#d9fdd3]" : "bg-white")}>
                <WaMedia id={m.id} media={m.media} />
                {waCaption(m.body, m.media) && <p className="whitespace-pre-wrap break-words">{waCaption(m.body, m.media)}</p>}
                <p className="text-right text-[10px] text-muted-foreground tabular-nums">{formatDateTime(m.timestamp, tz)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Insight = { content: string; createdAt: string } | null;

/** AI 面板：近况摘要（打开客户页后自动生成）+ 跟进建议 + 背景速览 */
type AiTab = "summary" | "next" | "brief";
const AI_TABS: [AiTab, string, string][] = [
  ["summary", "近况", "最近在聊什么、卡在哪、下一步做什么。"],
  ["next", "跟进建议", "根据跟进动态、往来邮件和聊天记录，给出下一步建议和可直接发送的话术。"],
  ["brief", "背景速览", "根据客户资料、域名和往来记录，概括客户画像、需求和合作进展。"],
];

export function CustomerAiPanel({
  customerId,
  summary,
  brief,
  next,
  freshAt,
  tz,
}: {
  customerId: string;
  summary: Insight;
  brief: Insight;
  next: Insight;
  /** 最近一次往来 / 跟进的时间：比它旧的摘要自动重新生成 */
  freshAt: string | null;
  tz: string;
}) {
  const [tab, setTab] = useState<AiTab>("summary");
  const [data, setData] = useState({ summary, brief, next });
  const [busy, setBusy] = useState<AiTab | null>(null);
  const tried = useRef(new Set<AiTab>());
  const cur = data[tab];
  const stale = (x: Insight) => !x || (!!freshAt && x.createdAt < freshAt);

  async function generate(which: AiTab, refresh: boolean) {
    setBusy(which);
    const r = await customerInsightAction(customerId, which, refresh);
    setBusy((b) => (b === which ? null : b));
    if (r.ok) setData((d) => ({ ...d, [which]: { content: r.content, createdAt: r.createdAt } }));
    else toast.error(r.message);
  }

  // 打开页面（或切到某个标签）后才去生成：没有或过时了才调 AI，每个标签只自动跑一次
  useEffect(() => {
    if (tried.current.has(tab) || !stale(data[tab])) return;
    // 记号放进定时器里：开发模式下 effect 会先跑一次再清掉，提前记会导致一次都不跑
    const t = setTimeout(() => {
      tried.current.add(tab);
      void generate(tab, !!data[tab]);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <Panel
      title="AI 助手"
      icon={
        <span className="flex size-6 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
          <Sparkles className="size-3.5" />
        </span>
      }
      action={
        cur && (
          <Button size="icon-sm" variant="ghost" aria-label="重新生成" title="重新生成" disabled={busy === tab} onClick={() => generate(tab, true)}>
            <RefreshCw className={busy === tab ? "animate-spin" : undefined} />
          </Button>
        )
      }
      bodyClassName="space-y-3"
    >
      <div className="flex gap-1 rounded-full bg-muted p-1 text-xs" role="tablist" aria-label="AI 助手内容">
        {AI_TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "flex-1 rounded-full px-2 py-1 transition-colors",
              tab === k ? "bg-background font-medium text-violet-700 shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {cur ? (
        <>
          <p className={cn("text-sm leading-relaxed whitespace-pre-wrap transition-opacity", busy === tab && "opacity-50")}>{cur.content}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {busy === tab ? "有新的往来，正在更新…" : `生成于 ${formatDateTime(cur.createdAt, tz)}`}
          </p>
        </>
      ) : busy === tab ? (
        <div className="space-y-2 py-1" aria-live="polite">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> AI 正在读这个客户的往来记录…
          </p>
          <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
        </div>
      ) : (
        <div className="space-y-2 py-2 text-center">
          <p className="text-xs text-muted-foreground">{AI_TABS.find((x) => x[0] === tab)![2]}</p>
          <Button size="sm" variant="outline" onClick={() => generate(tab, false)}>
            <Sparkles /> 生成
          </Button>
        </div>
      )}
    </Panel>
  );
}
