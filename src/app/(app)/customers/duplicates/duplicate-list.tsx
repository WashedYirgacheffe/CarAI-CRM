"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CountryLabel } from "@/components/crm/bits";
import { runAction } from "@/hooks/use-action-form";
import { formatDate, relativeDays } from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { DuplicateGroup } from "@/server/duplicates";
import { mergeCustomersAction } from "./actions";

export function DuplicateList({ groups, tz, canMerge }: { groups: DuplicateGroup[]; tz: string; canMerge: boolean }) {
  if (!groups.length) {
    return <p className="rounded-xl border bg-card py-16 text-center text-sm text-muted-foreground">没有发现疑似重复的客户</p>;
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">共 {groups.length} 组疑似重复</p>
      {groups.map((g) => (
        <GroupCard key={g.key} group={g} tz={tz} canMerge={canMerge} />
      ))}
    </div>
  );
}

function GroupCard({ group, tz, canMerge }: { group: DuplicateGroup; tz: string; canMerge: boolean }) {
  const router = useRouter();
  // 默认保留最早创建的客户
  const [keep, setKeep] = useState(group.customers[0].id);
  const [merge, setMerge] = useState<Set<string>>(new Set(group.customers.slice(1).map((c) => c.id)));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const targets = group.customers.filter((c) => c.id !== keep && merge.has(c.id));
  const kept = group.customers.find((c) => c.id === keep)!;

  const pickKeep = (id: string) => {
    setKeep(id);
    setMerge(new Set(group.customers.filter((c) => c.id !== id).map((c) => c.id)));
  };
  const toggle = (id: string) =>
    setMerge((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const run = async () => {
    setBusy(true);
    const r = await runAction(
      mergeCustomersAction(
        keep,
        targets.map((c) => c.id),
      ),
    );
    setBusy(false);
    setConfirming(false);
    if (r.ok) router.refresh();
  };

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {group.reasons.map((r) => (
            <span key={r} className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
              {r}
            </span>
          ))}
        </div>
        {canMerge && (
          <Button size="sm" variant="outline" disabled={!targets.length} onClick={() => setConfirming(true)}>
            <Merge /> 合并 {targets.length} 个到保留客户
          </Button>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:font-normal">
            {canMerge && <th className="w-16">保留</th>}
            {canMerge && <th className="w-16">合并</th>}
            <th>客户</th>
            <th>国家</th>
            <th>负责人</th>
            <th>联系人</th>
            <th>最近联系</th>
            <th>创建</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {group.customers.map((c) => (
            <tr key={c.id} className={cn("[&>td]:px-4 [&>td]:py-2", c.id === keep && "bg-primary/5")}>
              {canMerge && (
                <td>
                  <input type="radio" name={`keep-${group.key}`} checked={c.id === keep} onChange={() => pickKeep(c.id)} aria-label={`保留 ${c.name}`} />
                </td>
              )}
              {canMerge && (
                <td>
                  <input
                    type="checkbox"
                    disabled={c.id === keep}
                    checked={c.id !== keep && merge.has(c.id)}
                    onChange={() => toggle(c.id)}
                    aria-label={`合并 ${c.name}`}
                  />
                </td>
              )}
              <td>
                <Link href={`/customers/${c.id}`} className="font-medium hover:text-primary hover:underline">
                  {c.name}
                </Link>
              </td>
              <td>
                <CountryLabel code={c.country} />
              </td>
              <td className="text-muted-foreground">{c.ownerName ?? "公海"}</td>
              <td className="tabular-nums">{c.contactCount}</td>
              <td className="tabular-nums">{relativeDays(c.lastContactAt)}</td>
              <td className="tabular-nums text-muted-foreground">{formatDate(c.createdAt, tz)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>合并到「{kept.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {targets.map((c) => `「${c.name}」`).join("、")} 的联系人、跟进动态、商机、日程、报价单、订单、邮件和 WhatsApp
              会话都会转到「{kept.name}」，空着的资料会用它们补齐，然后删除这些客户。合并后无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                run();
              }}
            >
              {busy ? "合并中…" : "确认合并"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
