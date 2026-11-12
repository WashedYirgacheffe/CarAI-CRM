"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, ChevronsRight, MoreHorizontal, Pencil, Plus, Trash2, UserRound } from "@/components/icons";
import { ActionSheet, SwipeRow } from "@/components/crm/swipe-row";
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
import { InsightCard, InsightRow } from "@/components/crm/insights";
import { Breakdown, Meter, MiniColumns } from "@/components/dashboard/viz";
import { RAMP, yuan } from "@/lib/viz";
import { OpportunityForm, type EditableOpportunity, type StageOption } from "@/components/crm/opportunity-form";
import { deleteOpportunityAction, moveOpportunityAction } from "./actions";
import { EmptyState } from "@/components/crm/empty-state";

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
  rates,
  month,
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
  /** 1 外币 = x 人民币 */
  rates: Record<string, number>;
  /** 当前月份 yyyy-mm（企业时区） */
  month: string;
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
  const openStages = stages.filter((s) => s.kind === "OPEN").map((s) => s.id);
  const [pickedStage, setPickedStage] = useState<string | null>(null);
  const [sheetOpp, setSheetOpp] = useState<Opp | null>(null);
  const mobileStage = pickedStage ?? (stages.find((s) => opps.some((o) => o.stageId === s.id)) ?? stages[0])?.id;
  const mobileItems = opps.filter((o) => o.stageId === mobileStage);

  // 金额统一折成人民币；加权 = 金额 × 阶段赢率
  const cny = (o: Opp) => Number(o.amount) * (rates[o.currency] ?? 1);
  const prob = (o: Opp) => (stages.find((s) => s.id === o.stageId)?.probability ?? 0) / 100;
  const sum = (list: Opp[], f: (o: Opp) => number = cny) => list.reduce((n, o) => n + f(o), 0);
  const weighted = (o: Opp) => cny(o) * prob(o);
  const openCny = sum(openOpps);
  const openWeighted = sum(openOpps, weighted);
  const stageCny = stages.map((s) => sum(opps.filter((o) => o.stageId === s.id)));
  const maxStageCny = Math.max(...stageCny, 0);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const closeKey = (o: Opp) =>
    o.expectedCloseAt
      ? new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(new Date(o.expectedCloseAt))
      : "";
  const overdue = openOpps.filter((o) => o.expectedCloseAt && closeKey(o) < month);
  const undated = openOpps.filter((o) => !o.expectedCloseAt).length;
  const forecast = months.map((k) => ({
    label: `${Number(k.slice(5))}月`,
    value: sum(
      openOpps.filter((o) => closeKey(o) === k),
      weighted,
    ),
  }));
  const lostOpps = opps.filter((o) => kindOf(o) === "LOST");
  const closed = wonOpps.length + lostOpps.length;

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
          className={cn("min-w-0 flex-1 text-left font-medium text-primary", perms.edit ? "hover:underline" : "cursor-default")}
          onClick={() => perms.edit && setEditing(o)}
        >
          {o.name}
        </button>
        {(perms.edit || perms.delete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="操作" className={cn("-mt-0.5 -mr-1", !drag && "max-md:hidden")}>
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
      <p className="mt-1 text-base font-medium tabular-nums">{formatMoney(o.amount, o.currency)}</p>
      <Link href={`/customers/${o.customerId}`} className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
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
            <Button onClick={() => setEditing({ name: "" })}>
              <Plus /> 新建商机
            </Button>
          )
        }
      />

      <InsightRow>
        <InsightCard title="进行中金额" value={yuan(openCny)} hint={`${openOpps.length} 个商机 · 加权预测 ${yuan(openWeighted)}`}>
          <Meter value={openWeighted} max={openCny} label="加权预测占进行中金额" />
          <p className="mt-2 text-xs text-muted-foreground">加权 = 金额 × 所在阶段赢率，折人民币</p>
        </InsightCard>
        <InsightCard
          title="预计成交 · 未来 6 个月"
          value={yuan(forecast.reduce((n, f) => n + f.value, 0))}
          hint={overdue.length || undated ? `${overdue.length} 个已过预计日期 · ${undated} 个未填` : "按预计成交月份，加权金额"}
        >
          <MiniColumns data={forecast} money empty="没有填写预计成交日期的商机" />
        </InsightCard>
        <InsightCard title="各阶段金额" hint="进行中商机，折人民币">
          <Breakdown
            money
            sort={false}
            max={8}
            parts={stages
              .filter((s) => s.kind === "OPEN")
              .map((s, i, arr) => ({
                label: s.name,
                value: sum(openOpps.filter((o) => o.stageId === s.id)),
                color: RAMP[Math.round((i / Math.max(1, arr.length - 1)) * 3)],
              }))}
            empty="暂无进行中商机"
          />
        </InsightCard>
        <InsightCard
          title={`赢单率 · 近 ${closedDays} 天`}
          value={closed ? `${Math.round((wonOpps.length / closed) * 100)}%` : "—"}
          hint={`赢 ${wonOpps.length} 个 ${yuan(sum(wonOpps))} · 输 ${lostOpps.length} 个`}
        >
          <Meter value={wonOpps.length} max={closed} tone="var(--chart-2)" label="赢单率" />
        </InsightCard>
      </InsightRow>

      <div className="surface">
        {members.length > 1 && (
          <div className="border-b border-border/70 px-3 py-3 md:px-4">
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
          </div>
        )}

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
          <p className="px-4 pt-2.5 text-xs text-muted-foreground tabular-nums">合计 {mobileItems.length ? yuan(sum(mobileItems)) : "—"}</p>
          <div className="flex flex-col gap-2 p-3">
            {mobileItems.length === 0 ? (
              <EmptyState className="py-12">这个阶段暂无商机</EmptyState>
            ) : (
              mobileItems.map((o) => {
                const i = stages.findIndex((x) => x.id === o.stageId);
                const next = stages[i + 1];
                return (
                  <SwipeRow
                    key={o.id}
                    className="rounded-xl"
                    left={[
                      {
                        label: "推进",
                        icon: ChevronsRight,
                        tone: "primary",
                        hidden: !perms.edit || !next,
                        onAction: () => next && move(o.id, next.id),
                      },
                    ]}
                    right={[
                      { label: "更多", icon: MoreHorizontal, tone: "neutral", hidden: !(perms.edit || perms.delete), onAction: () => setSheetOpp(o) },
                    ]}
                  >
                    {card(o, false)}
                  </SwipeRow>
                );
              })
            )}
          </div>
        </div>

        <ActionSheet
          open={!!sheetOpp}
          onOpenChange={(v) => !v && setSheetOpp(null)}
          title={sheetOpp?.name}
          items={
            sheetOpp
              ? [
                  { label: "编辑", icon: Pencil, hidden: !perms.edit, onSelect: () => setEditing(sheetOpp) },
                  "sep",
                  ...stages
                    .filter((x) => x.id !== sheetOpp.stageId)
                    .map((x) => ({ label: `移到「${x.name}」`, hidden: !perms.edit, onSelect: () => move(sheetOpp.id, x.id) })),
                  "sep",
                  {
                    label: "删除",
                    icon: Trash2,
                    destructive: true,
                    hidden: !perms.delete,
                    onSelect: () => void runAction(deleteOpportunityAction(sheetOpp.id)),
                  },
                ]
              : []
          }
        />

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
                  <div className="mt-2 mb-3 px-1" title={totals(items)}>
                    <p className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                      <span className="font-medium">{items.length ? yuan(stageCny[i]) : "—"}</span>
                      {s.kind === "OPEN" && items.length > 0 && (
                        <span className="truncate text-muted-foreground">加权 {yuan(sum(items, weighted))}</span>
                      )}
                    </p>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          s.kind === "WON" ? "bg-[var(--chart-2)]" : s.kind === "LOST" ? "bg-muted-foreground/40" : "bg-[var(--chart-1)]",
                        )}
                        style={{ width: `${maxStageCny ? (stageCny[i] / maxStageCny) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

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
