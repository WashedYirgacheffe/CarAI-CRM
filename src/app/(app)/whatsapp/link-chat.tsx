"use client";

import { useEffect, useState } from "react";
import { Building2 } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runAction } from "@/hooks/use-action-form";
import { searchCustomersAction } from "@/app/(app)/mail/actions";
import { linkChatAction } from "./actions";

/** 关联 / 更换客户 */
export function LinkChatDialog({
  chatId,
  open,
  onOpenChange,
  current,
}: {
  chatId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <LinkChat chatId={chatId} current={current} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function LinkChat({ chatId, current, onDone }: { chatId: string; current?: string | null; onDone: () => void }) {
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
        <DialogTitle>{current ? "更换关联客户" : "关联到客户"}</DialogTitle>
        <DialogDescription>{current ? `当前关联「${current}」。` : ""}这个号码会写进客户的联系人，以后的聊天自动归到该客户。</DialogDescription>
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
                const r = await runAction(linkChatAction(chatId, c.id));
                setBusy(false);
                if (r.ok) onDone();
              }}
            >
              <Building2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{c.domain}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
