"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, MoreHorizontal, Plus, UserRound } from "lucide-react";
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
import { PageHeader } from "@/components/page-header";
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
  description,
  closedDays,
  tz,
  owner,
  members,
  customers,
  perms,
  stages,
  opportunities,
}: {
  description: string;
  closedDays: number;
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

  const kindOf = (o: Opp) => stages.find((s) => s.id === o.stageId)?.kind;
  const openOpps = opps.filter((o) => kindOf(o) === "OPEN");
  const wonOpps = opps.filter((o) => kindOf(o) === "WON");
  const lostCount = opps.filter((o) => kindOf(o) === "LOST").length;
  const openStages = stages.filter((s) => s.kind === "OPEN").map((s) => s.id);
  const [pickedStage, setPickedStage] = useState<string | null>(null);
  const mobileStage = pickedStage ?? (stages.find((s) => opps.some((o) => o.stageId === s.id)) ?? stages[0])?.id;
  const mobileItems = opps.filter((o) => o.stageId === mobileStage);

  const dropProps = (stageId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      setOverStage(stageId);
    },
    onDragLeave: () => setOverStage((v) => (v === stageId ? null : v)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragId) move(dragId, stageId);
      setDragId(null);
      setOverStage(null);
    },
  });

  const card = (o: Opp, drag: boolean) => (
    <article
      key={o.id}
      draggable={drag && perms.edit}
      onDragStart={(e) => {
        setDragId(o.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        setDragId(null);
        setOverStage(null);
      }}
      className={cn(
        "group rounded-xl bg-card p-3 text-sm shadow-card",
        drag && perms.edit && "cursor-grab active:cursor-grabbing",
        dragId === o.id && "opacity-50",
      )}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          className={cn(
            "min-w-0 flex-1 text-left font-medium text-primary",
            perms.edit ? "hover:underline" : "cursor-default",
          )}
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
      <p className="mt-1 text-base font-bold tabular-nums">{formatMoney(o.amount, o.currency)}</p>
      <Link
        href={`/customers/${o.customerId}`}
        className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
      >
        <Building2 className="size-3.5 shrink-0" />
        <span className="truncate">{o.customerName}</span>
      </Link>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <UserRound className="size-3.5 shrink-0" />
          <span className="truncate">{o.ownerName ?? "—"}</span>
        </span>
        {o.expectedCloseAt && (
          <span className="flex shrink-0 items-center gap-1 tabular-nums" title="预计成交日期">
            <CalendarDays className="size-3.5" />
            {formatDate(o.expectedCloseAt, tz)}
          </span>
        )}
      </div>
    </article>
  );

  return (
    <>
      <PageHeader
        title="商机"
        description={description}
        actions={
          perms.create && (
            <Button size="sm" onClick={() => setEditing({ name: "" })}>
              <Plus /> 新建商机
            </Button>
          )
        }
      />

      <div className="surface">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border/70 px-3 py-3 md:gap-x-8 md:px-4">
          {members.length > 1 && (
            <NativeSelect
              aria-label="负责人"
              className="h-8 w-auto"
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
          <Summary label="进行中金额" value={totals(openOpps)} hint={`${openOpps.length} 个商机`} className="text-primary" />
          <Summary label="赢单金额" value={totals(wonOpps)} hint={`${wonOpps.length} 个 · 近 ${closedDays} 天`} className="text-emerald-600" />
          <Summary label="输单" value={`${lostCount}`} hint={`个 · 近 ${closedDays} 天`} />
        </div>

        {/* 手机端：阶段胶囊 + 当前阶段的卡片列表（触屏不能拖拽，用卡片菜单「移到阶段」） */}
        <div className="md:hidden">
          <nav aria-label="商机阶段" className="flex gap-2 overflow-x-auto px-3 pt-3 [scrollbar-width:none]">
            {stages.map((s) => {
              const n = opps.filter((o) => o.stageId === s.id).length;
              const on = s.id === mobileStage;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPickedStage(s.id)}
                  aria-pressed={on}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors",
                    on
                      ? s.kind === "WON"
                        ? "bg-emerald-500 text-white"
                        : s.kind === "LOST"
                          ? "bg-foreground/70 text-background"
                          : "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground/70",
                  )}
                >
                  {s.name}
                  <span className="tabular-nums opacity-75">{n}</span>
                </button>
              );
            })}
          </nav>
          <p className="px-4 pt-2.5 text-xs text-muted-foreground tabular-nums">合计 {totals(mobileItems)}</p>
          <div className="flex flex-col gap-2 p-3">
            {mobileItems.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">这个阶段暂无商机</p>
            ) : (
              mobileItems.map((o) => card(o, false))
            )}
          </div>
        </div>

        <div className="hidden overflow-x-auto p-4 md:block">
          <div className="flex gap-3">
            {stages.map((s, i) => {
              const items = opps.filter((o) => o.stageId === s.id);
              const over = overStage === s.id;
              // 进行中阶段蓝色由浅到深；赢单绿；输单灰
              const tint = s.kind === "OPEN" ? 10 + Math.round((openStages.indexOf(s.id) / Math.max(1, openStages.length - 1)) * 18) : 0;
              return (
                <div key={s.id} className="flex w-64 shrink-0 flex-col">
                  <div
                    {...dropProps(s.id)}
                    className={cn(
                      "relative z-10 flex h-11 w-[calc(100%+20px)] items-center gap-1.5 pr-7 text-sm font-medium transition-[filter]",
                      i === 0 ? "pl-3" : "pl-6",
                      s.kind === "WON" && "bg-emerald-500 text-white",
                      s.kind === "LOST" && "bg-muted text-muted-foreground",
                      s.kind === "OPEN" && "text-primary",
                      over && "brightness-95",
                    )}
                    style={{
                      clipPath:
                        i === 0
                          ? "polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%)"
                          : "polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%, 16px 50%)",
                      ...(s.kind === "OPEN"
                        ? { backgroundColor: `color-mix(in oklab, var(--primary) ${over ? tint + 10 : tint}%, var(--card))` }
                        : {}),
                    }}
                  >
                    <h2 className="truncate">{s.name}</h2>
                    <span className="tabular-nums opacity-80">{items.length}</span>
                    {s.kind === "OPEN" && <span className="ml-auto text-xs font-normal opacity-70 tabular-nums">{s.probability}%</span>}
                  </div>
                  <p className="mt-1.5 mb-3 truncate px-1 text-xs text-muted-foreground tabular-nums" title={totals(items)}>
                    {totals(items)}
                  </p>

                  <section
                    aria-label={s.name}
                    {...dropProps(s.id)}
                    className={cn(
                      "flex min-h-40 flex-1 flex-col gap-2 rounded-2xl bg-muted/50 p-2 ring-1 ring-transparent transition-colors",
                      over && "bg-primary/5 ring-primary/40",
                    )}
                  >
                    {items.length === 0 && (
                      <p className="py-6 text-center text-xs text-muted-foreground/70">{perms.edit ? "拖动商机到这里" : "暂无商机"}</p>
                    )}
                    {items.map((o) => card(o, true))}
                  </section>
                </div>
              );
            })}
          </div>
        </div>
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

function Summary({ label, value, hint, className }: { label: string; value: string; hint: string; className?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="flex items-baseline gap-1.5">
        <span className={cn("text-lg font-bold tabular-nums", className)}>{value}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{hint}</span>
      </p>
    </div>
  );
}
