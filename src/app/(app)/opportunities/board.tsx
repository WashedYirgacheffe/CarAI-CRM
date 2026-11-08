"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/native-select";
import { runAction } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/crm";
import { OpportunityForm, type EditableOpportunity, type StageOption } from "@/components/crm/opportunity-form";
import { deleteOpportunityAction, moveOpportunityAction } from "./actions";

type Opp = {
  id: string;
  name: string;
  amount: string;
  currency: string;
  stageId: string;
  customerId: string;
  customerName: string;
  ownerName: string | null;
  expectedCloseAt: string | null;
  remark: string | null;
};

/** 每列按币种分别合计（不做汇率换算，P2 引入汇率后再统一） */
function totals(opps: Opp[]) {
  const sum = new Map<string, number>();
  for (const o of opps) sum.set(o.currency, (sum.get(o.currency) ?? 0) + Number(o.amount));
  return [...sum].map(([cur, n]) => formatMoney(n, cur)).join(" + ") || "—";
}

export function OpportunityBoard({
  tz,
  owner,
  members,
  customers,
  perms,
  stages,
  opportunities,
}: {
  tz: string;
  owner: string;
  members: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  perms: { create: boolean; edit: boolean; delete: boolean };
  stages: StageOption[];
  opportunities: Opp[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditableOpportunity | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [, start] = useTransition();
  const [opps, moveLocal] = useOptimistic(opportunities, (list, m: { id: string; stageId: string }) =>
    list.map((o) => (o.id === m.id ? { ...o, stageId: m.stageId } : o)),
  );

  function move(id: string, stageId: string) {
    const o = opps.find((x) => x.id === id);
    if (!o || o.stageId === stageId) return;
    start(async () => {
      moveLocal({ id, stageId });
      await runAction(moveOpportunityAction(id, stageId));
    });
  }

  const openTotal = totals(opps.filter((o) => stages.find((s) => s.id === o.stageId)?.kind === "OPEN"));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {members.length > 1 && (
          <NativeSelect
            aria-label="负责人"
            className="w-auto"
            value={owner}
            onChange={(e) => router.push(e.target.value ? `/opportunities?owner=${e.target.value}` : "/opportunities")}
          >
            <option value="">全部负责人</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <span className="text-sm text-muted-foreground">
          进行中 {opps.filter((o) => stages.find((s) => s.id === o.stageId)?.kind === "OPEN").length} 个 · {openTotal}
        </span>
        {perms.create && (
          <Button size="sm" className="ml-auto" onClick={() => setEditing({ name: "" })}>
            <Plus /> 新建商机
          </Button>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((s) => {
          const items = opps.filter((o) => o.stageId === s.id);
          return (
            <section
              key={s.id}
              aria-label={s.name}
              className={cn(
                "flex w-64 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors",
                overStage === s.id && "border-primary bg-primary/5",
              )}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverStage(s.id);
              }}
              onDragLeave={() => setOverStage((v) => (v === s.id ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) move(dragId, s.id);
                setDragId(null);
                setOverStage(null);
              }}
            >
              <header className="border-b px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <h2
                    className={cn(
                      "text-sm font-medium",
                      s.kind === "WON" && "text-emerald-700",
                      s.kind === "LOST" && "text-muted-foreground",
                    )}
                  >
                    {s.name}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">{items.length}</span>
                  </h2>
                  <span className="text-xs text-muted-foreground">{s.probability}%</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">{totals(items)}</p>
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                {items.map((o) => (
                  <article
                    key={o.id}
                    draggable={perms.edit}
                    onDragStart={(e) => {
                      setDragId(o.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    className={cn(
                      "group rounded-lg border bg-card p-3 text-sm shadow-xs",
                      perms.edit && "cursor-grab active:cursor-grabbing",
                      dragId === o.id && "opacity-50",
                    )}
                  >
                    <div className="flex items-start gap-1">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left font-medium hover:text-primary"
                        onClick={() => perms.edit && setEditing(o)}
                      >
                        {o.name}
                      </button>
                      {(perms.edit || perms.delete) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-xs" aria-label="操作" className="-mt-0.5 -mr-1">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {perms.edit && (
                              <>
                                <DropdownMenuItem onSelect={() => setEditing(o)}>编辑</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-xs">移到阶段</DropdownMenuLabel>
                                {stages
                                  .filter((x) => x.id !== o.stageId)
                                  .map((x) => (
                                    <DropdownMenuItem key={x.id} onSelect={() => move(o.id, x.id)}>
                                      {x.name}
                                    </DropdownMenuItem>
                                  ))}
                              </>
                            )}
                            {perms.delete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onSelect={() => runAction(deleteOpportunityAction(o.id))}>
                                  删除
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <Link href={`/customers/${o.customerId}`} className="mt-0.5 block truncate text-xs text-muted-foreground hover:text-primary">
                      {o.customerName}
                    </Link>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="font-medium tabular-nums">{formatMoney(o.amount, o.currency)}</span>
                      <span className="text-muted-foreground">
                        {o.ownerName}
                        {o.expectedCloseAt && ` · ${formatDate(o.expectedCloseAt, tz).slice(5)}`}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <OpportunityForm
              key={editing.id ?? "new"}
              opportunity={editing}
              stages={stages}
              customers={customers}
              tz={tz}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
