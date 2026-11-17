"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { runAction } from "@/hooks/use-action-form";
import { reviewApprovalAction, withdrawApprovalAction } from "./actions";

/** 通过 / 驳回：都可以写一句意见（驳回时建议写原因） */
export function ReviewButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const go = async (approve: boolean) => {
    setBusy(true);
    const r = await runAction(reviewApprovalAction(id, approve, note));
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      router.refresh();
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" disabled={busy} onClick={() => go(true)}>
        通过
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy}>
            驳回…
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-2">
          <label htmlFor={`note-${id}`} className="text-sm font-medium">
            驳回原因
          </label>
          <Textarea id={`note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="比如：折扣最多给到 8%" />
          <div className="flex justify-end">
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => go(false)}>
              确认驳回
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function WithdrawButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await runAction(withdrawApprovalAction(id));
        setBusy(false);
        if (r.ok) router.refresh();
      }}
    >
      撤回
    </Button>
  );
}
