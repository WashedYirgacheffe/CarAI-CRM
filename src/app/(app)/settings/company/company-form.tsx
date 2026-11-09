"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { useActionForm } from "@/hooks/use-action-form";
import { updateCompanyAction } from "../actions";

const CURRENCIES = ["USD", "EUR", "CNY", "GBP", "JPY", "AUD", "CAD", "HKD"];
const TIMEZONES = ["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"];

export function CompanyForm({
  defaults,
}: {
  defaults: { name: string; defaultCurrency: string; timezone: string };
}) {
  const [state, action, pending] = useActionForm(updateCompanyAction);
  return (
    <form onSubmit={action} className="max-w-lg surface p-6">
      <FieldGroup>
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="name">企业名称</FieldLabel>
          <Input id="name" name="name" defaultValue={defaults.name} required />
          <FieldErrors state={state} name="name" />
        </Field>
        <Field>
          <FieldLabel htmlFor="defaultCurrency">默认币种</FieldLabel>
          <NativeSelect id="defaultCurrency" name="defaultCurrency" defaultValue={defaults.defaultCurrency}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
          <FieldDescription>新建报价单、订单时默认使用。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="timezone">企业时区</FieldLabel>
          <NativeSelect id="timezone" name="timezone" defaultValue={defaults.timezone}>
            {TIMEZONES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </NativeSelect>
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
