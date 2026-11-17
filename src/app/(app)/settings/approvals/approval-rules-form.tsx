"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { useActionForm } from "@/hooks/use-action-form";
import { saveApprovalRulesAction } from "../business-actions";

const SWITCHES = [
  { name: "approvalRelease", label: "业务员把客户退回公海", hint: "防止好客户被随手丢回公海，或者私下转给别人领取" },
  { name: "approvalDelete", label: "删除客户", hint: "删除会连同联系人、跟进、单据一起删掉，不能恢复" },
  { name: "approvalTransfer", label: "把客户转给别的成员", hint: "转移后原负责人就看不到这个客户了" },
] as const;

export function ApprovalRulesForm({
  defaults,
}: {
  defaults: { approvalDiscountPct: number; approvalRelease: boolean; approvalDelete: boolean; approvalTransfer: boolean };
}) {
  const [state, submit, pending] = useActionForm(saveApprovalRulesAction);
  return (
    <form onSubmit={submit} className="max-w-2xl surface p-6">
      <FieldGroup>
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="ar-discount">报价单 / 订单折扣超过</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="ar-discount"
              name="approvalDiscountPct"
              type="number"
              min={0}
              max={100}
              defaultValue={defaults.approvalDiscountPct}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">% 要审批</span>
          </div>
          <FieldDescription>
            折扣 = 单据上的「折扣」金额 ÷ 产品小计。超过后报价单要审批通过才能发给客户；新订单先存为草稿，通过后自动确认。0 表示不需要审批。
          </FieldDescription>
          <FieldErrors state={state} name="approvalDiscountPct" />
        </Field>
        <Field>
          <FieldLabel>以下操作也要审批</FieldLabel>
          <div className="divide-y divide-background rounded-2xl bg-muted/60">
            {SWITCHES.map((s) => (
              <label key={s.name} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm">
                <input type="checkbox" name={s.name} defaultChecked={defaults[s.name]} className="mt-0.5 size-4 accent-primary" />
                <span>
                  <span className="font-medium">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <FieldDescription>
            有「审批」权限的人（默认是管理员和销售经理）自己操作时不用审批，并且负责处理别人的申请。可在「角色权限」里调整。
          </FieldDescription>
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
