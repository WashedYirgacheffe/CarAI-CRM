"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArchiveRestore, Check, MoreHorizontal, Pencil, Pin, Plus, Trash2, TriangleAlert, Users, X } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { MEMORY_KINDS, type MemoryKind, type MemoryScope, type MemorySource } from "@/lib/ai-memory";
import { cn } from "@/lib/utils";
import {
  confirmMemoryAction,
  forgetMemoryAction,
  pinMemoryAction,
  promoteMemoryAction,
  restoreMemoryAction,
  reviewMemoryAction,
  saveMemoryAction,
} from "./actions";

export type MemoryItem = {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  title: string;
  content: string;
  source: MemorySource;
  trusted: boolean;
  confirmed: boolean;
  disputed: boolean;
  pinned: boolean;
  status: "active" | "proposed" | "archived";
  useCount: number;
  updatedAt: string;
  /** 多位同事都记过、系统提议成团队记忆的：几位 */
  promotedFrom: number;
  customer: { id: string; name: string } | null;
  mine: boolean;
  canEdit: boolean;
};

type Tab = "personal" | "customer" | "team" | "archived";

const EMPTY: Record<Tab, string> = {
  personal: "聊天时说「以后报价都用美元」「回复客户别太长」，AI 会自己记下来，以后照着做。",
  customer: "聊到某个客户时说「Acme 只接受 T/T 预付 30%」「采购是 Tom，决策要问老板」，AI 会记在这个客户名下，能看这个客户的同事也能用。",
  team: "全公司都要遵守的规矩，比如「报价有效期统一 15 天」。管理员直接生效，其他人提交后等管理员确认。",
  archived: "忘掉的、被新版本取代的、30 天没用过的 AI 发现，都在这里，可以恢复。",
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

export type MemoryStats = { live: number; used: number; idle: number; unconfirmed: number };

export function MemoryManager({ items, admin, stats }: { items: MemoryItem[]; admin: boolean; stats: MemoryStats }) {
  const [tab, setTab] = useState<Tab>("personal");
  const [adding, setAdding] = useState(false);
  const groups = useMemo(() => {
    const live = items.filter((m) => m.status !== "archived");
    return {
      personal: live.filter((m) => m.scope === "personal"),
      customer: live.filter((m) => m.scope === "customer"),
      team: live.filter((m) => m.scope === "team"),
      archived: items.filter((m) => m.status === "archived"),
    } satisfies Record<Tab, MemoryItem[]>;
  }, [items]);
  const disputed = items.filter((m) => m.disputed && m.status === "active").length;
  const proposed = groups.team.filter((m) => m.status === "proposed").length;

  return (
    <div className="max-w-3xl">
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="personal">我的 {count(groups.personal.length)}</TabsTrigger>
            <TabsTrigger value="customer">客户 {count(groups.customer.length)}</TabsTrigger>
            <TabsTrigger value="team">
              团队 {count(groups.team.length)}
              {admin && proposed > 0 && <span className="ml-1 size-1.5 rounded-full bg-warn" aria-label={`${proposed} 条待确认`} />}
            </TabsTrigger>
            <TabsTrigger value="archived">已忘掉</TabsTrigger>
          </TabsList>
          {(tab === "personal" || tab === "team") && !adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus /> 加一条
            </Button>
          )}
        </div>

        {stats.live > 0 && (
          <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground tabular-nums">
            <span>
              在用 <b className="font-medium text-foreground">{stats.live}</b> 条
            </span>
            <span>近 30 天用上 {stats.used} 条</span>
            {stats.unconfirmed > 0 && <span title="AI 发现的、从往来消息里看到的，只作参考，确认后才算数">待你确认 {stats.unconfirmed} 条</span>}
            {stats.idle > 0 && <span title="30 天都没用上的 AI 发现会自动放进「已忘掉」">一周多没用上 {stats.idle} 条</span>}
          </p>
        )}

        {disputed > 0 && tab !== "archived" && (
          <p className="mb-3 flex items-start gap-2 rounded-[10px] bg-warn-soft px-3 py-2 text-[13px] text-warn">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />有 {disputed} 条记忆前后说法不一致。点对的那条的「确认」，另一条会自动放下。
          </p>
        )}

        {(["personal", "customer", "team", "archived"] as Tab[]).map((t) => (
          <TabsContent key={t} value={t}>
            {adding && (t === "personal" || t === "team") && (
              <div className="mb-3 surface p-3">
                <MemoryForm scope={t} admin={admin} onDone={() => setAdding(false)} />
              </div>
            )}
            {groups[t].length ? (
              <ul className="surface divide-y divide-line">
                {groups[t].map((m) => (
                  <MemoryRow key={m.id} m={m} admin={admin} />
                ))}
              </ul>
            ) : (
              !adding && <p className="surface px-4 py-8 text-center text-sm text-balance text-muted-foreground">{EMPTY[t]}</p>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

const count = (n: number) => (n ? <span className="tabular-nums text-muted-foreground">{n}</span> : null);

function sourceBadge(m: MemoryItem) {
  if (m.status === "proposed")
    return (
      <>
        <Badge variant="warning">待管理员确认</Badge>
        {m.promotedFrom > 1 && (
          <Badge variant="outline">
            <Users /> {m.promotedFrom} 位同事都记过
          </Badge>
        )}
      </>
    );
  if (m.confirmed) return <Badge variant="success">已确认</Badge>;
  if (m.source === "user_said") return <Badge variant="brand">你说的</Badge>;
  return (
    <Badge variant="outline" title="AI 只把它当参考，不会当规矩。确认后才算数">
      {m.source === "outside" ? "从邮件 / 消息看到的" : "AI 发现的"}
    </Badge>
  );
}

function MemoryRow({ m, admin }: { m: MemoryItem; admin: boolean }) {
  const [editing, setEditing] = useState(false);
  const archived = m.status === "archived";
  if (editing)
    return (
      <li className="p-3">
        <MemoryForm memory={m} admin={admin} onDone={() => setEditing(false)} />
      </li>
    );
  return (
    <li className={cn("group flex gap-3 px-4 py-3", archived && "opacity-70")}>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[12px] font-medium text-muted-foreground">{MEMORY_KINDS[m.kind] ?? m.kind}</span>
          <span className="font-medium text-pretty">{m.title}</span>
          {m.pinned && <Pin className="size-3.5 text-brand" aria-label="置顶" />}
        </p>
        {m.content && <p className="text-[13px] whitespace-pre-wrap text-muted-foreground">{m.content}</p>}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
          {sourceBadge(m)}
          {m.disputed && <Badge variant="warning">说法不一致</Badge>}
          {m.customer && (
            <Link href={`/customers/${m.customer.id}`} className="font-medium text-foreground/80 hover:underline">
              {m.customer.name}
            </Link>
          )}
          <span>{fmt(m.updatedAt)}</span>
          {m.useCount > 0 && <span className="tabular-nums">用过 {m.useCount} 次</span>}
        </p>
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {admin && m.status === "proposed" ? (
          <>
            <Button size="sm" variant="outline" onClick={() => runAction(reviewMemoryAction(m.id, false))}>
              不通过
            </Button>
            <Button size="sm" onClick={() => runAction(reviewMemoryAction(m.id, true))}>
              <Check /> 通过
            </Button>
          </>
        ) : archived ? (
          m.canEdit && (
            <Button size="sm" variant="ghost" onClick={() => runAction(restoreMemoryAction(m.id))}>
              <ArchiveRestore /> 恢复
            </Button>
          )
        ) : (
          m.canEdit && (
            <>
              {(!m.trusted || m.disputed) && (
                <Button size="sm" variant="outline" onClick={() => runAction(confirmMemoryAction(m.id))}>
                  <Check /> 确认
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`更多操作：${m.title}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil /> 编辑
                  </DropdownMenuItem>
                  {m.status === "active" && (
                    <DropdownMenuItem onSelect={() => runAction(pinMemoryAction(m.id, !m.pinned))}>
                      <Pin /> {m.pinned ? "取消置顶" : "置顶（每次对话都带上）"}
                    </DropdownMenuItem>
                  )}
                  {m.scope === "personal" && m.mine && m.trusted && m.status === "active" && ["rule", "preference", "howto"].includes(m.kind) && (
                    <DropdownMenuItem onSelect={() => runAction(promoteMemoryAction(m.id))}>
                      <Users /> {admin ? "加到团队记忆" : "提议给全公司"}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => runAction(forgetMemoryAction(m.id))}>
                    <Trash2 /> 忘掉
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        )}
      </div>
    </li>
  );
}

function MemoryForm({ memory, scope, admin, onDone }: { memory?: MemoryItem; scope?: Tab; admin: boolean; onDone: () => void }) {
  const [state, submit, pending] = useActionForm(saveMemoryAction, onDone);
  const team = (memory?.scope ?? scope) === "team";
  return (
    <form onSubmit={submit} className="space-y-2.5">
      {memory && <input type="hidden" name="id" value={memory.id} />}
      {!memory && <input type="hidden" name="scope" value={team ? "team" : "personal"} />}
      <FormMessage state={state} />
      <div className="flex gap-2">
        <NativeSelect name="kind" defaultValue={memory?.kind ?? "rule"} aria-label="种类" className="w-24 shrink-0">
          {Object.entries(MEMORY_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
        <Input
          name="title"
          defaultValue={memory?.title}
          placeholder={team ? "如：报价有效期统一 15 天" : "如：给客户的回复控制在 5 句以内"}
          required
          autoFocus
          maxLength={80}
        />
      </div>
      <FieldErrors state={state} name="title" />
      <Textarea name="content" defaultValue={memory?.content} placeholder="补充细节（可选）" rows={2} maxLength={800} />
      <div className="flex items-center justify-end gap-2">
        {team && !admin && !memory && <span className="mr-auto text-[12px] text-muted-foreground">提交后等管理员确认</span>}
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          <X /> 取消
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  );
}
