"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { useActionForm } from "@/hooks/use-action-form";
import { CURRENCIES, formatDateTime } from "@/lib/crm";
import { saveDocSettingsAction, saveRatesAction } from "../business-actions";

type DocDefaults = {
  name: string;
  docCompanyName: string;
  docAddress: string;
  docPhone: string;
  docEmail: string;
  docWebsite: string;
  docBankInfo: string;
  docQuotationTerms: string;
  quotationValidDays: number;
};

const BANK_PLACEHOLDER = `Beneficiary: ...
Bank Name: ...
Bank Address: ...
Account No.: ...
SWIFT Code: ...`;

const TERMS_PLACEHOLDER = `1. Prices are valid for 30 days.
2. Samples available upon request.
3. Packing: standard export carton.`;

export function DocSettingsForm({ defaults: d }: { defaults: DocDefaults }) {
  const [state, submit, pending] = useActionForm(saveDocSettingsAction);
  return (
    <form onSubmit={submit} className="rounded-xl border bg-card p-6">
      <FieldGroup>
        <FormMessage state={state} />
        <h2 className="font-medium">单据抬头（英文）</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ds-name">公司英文名</FieldLabel>
            <Input id="ds-name" name="docCompanyName" defaultValue={d.docCompanyName} placeholder={d.name} />
            <FieldDescription>不填则使用企业名称「{d.name}」</FieldDescription>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ds-addr">地址</FieldLabel>
            <Textarea id="ds-addr" name="docAddress" defaultValue={d.docAddress} rows={2} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ds-phone">电话</FieldLabel>
            <Input id="ds-phone" name="docPhone" defaultValue={d.docPhone} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ds-email">邮箱</FieldLabel>
            <Input id="ds-email" name="docEmail" defaultValue={d.docEmail} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ds-web">网站</FieldLabel>
            <Input id="ds-web" name="docWebsite" defaultValue={d.docWebsite} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="ds-bank">收款银行信息</FieldLabel>
          <Textarea id="ds-bank" name="docBankInfo" defaultValue={d.docBankInfo} rows={5} placeholder={BANK_PLACEHOLDER} />
          <FieldDescription>原样打印在报价单和 PI 底部</FieldDescription>
        </Field>
        <h2 className="pt-2 font-medium">报价默认值</h2>
        <Field>
          <FieldLabel htmlFor="ds-days">默认有效期（天）</FieldLabel>
          <Input id="ds-days" name="quotationValidDays" type="number" min={0} max={365} defaultValue={d.quotationValidDays} className="w-32" />
          <FieldDescription>新建报价单时自动填「有效期至」；0 表示不填</FieldDescription>
          <FieldErrors state={state} name="quotationValidDays" />
        </Field>
        <Field>
          <FieldLabel htmlFor="ds-terms">默认条款</FieldLabel>
          <Textarea id="ds-terms" name="docQuotationTerms" defaultValue={d.docQuotationTerms} rows={5} placeholder={TERMS_PLACEHOLDER} />
          <FieldDescription>新建报价单、订单时自动带入，可在单据里修改</FieldDescription>
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

export function RatesForm({ rates, updatedAt, tz }: { rates: Record<string, number>; updatedAt: string | null; tz: string }) {
  const [state, submit, pending] = useActionForm(saveRatesAction);
  return (
    <form onSubmit={submit} className="self-start rounded-xl border bg-card p-6">
      <FieldGroup className="gap-4">
        <div>
          <h2 className="font-medium">汇率</h2>
          <p className="mt-1 text-sm text-muted-foreground">1 单位外币折合多少人民币。单据保存时记下当时的汇率，之后改汇率不影响旧单据。</p>
        </div>
        <FormMessage state={state} />
        {CURRENCIES.filter((c) => c !== "CNY").map((c) => (
          <Field key={c} orientation="horizontal" className="items-start">
            <FieldLabel htmlFor={`rate-${c}`} className="w-20 shrink-0 pt-2 tabular-nums">
              1 {c} =
            </FieldLabel>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Input id={`rate-${c}`} name={c} type="number" min={0} step="any" defaultValue={rates[c] ?? ""} className="tabular-nums" required />
                <span className="text-sm text-muted-foreground">CNY</span>
              </div>
              <FieldErrors state={state} name={c} />
            </div>
          </Field>
        ))}
        {updatedAt && <p className="text-xs text-muted-foreground">最近更新：{formatDateTime(updatedAt, tz)}</p>}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "保存中…" : "保存汇率"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
