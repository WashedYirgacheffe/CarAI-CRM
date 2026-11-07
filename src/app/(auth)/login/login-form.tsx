"use client";

import { useActionForm } from "@/hooks/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { loginAction } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionForm(loginAction);

  return (
    <form onSubmit={action}>
      {next && <input type="hidden" name="next" value={next} />}
      <FieldGroup>
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="email">邮箱</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
          <FieldErrors state={state} name="email" />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">密码</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
          <FieldErrors state={state} name="password" />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "登录中…" : "登录"}
        </Button>
      </FieldGroup>
    </form>
  );
}
