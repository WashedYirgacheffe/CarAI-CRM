"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Paperclip, Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS, formatAmount, round2 } from "@/lib/docs";
import { PLAN_TEMPLATES, addDays, allocatePlans } from "@/lib/receivables";
import { addPaymentAction, deletePaymentAction, savePaymentPlanAction } from "../actions";

type Payment = {
  id: string;
  no: string | null;
  amount: string;
  fee: string | null;
  payer: string | null;
  receivedAt: string;
  method: string | null;
  remark: string | null;
  file: { id: string; name: string } | null;
};
type Plan = { id: string; label: string; amount: string; dueDate: string };

export function PaymentsCard({
  orderId,
  canEdit,
  currency,
  total,
  paid,
  today,
  orderDate,
  deliveryDate,
  payments,
  plans,
  files,
}: {
  orderId: string;
  canEdit: boolean;
  currency: string;
  total: string;
  paid: string;
  today: string;
  /** YYYY-MM-DD */
  orderDate: string;
  deliveryDate: string | null;
  payments: Payment[];
  plans: Plan[];
  /** 这个客户的文件，选作水单 */
  files: { id: string; name: string }[];
}) {
  const [adding, setAdding] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [deleting, setDeleting] = useState<Payment | null>(null);
  const router = useRouter();
  const [state, submit, pending] = useActionForm(addPaymentAction, (form) => {
    form.reset();
    setAdding(false);
  });
  const outstanding = round2(Number(total) - Number(paid));
  const pct = Number(total) > 0 ? Math.min(100, Math.round((Number(paid) / Number(total)) * 100)) : 0;
  const todayDate = new Date(`${today}T00:00:00Z`);
  const schedule = allocatePlans(
    plans.map((p) => ({ id: p.id, label: p.label, amount: Number(p.amount), dueDate: `${p.dueDate}T00:00:00Z` })),
    Number(paid),
    todayDate,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>收款</CardTitle>
        {canEdit && !adding && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus /> 登记收款
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">已收 {pct}%</span>
            <span className="font-medium tabular-nums">
              {formatAmount(paid)} / {formatAmount(total, currency)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
          <p className={cn("mt-1.5 text-xs tabular-nums", outstanding > 0 ? "text-amber-700" : "text-emerald-700")}>
            {outstanding > 0
              ? `待收 ${formatAmount(outstanding, currency)}`
              : outstanding < 0
                ? `多收 ${formatAmount(-outstanding, currency)}`
                : "已全部收齐"}
          </p>
        </div>

        {/* 收款计划 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground">收款计划</h3>
            {canEdit && !planning && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPlanning(true)}>
                <CalendarClock className="size-3.5" /> {plans.length ? "调整" : "设置"}
              </Button>
            )}
          </div>
          {planning ? (
            <PlanEditor
              orderId={orderId}
              currency={currency}
              total={Number(total)}
              orderDate={orderDate}
              deliveryDate={deliveryDate}
              plans={plans}
              onDone={(saved) => {
                setPlanning(false);
                if (saved) router.refresh();
              }}
            />
          ) : schedule.length ? (
            <ul className="space-y-1.5 text-sm">
              {schedule.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      p.state === "paid" ? "bg-emerald-500" : p.state === "overdue" ? "bg-rose-500" : p.state === "partial" ? "bg-amber-500" : "bg-muted-foreground/30",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  <span className="text-right text-xs tabular-nums">
                    <span className="font-medium">{formatAmount(p.amount)}</span>
                    <span className={cn("block", p.state === "overdue" ? "text-rose-600" : "text-muted-foreground")}>
                      {p.state === "paid"
                        ? "已收齐"
                        : p.state === "overdue"
                          ? `逾期 ${p.overdueDays} 天，欠 ${formatAmount(p.due)}`
                          : `${p.dueDate.toISOString().slice(0, 10)} 到期${p.paid ? `，还差 ${formatAmount(p.due)}` : ""}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">没设计划时按下单日期算账龄。设了计划（比如 30% 定金 + 70% 尾款），逾期会自动提醒负责人。</p>
          )}
        </section>

        {adding && (
          <form onSubmit={submit} className="space-y-3 rounded-2xl bg-muted/60 p-3.5">
            <input type="hidden" name="orderId" value={orderId} />
            <FormMessage state={state} />
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="pay-amount">到账金额（{currency}）</FieldLabel>
                <Input
                  id="pay-amount"
                  name="amount"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={(schedule.find((p) => p.due > 0)?.due ?? outstanding) > 0 ? (schedule.find((p) => p.due > 0)?.due ?? outstanding) : ""}
                  required
                  autoFocus
                />
                <FieldErrors state={state} name="amount" />
              </Field>
              <Field>
                <FieldLabel htmlFor="pay-date">收款日期</FieldLabel>
                <Input id="pay-date" name="receivedAt" type="date" defaultValue={today} required />
                <FieldErrors state={state} name="receivedAt" />
              </Field>
              <Field>
                <FieldLabel htmlFor="pay-method">方式</FieldLabel>
                <NativeSelect id="pay-method" name="method" defaultValue={PAYMENT_METHODS[0]}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="pay-fee">手续费（可不填）</FieldLabel>
                <Input id="pay-fee" name="fee" type="number" min={0} step="0.01" placeholder="银行扣费" />
                <FieldErrors state={state} name="fee" />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="pay-payer">付款方（和买方不同时填）</FieldLabel>
              <Input id="pay-payer" name="payer" placeholder="如：代付公司名称" />
            </Field>
            {files.length > 0 && (
              <Field>
                <FieldLabel htmlFor="pay-file">水单 / 汇款凭证</FieldLabel>
                <NativeSelect id="pay-file" name="fileId" defaultValue="">
                  <option value="">不关联</option>
                  {files.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="pay-remark">备注</FieldLabel>
              <Input id="pay-remark" name="remark" placeholder="如：30% 定金" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                取消
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "保存中…" : "保存"}
              </Button>
            </div>
          </form>
        )}

        {payments.length > 0 ? (
          <ul className="divide-y text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium tabular-nums">
                    {formatAmount(p.amount, currency)}
                    {p.fee && Number(p.fee) > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">手续费 {formatAmount(p.fee)}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="tabular-nums">{p.receivedAt}</span>
                    {p.no && ` · ${p.no}`}
                    {p.method && ` · ${p.method}`}
                    {p.payer && ` · 付款方 ${p.payer}`}
                    {p.remark && ` · ${p.remark}`}
                  </p>
                  {p.file && (
                    <a
                      href={`/api/crm-files/${p.file.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Paperclip className="size-3 shrink-0" />
                      <span className="truncate">{p.file.name}</span>
                    </a>
                  )}
                </div>
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 hover:text-destructive"
                    aria-label="删除收款记录"
                    onClick={() => setDeleting(p)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          !adding && <p className="text-sm text-muted-foreground">还没有收款记录</p>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="删除这条收款记录？"
        description={deleting ? `${formatAmount(deleting.amount, currency)} · ${deleting.receivedAt}` : undefined}
        action={() => deletePaymentAction(deleting!.id)}
      />
    </Card>
  );
}

type Row = { label: string; amount: string; dueDate: string };

function PlanEditor({
  orderId,
  currency,
  total,
  orderDate,
  deliveryDate,
  plans,
  onDone,
}: {
  orderId: string;
  currency: string;
  total: number;
  orderDate: string;
  deliveryDate: string | null;
  plans: Plan[];
  onDone: (saved: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    plans.length ? plans.map((p) => ({ label: p.label, amount: p.amount, dueDate: p.dueDate })) : [{ label: "全款", amount: String(total), dueDate: orderDate }],
  );
  const [busy, setBusy] = useState(false);
  const sum = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const diff = round2(total - sum);

  const applyTemplate = (key: string) => {
    const t = PLAN_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    let left = total;
    setRows(
      t.parts.map((p, i) => {
        const amount = i === t.parts.length - 1 ? round2(left) : round2((total * p.pct) / 100);
        left = round2(left - amount);
        const base = p.from === "delivery" ? (deliveryDate ?? addDays(orderDate, 30)) : orderDate;
        return { label: p.label, amount: String(amount), dueDate: addDays(base, p.days) };
      }),
    );
  };
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async (list: Row[]) => {
    setBusy(true);
    const r = await runAction(savePaymentPlanAction(orderId, list.map((x) => ({ ...x, amount: Number(x.amount) }))));
    setBusy(false);
    if (r.ok) onDone(true);
  };

  return (
    <div className="space-y-2.5 rounded-2xl bg-muted/60 p-3">
      <NativeSelect aria-label="套用模板" value="" onChange={(e) => applyTemplate(e.target.value)} className="h-8">
        <option value="">套用常用付款方式…</option>
        {PLAN_TEMPLATES.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </NativeSelect>
      {!deliveryDate && <p className="text-xs text-muted-foreground">订单没填交货日期，尾款按下单后 30 天估算，可以手动改。</p>}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto] gap-1.5">
            <Input value={r.label} onChange={(e) => set(i, { label: e.target.value })} className="h-8 text-sm" aria-label={`第 ${i + 1} 期名称`} />
            <Button
              size="icon"
              variant="ghost"
              className="size-8 hover:text-destructive"
              aria-label={`删除第 ${i + 1} 期`}
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <div className="col-span-2 grid grid-cols-2 gap-1.5">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={r.amount}
                onChange={(e) => set(i, { amount: e.target.value })}
                className="h-8 text-sm"
                aria-label={`第 ${i + 1} 期金额`}
              />
              <Input type="date" value={r.dueDate} onChange={(e) => set(i, { dueDate: e.target.value })} className="h-8 text-sm" aria-label={`第 ${i + 1} 期到期日`} />
            </div>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() => setRows((rs) => [...rs, { label: `第 ${rs.length + 1} 期`, amount: diff > 0 ? String(diff) : "", dueDate: rs.at(-1)?.dueDate ?? orderDate }])}
      >
        <Plus className="size-3.5" /> 加一期
      </Button>
      <p className={cn("text-xs tabular-nums", diff === 0 ? "text-muted-foreground" : "text-amber-700")}>
        合计 {formatAmount(sum, currency)}
        {diff !== 0 && `，比订单金额${diff > 0 ? "少" : "多"} ${formatAmount(Math.abs(diff))}`}
      </p>
      <div className="flex justify-between gap-2">
        {plans.length > 0 ? (
          <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => save([])}>
            清空计划
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => onDone(false)}>
            取消
          </Button>
          <Button size="sm" disabled={busy || !rows.length} onClick={() => save(rows)}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
