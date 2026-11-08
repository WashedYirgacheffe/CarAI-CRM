"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { useActionForm } from "@/hooks/use-action-form";
import { savePoolRulesAction } from "../business-actions";

export function PoolRulesForm({
  defaults,
}: {
  defaults: { poolRecycleDays: number; poolDailyClaimLimit: number; privateCustomerLimit: number };
}) {
  const [state, submit, pending] = useActionForm(savePoolRulesAction);
  return (
    <form onSubmit={submit} className="max-w-lg rounded-xl border bg-card p-6">
      <FieldGroup>
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="pr-days">未跟进自动回收（天）</FieldLabel>
          <Input id="pr-days" name="poolRecycleDays" type="number" min={0} defaultValue={defaults.poolRecycleDays} className="w-32" />
          <FieldDescription>私海客户超过这么多天没有跟进记录，自动回到公海。0 表示不自动回收。</FieldDescription>
          <FieldErrors state={state} name="poolRecycleDays" />
        </Field>
        <Field>
          <FieldLabel htmlFor="pr-claim">每人每天最多领取</FieldLabel>
          <Input id="pr-claim" name="poolDailyClaimLimit" type="number" min={0} defaultValue={defaults.poolDailyClaimLimit} className="w-32" />
          <FieldDescription>防止有人一次把公海客户全部领走。管理员「分配」不受此限制。</FieldDescription>
          <FieldErrors state={state} name="poolDailyClaimLimit" />
        </Field>
        <Field>
          <FieldLabel htmlFor="pr-limit">每人私海客户上限</FieldLabel>
          <Input id="pr-limit" name="privateCustomerLimit" type="number" min={0} defaultValue={defaults.privateCustomerLimit} className="w-32" />
          <FieldDescription>达到上限后不能再新建、领取或被转入客户。</FieldDescription>
          <FieldErrors state={state} name="privateCustomerLimit" />
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "保存中…" : "保存"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
