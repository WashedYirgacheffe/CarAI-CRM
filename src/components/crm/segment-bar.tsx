"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Users, X } from "lucide-react";
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

/** 客群条：已保存的筛选条件 + 实时客户数；当前有筛选时可另存为客群 */
export function SegmentBar({
  path,
  segments,
  filters,
  canShare,
}: {
  path: string;
  segments: SegmentItem[];
  filters: Record<string, string | number>;
  canShare: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = Object.fromEntries(CUSTOMER_FILTER_KEYS.filter((k) => filters[k]).map((k) => [k, String(filters[k])]));
  const hasFilters = Object.keys(current).length > 0;
  const sel = String(filters.seg ?? "");

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

  if (!segments.length && !hasFilters) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Users className="size-3.5" />
        客群
      </span>
      {segments.map((s) => (
        <span
          key={s.id}
          className={cn(
            "group inline-flex items-center rounded-full border text-xs transition-colors",
            sel === s.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
          )}
        >
          <Link href={`${path}?${s.query}${s.query ? "&" : ""}seg=${s.id}`} className="py-1 pr-1 pl-2.5" title={s.shared ? "全公司共享" : "仅自己可见"}>
            {s.name}
            <span className={cn("ml-1 tabular-nums", sel === s.id ? "opacity-80" : "text-muted-foreground")}>{s.count}</span>
            {s.poolDays !== null && (
              <span className={cn("ml-1", sel === s.id ? "opacity-80" : "text-amber-600")} title="该客群有单独的公海规则">
                · {s.poolDays ? `${s.poolDays}天回收` : "不回收"}
              </span>
            )}
          </Link>
          {s.canDelete ? (
            <button
              type="button"
              onClick={() => remove(s)}
              className="mr-1 rounded-full p-0.5 opacity-50 hover:opacity-100"
              aria-label={`删除客群 ${s.name}`}
            >
              <X className="size-3" />
            </button>
          ) : (
            <span className="pr-1.5" />
          )}
        </span>
      ))}
      {hasFilters && !sel && (
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(true)}>
          <BookmarkPlus className="size-3.5" />
          把当前筛选存为客群
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>保存客群</DialogTitle>
            <DialogDescription>保存当前的筛选条件，之后一键查看，客户数实时更新。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="seg-name">客群名称</FieldLabel>
              <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="如：美国 4 星以上客户" autoFocus />
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
    </div>
  );
}
