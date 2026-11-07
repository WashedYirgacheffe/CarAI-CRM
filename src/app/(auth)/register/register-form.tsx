"use client";

import { useActionForm } from "@/hooks/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { registerAction } from "../actions";

export function RegisterForm() {
  const [state, action, pending] = useActionForm(registerAction);

  return (
    <form onSubmit={action}>
      <FieldGroup>
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="companyName">企业名称</FieldLabel>
          <Input id="companyName" name="companyName" required autoFocus placeholder="例如：宁波某某进出口有限公司" />
          <FieldErrors state={state} name="companyName" />
        </Field>
        <Field>
          <FieldLabel htmlFor="name">你的姓名</FieldLabel>
          <Input id="name" name="name" autoComplete="name" required />
          <FieldErrors state={state} name="name" />
        </Field>
        <Field>
          <FieldLabel htmlFor="email">工作邮箱</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required />
          <FieldDescription>用于登录，建议使用企业域名邮箱。</FieldDescription>
          <FieldErrors state={state} name="email" />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">登录密码</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          <FieldDescription>至少 8 位。</FieldDescription>
          <FieldErrors state={state} name="password" />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "正在创建…" : "创建企业并进入"}
        </Button>
      </FieldGroup>
    </form>
  );
}
