"use client";

import { useEffect, useState } from "react";
import { MessageSquareText, Pencil, Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runAction } from "@/hooks/use-action-form";
import { QUICK_REPLY_VARS } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { deleteQuickReplyAction, listQuickRepliesAction, saveQuickReplyAction } from "./actions";
import type { QuickReplyItem } from "./thread-view";

type Draft = { id?: string; group: string; title: string; body: string; shared: boolean };

/** 收件箱顶部的「话术」：管理快捷回复（公共的管理者维护，个人的自己维护） */
export function QuickRepliesButton({ manage }: { manage: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}>
        <MessageSquareText />
        话术
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">{open && <Manager manage={manage} />}</DialogContent>
      </Dialog>
    </>
  );
}

function Manager({ manage }: { manage: boolean }) {
  const [rows, setRows] = useState<QuickReplyItem[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => setRows(await listQuickRepliesAction());
  useEffect(() => {
    let live = true;
    void listQuickRepliesAction().then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, []);

  if (draft) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{draft.id ? "编辑快捷回复" : "新建快捷回复"}</DialogTitle>
          <DialogDescription>在回复框里输入 / 就能选。可以用变量：{QUICK_REPLY_VARS.join(" ")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <Input value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value })} placeholder="分组（可不填）" maxLength={40} />
            <Input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="标题，比如「报价」" maxLength={60} />
          </div>
          <Textarea rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Hi {联系人}, thanks for your interest…" />
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REPLY_VARS.map((v) => (
              <button
                key={v}
                type="button"
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setDraft({ ...draft, body: `${draft.body}${v}` })}
              >
                {v}
              </button>
            ))}
          </div>
          {manage && (
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={draft.shared} onChange={(e) => setDraft({ ...draft, shared: e.target.checked })} />
              公共话术（全公司都能用）
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDraft(null)}>
            取消
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await runAction(saveQuickReplyAction({ ...draft, group: draft.group || undefined }));
              setBusy(false);
              if (r.ok) {
                setDraft(null);
                void load();
              }
            }}
          >
            保存
          </Button>
        </DialogFooter>
      </>
    );
  }

  const groups = new Map<string, QuickReplyItem[]>();
  for (const r of rows ?? []) {
    const g = r.group || "未分组";
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>快捷回复</DialogTitle>
        <DialogDescription>回复私信时在输入框里打 / 选用。{manage ? "公共话术全公司共用，个人话术只有自己能看到。" : "公共话术由管理者维护，你可以加自己的。"}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[55vh] overflow-y-auto">
        {rows === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">还没有快捷回复</p>
        ) : (
          [...groups].map(([g, list]) => (
            <section key={g} className="mb-3">
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">{g}</h3>
              <ul className="divide-y rounded-lg border">
                {list.map((r) => {
                  const editable = manage || !r.shared;
                  return (
                    <li key={r.id} className="group flex items-start gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          {r.title}
                          <span className={cn("rounded px-1 text-[10.5px] font-normal", r.shared ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                            {r.shared ? "公共" : "我的"}
                          </span>
                        </p>
                        <p className="line-clamp-2 text-xs whitespace-pre-wrap text-muted-foreground">{r.body}</p>
                      </div>
                      {editable && (
                        <span className="flex shrink-0 gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label="编辑"
                            onClick={() => setDraft({ id: r.id, group: r.group ?? "", title: r.title, body: r.body, shared: r.shared })}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 hover:text-destructive"
                            aria-label="删除"
                            onClick={async () => {
                              if (!confirm(`删除「${r.title}」？`)) return;
                              const res = await runAction(deleteQuickReplyAction(r.id));
                              if (res.ok) void load();
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
      <DialogFooter>
        <Button onClick={() => setDraft({ group: "", title: "", body: "", shared: manage })}>
          <Plus />
          新建
        </Button>
      </DialogFooter>
    </>
  );
}
