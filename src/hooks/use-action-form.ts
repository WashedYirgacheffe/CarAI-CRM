"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { toast } from "sonner";
import { initialActionState, type ActionState } from "@/lib/action";

/**
 * 表单提交 + Server Action。
 * 返回的 submit 用在 <form onSubmit={submit}>：
 * 不走 <form action>，这样校验失败时 React 不会自动清空用户已填的内容。
 * 成功时 toast，并调用 onSuccess(form)（关闭弹窗、重置表单等）。
 */
export function useActionForm(
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>,
  onSuccess?: (form: HTMLFormElement) => void,
) {
  const [state, dispatch, pending] = useActionState(
    async (prev: ActionState, input: { fd: FormData; form: HTMLFormElement }) => {
      const result = await action(prev, input.fd);
      if (result.ok) {
        if (result.message) toast.success(result.message);
        onSuccess?.(input.form);
      }
      return result;
    },
    initialActionState,
  );

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    startTransition(() => dispatch({ fd, form }));
  };

  return [state, submit, pending] as const;
}

/** 直接调用的 action（删除、停用等），结果用 toast 提示 */
export async function runAction(p: Promise<ActionState>) {
  const r = await p;
  if (r.ok) toast.success(r.message ?? "操作成功");
  else toast.error(r.message ?? "操作失败");
  return r;
}
