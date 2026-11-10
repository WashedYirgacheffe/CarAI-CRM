"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { NativeSelect } from "@/components/native-select";
import { useActionForm } from "@/hooks/use-action-form";
import { savePoolRulesAction } from "../business-actions";

export function PoolRulesForm({
  defaults,
  segments,
}: {
  defaults: { poolRecycleDays: number; poolDailyClaimLimit: number; privateCustomerLimit: number; poolBasis: string; poolWarnDays: number };
  segments: { id: string; name: string; poolDays: number | null }[];
}) {
  const [state, submit, pending] = useActionForm(savePoolRulesAction);
  return (
    <form onSubmit={submit} className="max-w-2xl surface p-6">
      <FieldGroup>
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="pr-basis">回收依据</FieldLabel>
          <NativeSelect id="pr-basis" name="poolBasis" defaultValue={defaults.poolBasis} className="w-auto">
            <option value="contact">最近联系（收发邮件、WhatsApp、写跟进都算）</option>
            <option value="follow">最近跟进（只算销售手写的跟进记录）</option>
          </NativeSelect>
          <FieldDescription>从这个时间（或分配给负责人的时间，取较晚者）开始计算回收天数。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="pr-days">默认回收天数</FieldLabel>
          <Input id="pr-days" name="poolRecycleDays" type="number" min={0} defaultValue={defaults.poolRecycleDays} className="w-32" />
          <FieldDescription>私海客户超过这么多天没有联系/跟进，自动回到公海。0 表示不自动回收。</FieldDescription>
          <FieldErrors state={state} name="poolRecycleDays" />
        </Field>
        <Field>
          <FieldLabel>按客群单独设置</FieldLabel>
          {segments.length ? (
            <div className="divide-y divide-background rounded-2xl bg-muted/60">
              {segments.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate">{s.name}</span>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Input
                      name={`seg_${s.id}`}
                      type="number"
                      min={0}
                      defaultValue={s.poolDays ?? ""}
                      placeholder="默认"
                      className="w-24"
                      aria-label={`${s.name} 回收天数`}
                    />
                    天
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-foreground/20 px-3 py-4 text-center text-sm text-muted-foreground">
              还没有共享客群。在「我的客户」里筛选后「存为客群」并勾选全公司共享，就能在这里单独设置。
            </p>
          )}
          <FieldDescription>留空 = 用默认天数，0 = 该客群不自动回收。客户同时属于多个客群时，按列表顺序第一个生效。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="pr-warn">提前提醒（天）</FieldLabel>
          <Input id="pr-warn" name="poolWarnDays" type="number" min={0} max={60} defaultValue={defaults.poolWarnDays} className="w-32" />
          <FieldDescription>客户进公海前这么多天，给负责人建一条待办提醒。0 表示不提醒。</FieldDescription>
          <FieldErrors state={state} name="poolWarnDays" />
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
