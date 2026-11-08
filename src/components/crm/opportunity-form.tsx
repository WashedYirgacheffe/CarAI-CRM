"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { useActionForm } from "@/hooks/use-action-form";
import { CURRENCIES, toLocalInput } from "@/lib/crm";
import { saveOpportunityAction } from "@/app/(app)/opportunities/actions";

export type StageOption = { id: string; name: string; probability: number; kind: "OPEN" | "WON" | "LOST" };

export type EditableOpportunity = {
  id?: string;
  customerId?: string;
  name?: string;
  amount?: string;
  currency?: string;
  stageId?: string;
  expectedCloseAt?: string | null;
  remark?: string | null;
};

export function OpportunityForm({
  opportunity,
  stages,
  customers,
  tz,
  onDone,
}: {
  opportunity: EditableOpportunity;
  stages: StageOption[];
  /** 不传时客户固定为 opportunity.customerId */
  customers?: { id: string; name: string }[];
  tz: string;
  onDone: () => void;
}) {
  const [state, submit, pending] = useActionForm(saveOpportunityAction, onDone);
  const o = opportunity;
  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{o.id ? "编辑商机" : "新建商机"}</DialogTitle>
      </DialogHeader>
      {o.id && <input type="hidden" name="id" value={o.id} />}
      <FieldGroup className="gap-4 py-4">
        <FormMessage state={state} />
        {customers && !o.id ? (
          <Field>
            <FieldLabel htmlFor="o-customer">客户</FieldLabel>
            <NativeSelect id="o-customer" name="customerId" defaultValue={o.customerId ?? ""} required>
              <option value="" disabled>
                选择客户
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <FieldErrors state={state} name="customerId" />
          </Field>
        ) : (
          <input type="hidden" name="customerId" value={o.customerId} />
        )}
        <Field>
          <FieldLabel htmlFor="o-name">商机名称</FieldLabel>
          <Input id="o-name" name="name" defaultValue={o.name} placeholder="如：2027 春季 LED 灯具订单" required autoFocus />
          <FieldErrors state={state} name="name" />
        </Field>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field>
            <FieldLabel htmlFor="o-amount">预计金额</FieldLabel>
            <Input id="o-amount" name="amount" type="number" min={0} step="0.01" defaultValue={o.amount ?? ""} />
            <FieldErrors state={state} name="amount" />
          </Field>
          <Field>
            <FieldLabel htmlFor="o-currency">币种</FieldLabel>
            <NativeSelect id="o-currency" name="currency" defaultValue={o.currency ?? "USD"}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="o-stage">阶段</FieldLabel>
            <NativeSelect id="o-stage" name="stageId" defaultValue={o.stageId ?? stages[0]?.id}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.probability}%）
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="o-close">预计成交日期</FieldLabel>
            <Input id="o-close" name="expectedCloseAt" type="date" defaultValue={toLocalInput(o.expectedCloseAt, tz, false)} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="o-remark">备注</FieldLabel>
          <Textarea id="o-remark" name="remark" defaultValue={o.remark ?? ""} rows={2} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </form>
  );
}
