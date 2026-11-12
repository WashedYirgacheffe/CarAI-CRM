"use client";

import { useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { useActionForm } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS, formatAmount, round2 } from "@/lib/docs";
import { addPaymentAction, deletePaymentAction } from "../actions";

type Payment = { id: string; amount: string; receivedAt: string; method: string | null; remark: string | null };

export function PaymentsCard({
  orderId,
  canEdit,
  currency,
  total,
  paid,
  today,
  payments,
}: {
  orderId: string;
  canEdit: boolean;
  currency: string;
  total: string;
  paid: string;
  today: string;
  payments: Payment[];
}) {
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Payment | null>(null);
  const [state, submit, pending] = useActionForm(addPaymentAction, (form) => {
    form.reset();
    setAdding(false);
  });
  const outstanding = round2(Number(total) - Number(paid));
  const pct = Number(total) > 0 ? Math.min(100, Math.round((Number(paid) / Number(total)) * 100)) : 0;

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

        {adding && (
          <form onSubmit={submit} className="space-y-3 rounded-2xl bg-muted/60 p-3.5">
            <input type="hidden" name="orderId" value={orderId} />
            <FormMessage state={state} />
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="pay-amount">金额（{currency}）</FieldLabel>
                <Input
                  id="pay-amount"
                  name="amount"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={outstanding > 0 ? outstanding : ""}
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
            </div>
            <Field>
              <FieldLabel htmlFor="pay-method">方式</FieldLabel>
              <NativeSelect id="pay-method" name="method" defaultValue={PAYMENT_METHODS[0]}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </NativeSelect>
            </Field>
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
                  <p className="font-medium tabular-nums">{formatAmount(p.amount, currency)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="tabular-nums">{p.receivedAt}</span>
                    {p.method && ` · ${p.method}`}
                    {p.remark && ` · ${p.remark}`}
                  </p>
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
