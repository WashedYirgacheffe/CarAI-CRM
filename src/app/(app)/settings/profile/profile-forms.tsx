"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { useActionForm } from "@/hooks/use-action-form";
import { changePasswordAction, updateProfileAction } from "../actions";

export function ProfileForm({ name, phone }: { name: string; phone: string }) {
  const [state, action, pending] = useActionForm(updateProfileAction);
  return (
    <form onSubmit={action} className="surface p-6">
      <h2 className="mb-4 font-medium">基本信息</h2>
      <FieldGroup>
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="p-name">姓名</FieldLabel>
          <Input id="p-name" name="name" defaultValue={name} required />
          <FieldErrors state={state} name="name" />
        </Field>
        <Field>
          <FieldLabel htmlFor="p-phone">手机</FieldLabel>
          <Input id="p-phone" name="phone" defaultValue={phone} />
        </Field>
        <div>
          <Button type="submit" disabled={pending}>保存</Button>
        </div>
      </FieldGroup>
    </form>
  );
}

export function PasswordForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionForm(changePasswordAction, (form) => form.reset());
  return (
    <form ref={ref} onSubmit={action} className="surface p-6">
      <h2 className="mb-4 font-medium">修改密码</h2>
      <FieldGroup>
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="pw-current">当前密码</FieldLabel>
          <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
          <FieldErrors state={state} name="current" />
        </Field>
        <Field>
          <FieldLabel htmlFor="pw-next">新密码</FieldLabel>
          <Input id="pw-next" name="next" type="password" autoComplete="new-password" minLength={8} required />
          <FieldErrors state={state} name="next" />
        </Field>
        <Field>
          <FieldLabel htmlFor="pw-confirm">确认新密码</FieldLabel>
          <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required />
          <FieldErrors state={state} name="confirm" />
        </Field>
        <div>
          <Button type="submit" disabled={pending}>修改密码</Button>
        </div>
      </FieldGroup>
    </form>
  );
}
