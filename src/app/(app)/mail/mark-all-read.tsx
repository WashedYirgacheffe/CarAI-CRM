"use client";

import { useTransition } from "react";
import { MailCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { runAction } from "@/hooks/use-action-form";
import { markAllReadAction } from "./actions";

/** 列表顶部：把当前文件夹的未读一次全部标为已读 */
export function MarkAllRead({ box, acc, count }: { box: string; acc: string | null; count: number }) {
  const [pending, start] = useTransition();
  if (!count) return null;
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="shrink-0"
      aria-label={`全部标为已读（${count} 封未读）`}
      title={`全部标为已读（${count} 封）`}
      disabled={pending}
      onClick={() => start(() => runAction(markAllReadAction(box, acc)).then(() => undefined))}
    >
      <MailCheck />
    </Button>
  );
}
