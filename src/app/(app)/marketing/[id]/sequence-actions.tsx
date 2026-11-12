"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ClipboardPaste, Inbox, MoreHorizontal, Pause, Pencil, Play, Search, Trash2, UserPlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { runAction } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { deleteSequenceAction, enrollAction, searchRecipientsAction, setSequenceStatusAction, type RecipientOption } from "../actions";

export function SequenceActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" onClick={() => setAdding(true)}>
        <UserPlus /> 添加收件人
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => start(async () => void (await runAction(setSequenceStatusAction(id, !active))))}
      >
        {active ? <Pause /> : <Play />} {active ? "暂停" : "恢复发送"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="outline" aria-label="更多">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/marketing/${id}/edit`}>
              <Pencil /> 编辑邮件内容
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 /> 删除序列
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddRecipientsDialog sequenceId={id} open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="删除这个序列？"
        description="收件人名单和发送统计会一起删除，已发出的邮件仍保留在「已发送」里。"
        action={() => deleteSequenceAction(id)}
        onDone={(r) => r.ok && router.push("/marketing")}
      />
    </>
  );
}

const SOURCES = [
  { key: "customer", label: "客户", icon: Building2 },
  { key: "lead", label: "线索", icon: Inbox },
  { key: "paste", label: "粘贴邮箱", icon: ClipboardPaste },
] as const;

function AddRecipientsDialog({ sequenceId, open, onOpenChange }: { sequenceId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [source, setSource] = useState<(typeof SOURCES)[number]["key"]>("customer");
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<RecipientOption[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || source === "paste") return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchRecipientsAction(sequenceId, source, q);
      if (live) setOptions(r);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, source, q, sequenceId]);

  const selectable = (options ?? []).filter((o) => !o.enrolled);
  const allPicked = selectable.length > 0 && selectable.every((o) => picked.has(o.id));
  const pasteCount = text.split(/\r?\n/).filter((l) => l.includes("@")).length;

  function switchTo(k: typeof source) {
    setSource(k);
    setPicked(new Set());
    setOptions(null);
    setQ("");
  }

  async function submit() {
    setBusy(true);
    const r = await runAction(enrollAction(sequenceId, source === "paste" ? { kind: "paste", text } : { kind: source, ids: [...picked] }));
    setBusy(false);
    if (r.ok) {
      setPicked(new Set());
      setText("");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>添加收件人</DialogTitle>
          <DialogDescription>退订、退信和已在序列里的邮箱会自动跳过</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => switchTo(s.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm transition-colors",
                source === s.key ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <s.icon className="size-4" /> {s.label}
            </button>
          ))}
        </div>

        {source === "paste" ? (
          <div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder={"每行一个，可带姓名、公司、国家，用逗号或 Tab 分隔\njohn@acme.com, John Smith, Acme Medical, Germany\nmaria@salud.es"}
              className="font-mono text-xs"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">从 Excel 直接复制几列粘贴也可以。已在 CRM 里的邮箱会自动关联到客户。</p>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={source === "customer" ? "搜索公司、联系人、邮箱" : "搜索线索公司、联系人、邮箱"}
                className="pl-8"
              />
            </div>
            <label className="mt-2 flex items-center gap-2 px-1 text-sm">
              <Checkbox
                checked={allPicked}
                disabled={!selectable.length}
                onCheckedChange={(v) => setPicked(v ? new Set(selectable.map((o) => o.id)) : new Set())}
              />
              全选{options ? `（${selectable.length} 个可选${options.length >= 300 ? "，最多显示 300 个，可搜索缩小范围" : ""}）` : ""}
            </label>
            <ul className="mt-1 max-h-80 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/70">
              {options === null && <li className="py-10 text-center text-sm text-muted-foreground">加载中…</li>}
              {options?.length === 0 && (
                <li className="py-10 text-center text-sm text-muted-foreground">没有带邮箱的{source === "customer" ? "客户" : "线索"}</li>
              )}
              {options?.map((o) => (
                <li key={o.id}>
                  <label className={cn("flex items-center gap-3 px-3 py-2 text-sm", o.enrolled ? "opacity-50" : "cursor-pointer hover:bg-muted/50")}>
                    <Checkbox
                      checked={o.enrolled || picked.has(o.id)}
                      disabled={o.enrolled}
                      onCheckedChange={(v) =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (v) n.add(o.id);
                          else n.delete(o.id);
                          return n;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{o.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {o.email}
                        {o.sub && ` · ${o.sub}`}
                      </span>
                    </span>
                    {o.enrolled && <span className="shrink-0 text-xs text-muted-foreground">已加入</span>}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy || (source === "paste" ? !pasteCount : !picked.size)}>
            {busy ? "添加中…" : `添加 ${source === "paste" ? pasteCount : picked.size} 位`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
