"use client";

import { useTransition } from "react";
import { Check, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/native-select";
import { runAction } from "@/hooks/use-action-form";
import { markSocialReadAction, setWatchStarAction } from "./actions";

export function MarkAllRead() {
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => void (await runAction(markSocialReadAction())))}>
      {pending ? <Loader2 /> : <Check />} 全部已读
    </Button>
  );
}

export function MarkRead({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="shrink-0 text-muted-foreground"
      aria-label="标为已读"
      title="标为已读"
      disabled={pending}
      onClick={() => start(async () => void (await markSocialReadAction([id])))}
    >
      {pending ? <Loader2 /> : <Check />}
    </Button>
  );
}

/** 管理员：几星及以上的客户自动跟踪 */
export function WatchStarSetting({ value }: { value: number }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      跟踪范围
      <NativeSelect
        defaultValue={String(value)}
        disabled={pending}
        onChange={(e) => {
          const v = Number(e.target.value);
          start(async () => void (await runAction(setWatchStarAction(v))));
        }}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n} 星及以上
          </option>
        ))}
        <option value="0">不跟踪</option>
      </NativeSelect>
    </label>
  );
}
