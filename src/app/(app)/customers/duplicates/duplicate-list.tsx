"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Merge } from "@/components/icons";
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
  return (
    <div className="overflow-hidden surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-5 py-3">
        <h2 className="flex min-h-8 items-baseline gap-1.5 text-[15px] font-medium">
          疑似重复
          <span className="text-[13px] font-normal text-muted-foreground">
            · <span className="tabular-nums">{groups.length}</span> 组
          </span>
        </h2>
        {canMerge && groups.length > 0 && <span className="ml-auto text-[13px] text-muted-foreground">每组选一个保留，勾选的客户会合并进去</span>}
      </div>
      {groups.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">没有发现疑似重复的客户</p>
      ) : (
        <div className="divide-y divide-border/70">
          {groups.map((g) => (
            <GroupCard key={g.key} group={g} tz={tz} canMerge={canMerge} />
          ))}
        </div>
      )}
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
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-5 py-2">
        <div className="flex flex-wrap gap-1.5">
          {group.reasons.map((r) => (
            <span key={r} className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
              {r}
            </span>
          ))}
        </div>
        {canMerge && (
          <Button size="xs" variant="outline" className="bg-card" disabled={!targets.length} onClick={() => setConfirming(true)}>
            <Merge /> 合并 {targets.length} 个到保留客户
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium [&>th]:whitespace-nowrap [&>th:first-child]:pl-5 [&>th:last-child]:pr-5">
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
          <tbody className="divide-y divide-border/60 border-t border-border/60">
            {group.customers.map((c) => (
              <tr
                key={c.id}
                className={cn(
                  "transition-colors [&>td]:px-3 [&>td]:py-2.5 [&>td]:whitespace-nowrap [&>td:first-child]:pl-5 [&>td:last-child]:pr-5",
                  c.id === keep ? "bg-accent/50" : "hover:bg-accent/30",
                )}
              >
                {canMerge && (
                  <td>
                    <input
                      type="radio"
                      name={`keep-${group.key}`}
                      checked={c.id === keep}
                      onChange={() => pickKeep(c.id)}
                      aria-label={`保留 ${c.name}`}
                    />
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
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>合并到「{kept.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {targets.map((c) => `「${c.name}」`).join("、")} 的联系人、跟进动态、商机、日程、报价单、订单、邮件和 WhatsApp 会话都会转到「{kept.name}
              」，空着的资料会用它们补齐，然后删除这些客户。合并后无法撤销。
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
    </section>
  );
}
