"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { formatDateTime, toLocalInput } from "@/lib/crm";
import { deleteTaskAction, saveTaskAction, toggleTaskAction } from "@/app/(app)/schedule/actions";

export type TaskItem = {
  id: string;
  title: string;
  dueAt: string;
  done: boolean;
  customerId: string | null;
  customerName: string | null;
  ownerName?: string | null;
};

export function TaskForm({
  customerId,
  customers,
  tz,
  onDone,
}: {
  customerId?: string;
  customers?: { id: string; name: string }[];
  tz: string;
  onDone: () => void;
}) {
  const [state, submit, pending] = useActionForm(saveTaskAction, onDone);
  const [tomorrow] = useState(() => toLocalInput(new Date(Date.now() + 86_400_000), tz, false) + "T10:00");
  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>新建日程</DialogTitle>
      </DialogHeader>
      <FieldGroup className="gap-4 py-4">
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="t-title">内容</FieldLabel>
          <Input id="t-title" name="title" placeholder="如：给客户回报价、寄样品" required autoFocus />
          <FieldErrors state={state} name="title" />
        </Field>
        <Field>
          <FieldLabel htmlFor="t-due">时间</FieldLabel>
          <Input id="t-due" name="dueAt" type="datetime-local" defaultValue={tomorrow} required />
          <FieldErrors state={state} name="dueAt" />
        </Field>
        {customerId ? (
          <input type="hidden" name="customerId" value={customerId} />
        ) : (
          customers && (
            <Field>
              <FieldLabel htmlFor="t-customer">关联客户（可选）</FieldLabel>
              <NativeSelect id="t-customer" name="customerId" defaultValue="">
                <option value="">不关联</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TaskList({
  tasks,
  tz,
  showCustomer = true,
  empty = "没有日程",
}: {
  tasks: TaskItem[];
  tz: string;
  showCustomer?: boolean;
  empty?: string;
}) {
  const [now] = useState(() => Date.now());
  if (!tasks.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y">
      {tasks.map((t) => {
        const overdue = !t.done && new Date(t.dueAt).getTime() < now;
        return (
          <li key={t.id} className="group flex items-center gap-3 py-2.5">
            <Checkbox
              checked={t.done}
              aria-label={t.done ? "标记为未完成" : "标记为完成"}
              onCheckedChange={(v) => runAction(toggleTaskAction(t.id, !!v))}
            />
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm", t.done && "text-muted-foreground line-through")}>{t.title}</p>
              <p className="text-xs text-muted-foreground">
                <span className={cn("tabular-nums", overdue && "font-medium text-destructive")}>
                  {formatDateTime(t.dueAt, tz)}
                  {overdue && " 已逾期"}
                </span>
                {showCustomer && t.customerId && (
                  <>
                    {" · "}
                    <Link href={`/customers/${t.customerId}`} className="hover:text-primary hover:underline">
                      {t.customerName}
                    </Link>
                  </>
                )}
                {t.ownerName && ` · ${t.ownerName}`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label="删除日程"
              onClick={() => runAction(deleteTaskAction(t.id))}
            >
              <Trash2 />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
