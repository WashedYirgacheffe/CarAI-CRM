"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { runAction } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { CUSTOMER_FILTER_KEYS } from "@/lib/segments";
import { deleteSegmentAction, saveSegmentAction } from "@/app/(app)/customers/segment-actions";
import type { SegmentItem } from "@/server/segments";

const itemCls = "flex min-w-0 shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors lg:shrink";
const activeCls = "bg-accent font-medium text-accent-foreground";
const idleCls = "text-foreground/80 hover:bg-muted";

function Count({ n }: { n: number | null | undefined }) {
  if (n === null || n === undefined) return null;
  return <span className="ml-auto pl-2 text-xs font-normal text-muted-foreground tabular-nums">{n}</span>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="hidden px-2.5 pt-3 pb-1 text-xs text-muted-foreground lg:block">{children}</p>;
}

/**
 * 客群栏（列表卡片左侧）：全部 + 快捷筛选（follow=）+ 已保存的客群（实时客户数）。
 * 当前有筛选且未选客群时，可另存为客群。窄屏时横向排成一行。
 */
export function SegmentBar({
  path,
  segments,
  filters,
  canShare,
  allLabel = "全部客户",
  allCount,
  quick = [],
  allowSave = true,
}: {
  path: string;
  segments: SegmentItem[];
  filters: Record<string, string | number>;
  canShare: boolean;
  allLabel?: string;
  allCount?: number;
  quick?: { value: string; label: string }[];
  allowSave?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = Object.fromEntries(CUSTOMER_FILTER_KEYS.filter((k) => filters[k]).map((k) => [k, String(filters[k])]));
  const hasFilters = Object.keys(current).length > 0;
  const sel = String(filters.seg ?? "");
  const follow = String(filters.follow ?? "");

  const save = async () => {
    setBusy(true);
    const r = await runAction(saveSegmentAction({ name, shared, filters: current }));
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setName("");
      router.refresh();
    }
  };
  const remove = async (s: SegmentItem) => {
    if (!confirm(`删除客群「${s.name}」？${s.poolDays !== null ? "该客群的公海规则也会一起失效。" : ""}`)) return;
    const r = await runAction(deleteSegmentAction(s.id));
    if (r.ok && sel === s.id) router.push(path);
    else router.refresh();
  };

  return (
    <aside className="border-b border-border/70 p-2.5 lg:w-52 lg:shrink-0 lg:border-r lg:border-b-0">
      <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible" aria-label="客群">
        <Link href={path} className={cn(itemCls, !hasFilters && !sel ? activeCls : idleCls)}>
          <span className="truncate">{allLabel}</span>
          <Count n={allCount} />
        </Link>

        {quick.length > 0 && <SectionLabel>快捷筛选</SectionLabel>}
        {quick.map((o) => (
          <Link key={o.value} href={`${path}?follow=${o.value}`} className={cn(itemCls, !sel && follow === o.value ? activeCls : idleCls)}>
            <span className="truncate">{o.label}</span>
          </Link>
        ))}

        {segments.length > 0 && <SectionLabel>客群</SectionLabel>}
        {segments.map((s) => (
          <div key={s.id} className={cn("group relative", itemCls, "p-0", sel === s.id ? activeCls : idleCls)}>
            <Link
              href={`${path}?${s.query}${s.query ? "&" : ""}seg=${s.id}`}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-2.5"
              title={s.shared ? "全公司共享" : "仅自己可见"}
            >
              <span className="grid min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{s.name}</span>
                  {s.shared && <Share2 className="size-3 shrink-0 text-muted-foreground" aria-label="全公司共享" />}
                </span>
                {s.poolDays !== null && (
                  <span className="text-[11px] leading-tight font-normal text-amber-700" title="该客群有单独的公海规则">
                    {s.poolDays ? `公海 ${s.poolDays} 天回收` : "不回收公海"}
                  </span>
                )}
              </span>
              <Count n={s.count} />
            </Link>
            {s.canDelete ? (
              <button
                type="button"
                onClick={() => remove(s)}
                className="mr-1 rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                aria-label={`删除客群 ${s.name}`}
              >
                <X className="size-3" />
              </button>
            ) : (
              <span className="pr-2.5" />
            )}
          </div>
        ))}

        {allowSave && hasFilters && !sel && (
          <button type="button" onClick={() => setOpen(true)} className={cn(itemCls, "text-primary hover:bg-accent lg:mt-1")}>
            <BookmarkPlus className="size-3.5 shrink-0" />
            <span className="truncate">把当前筛选存为客群</span>
          </button>
        )}
      </nav>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>保存客群</DialogTitle>
            <DialogDescription>保存当前的筛选条件，之后一键查看，客户数实时更新。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="seg-name">客群名称</FieldLabel>
              <Input
                id="seg-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                placeholder="如：美国 4 星以上客户"
                autoFocus
              />
            </Field>
            {canShare && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={shared} onCheckedChange={(v) => setShared(v === true)} />
                全公司共享（共享客群可以在「公海规则」里单独设置回收天数）
              </label>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={save} disabled={busy || !name.trim()}>
              {busy ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
