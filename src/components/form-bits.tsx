"use client";

import { FieldError } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionState } from "@/lib/action";

/** 把 ActionState.fieldErrors[name] 渲染成字段下方的错误提示 */
export function FieldErrors({ state, name }: { state: ActionState; name: string }) {
  const errors = state.fieldErrors?.[name];
  if (!errors?.length) return null;
  return <FieldError errors={errors.map((message) => ({ message }))} />;
}

/** 表单顶部的整体错误提示 */
export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message || state.ok) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}
