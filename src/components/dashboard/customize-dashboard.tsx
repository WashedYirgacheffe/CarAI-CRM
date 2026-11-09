"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { runAction } from "@/hooks/use-action-form";
import { DASHBOARD_CARDS, type DashboardCardKey } from "@/lib/dashboard";
import { saveDashboardCardsAction } from "@/app/(app)/dashboard/actions";

/** 自定义工作台：勾选要显示的卡片，上下调整顺序 */
export function CustomizeDashboard({ current }: { current: DashboardCardKey[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // 已选的按当前顺序在前，未选的按目录顺序在后
  const initial = () => [
    ...current.map((k) => ({ key: k, on: true })),
    ...DASHBOARD_CARDS.filter((c) => !current.includes(c.key)).map((c) => ({ key: c.key as DashboardCardKey, on: false })),
  ];
  const [items, setItems] = useState(initial);
  const meta = (k: string) => DASHBOARD_CARDS.find((c) => c.key === k)!;

  const move = (i: number, d: -1 | 1) =>
    setItems((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const n = [...xs];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const submit = async (keys: string[] | null) => {
    setBusy(true);
    try {
      const r = await runAction(saveDashboardCardsAction(keys));
      if (r.ok) setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setItems(initial());
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 /> 自定义工作台
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>自定义工作台</DialogTitle>
          <DialogDescription>勾选要显示的卡片，用箭头调整顺序。只影响你自己的工作台。</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border">
          {items.map((it, i) => (
            <li key={it.key} className="flex items-center gap-3 px-3 py-2">
              <Checkbox
                id={`card-${it.key}`}
                checked={it.on}
                onCheckedChange={(v) => setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, on: !!v } : x)))}
              />
              <label htmlFor={`card-${it.key}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-sm font-medium">{meta(it.key).label}</span>
                <span className="block truncate text-xs text-muted-foreground">{meta(it.key).desc}</span>
              </label>
              <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上移">
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="下移">
                <ArrowDown />
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" disabled={busy} onClick={() => submit(null)}>
            恢复默认
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={busy || !items.some((x) => x.on)} onClick={() => submit(items.filter((x) => x.on).map((x) => x.key))}>
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
