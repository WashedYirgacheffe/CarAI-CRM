"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Clock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { useActionForm } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { SEQUENCE_PRESETS, SEQUENCE_VARS, renderTemplate } from "@/lib/sequences";
import { saveSequenceAction } from "./actions";

type Step = { key: number; delayDays: number; subject: string; body: string };
export type EditableSequence = {
  id?: string;
  name: string;
  accountId: string;
  dailyLimit: number;
  workHours: boolean;
  stopOnReply: boolean;
  steps: { delayDays: number; subject: string; body: string }[];
};

let seed = 1;

export function SequenceEditor({
  sequence,
  accounts,
  senderName,
}: {
  sequence: EditableSequence;
  accounts: { id: string; email: string }[];
  senderName: string;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>(() => sequence.steps.map((s) => ({ ...s, key: seed++ })));
  const [active, setActive] = useState(0);
  const [name, setName] = useState(sequence.name);
  const focused = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; i: number; field: "subject" | "body" } | null>(null);
  const [state, submit, pending] = useActionForm(saveSequenceAction, (_f, r) => {
    router.push(`/marketing/${r.id}`);
  });

  const update = (i: number, patch: Partial<Step>) => setSteps((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((list) => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      setActive(i + d);
      return next;
    });

  function insertVar(key: string) {
    const f = focused.current;
    const token = `{{${key}}}`;
    if (!f) {
      update(active, { body: `${steps[active]?.body ?? ""}${token}` });
      return;
    }
    const { el, i, field } = f;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const value = el.value.slice(0, start) + token + el.value.slice(end);
    update(i, { [field]: value });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function applyPreset(key: string) {
    const p = SEQUENCE_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setSteps(p.steps.map((s) => ({ ...s, key: seed++ })));
    if (!name.trim()) setName(p.name);
    setActive(0);
  }

  const sample = Object.fromEntries(SEQUENCE_VARS.map((v) => [v.key, v.key === "sender" ? senderName : v.sample]));
  const preview = steps[active];
  // 第 N 封相对加入的累计天数
  const dayOf = (i: number) => steps.slice(0, i + 1).reduce((n, s) => n + (Number(s.delayDays) || 0), 0);

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      {sequence.id && <input type="hidden" name="id" value={sequence.id} />}
      <input type="hidden" name="steps" value={JSON.stringify(steps.map(({ delayDays, subject, body }) => ({ delayDays, subject, body })))} />

      <div className="flex min-w-0 flex-col gap-4">
        <section className="surface p-4 md:p-5">
          <FieldGroup className="gap-4">
            <FormMessage state={state} />
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
              <Field>
                <FieldLabel htmlFor="s-name">序列名称</FieldLabel>
                <Input id="s-name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：德国经销商开发信" required />
                <FieldErrors state={state} name="name" />
              </Field>
              <Field>
                <FieldLabel htmlFor="s-account">发件邮箱</FieldLabel>
                <NativeSelect id="s-account" name="accountId" defaultValue={sequence.accountId} required>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email}
                    </option>
                  ))}
                </NativeSelect>
                <FieldErrors state={state} name="accountId" />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
              <label className="flex items-center gap-2">
                每天最多发
                <Input name="dailyLimit" type="number" min={1} max={2000} defaultValue={sequence.dailyLimit} className="h-8 w-20 tabular-nums" />封
              </label>
              <label className="flex items-center gap-2">
                <Checkbox name="workHours" defaultChecked={sequence.workHours} />
                只在工作日 9–18 点发送
              </label>
              <label className="flex items-center gap-2">
                <Checkbox name="stopOnReply" defaultChecked={sequence.stopOnReply} />
                客户回复后停止后续邮件
              </label>
            </div>
            <FieldErrors state={state} name="dailyLimit" />
          </FieldGroup>
        </section>

        <section className="surface p-4 md:p-5">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">邮件内容</h2>
            <NativeSelect aria-label="套用模板" className="h-8 w-auto text-sm" value="" onChange={(e) => applyPreset(e.target.value)}>
              <option value="">套用模板…</option>
              {SEQUENCE_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </header>
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">插入变量：</span>
            {SEQUENCE_VARS.map((v) => (
              <button
                key={v.key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertVar(v.key)}
                className="rounded-full bg-primary/8 px-2.5 py-1 font-medium text-primary hover:bg-primary/15"
              >
                {v.label}
              </button>
            ))}
            <span className="text-muted-foreground">没有值时自动用 there / your company 兜底</span>
          </div>

          <ol className="flex flex-col gap-3">
            {steps.map((s, i) => (
              <li
                key={s.key}
                onFocusCapture={() => setActive(i)}
                className={cn(
                  "rounded-xl border p-3 transition-colors md:p-4",
                  active === i ? "border-primary/40 bg-primary/[0.03]" : "border-border/70",
                )}
              >
                <div className="mb-2.5 flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                    {i + 1}
                  </span>
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{i === 0 ? "加入后" : "上一封后"}</span>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={s.delayDays}
                    onChange={(e) => update(i, { delayDays: Math.max(0, Number(e.target.value) || 0) })}
                    className="h-7 w-16 tabular-nums"
                    aria-label="间隔天数"
                  />
                  <span className="text-muted-foreground">天发送{s.delayDays === 0 && i === 0 ? "（立即）" : ""}</span>
                  <span className="text-xs text-muted-foreground/80">· 第 {dayOf(i)} 天</span>
                  <span className="ml-auto flex">
                    <Button type="button" variant="ghost" size="icon-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上移">
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={i === steps.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="下移"
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={steps.length === 1}
                      onClick={() => {
                        setSteps((list) => list.filter((_, j) => j !== i));
                        setActive(Math.max(0, i - 1));
                      }}
                      aria-label="删除这封"
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </div>
                <Input
                  value={s.subject}
                  placeholder="主题"
                  onChange={(e) => update(i, { subject: e.target.value })}
                  onFocus={(e) => (focused.current = { el: e.currentTarget, i, field: "subject" })}
                  className="mb-2"
                  aria-label={`第 ${i + 1} 封主题`}
                />
                <Textarea
                  value={s.body}
                  placeholder="正文（签名会自动附在末尾）"
                  rows={active === i ? 9 : 4}
                  onChange={(e) => update(i, { body: e.target.value })}
                  onFocus={(e) => (focused.current = { el: e.currentTarget, i, field: "body" })}
                  aria-label={`第 ${i + 1} 封正文`}
                />
              </li>
            ))}
          </ol>
          {steps.length < 10 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setSteps((list) => [...list, { key: seed++, delayDays: 3, subject: list.length ? `Re: ${list[0].subject}` : "", body: "" }]);
                setActive(steps.length);
              }}
            >
              <Plus /> 再加一封跟进
            </Button>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
        <section className="surface p-4">
          <h2 className="text-sm text-muted-foreground">预览 · 第 {active + 1} 封</h2>
          {preview ? (
            <div className="mt-3 text-sm">
              <p className="font-medium break-words">{renderTemplate(preview.subject, sample) || "（无主题）"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                发给 {sample.name} · {sample.company}
              </p>
              <div className="mt-3 max-h-96 overflow-y-auto border-t border-border/70 pt-3 leading-relaxed break-words whitespace-pre-wrap">
                {renderTemplate(preview.body, sample) || <span className="text-muted-foreground">（无正文）</span>}
              </div>
              <p className="mt-3 border-t border-border/70 pt-2 text-xs text-muted-foreground">末尾自动附退订链接，并追踪打开和点击</p>
            </div>
          ) : null}
        </section>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending} className="flex-1">
            {pending ? "保存中…" : sequence.id ? "保存" : "创建并添加收件人"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href={sequence.id ? `/marketing/${sequence.id}` : "/marketing"}>取消</Link>
          </Button>
        </div>
      </aside>
    </form>
  );
}
