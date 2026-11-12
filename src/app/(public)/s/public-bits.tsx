"use client";

import { useActionState } from "react";
import { CheckCircle2, Printer } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitShareFormAction, type SubmitState } from "./actions";
import { SHARE_FORMS, type ShareFormKind } from "./forms";

export function PublicPrintBar({ label }: { label: string }) {
  return (
    <div className="mx-auto mb-4 flex max-w-[210mm] justify-end px-2 print:hidden">
      <Button size="sm" onClick={() => window.print()}>
        <Printer /> {label}
      </Button>
    </div>
  );
}

export function ShareForm({ kind, token, seller }: { kind: ShareFormKind; token: string; seller: string }) {
  const form = SHARE_FORMS[kind];
  const [state, submit, pending] = useActionState<SubmitState, FormData>(submitShareFormAction.bind(null, kind, token), { ok: false });

  if (state.ok) {
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-2xl bg-card p-10 text-center shadow-card">
        <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
        <p className="mt-4 text-lg font-semibold">Submitted</p>
        <p className="mt-1.5 text-sm text-muted-foreground">{state.message}</p>
      </div>
    );
  }
  return (
    <form action={submit} className="mx-auto max-w-lg rounded-2xl bg-card p-6 shadow-card sm:p-8">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{seller}</p>
      <h1 className="mt-1 text-2xl font-normal tracking-tight">{form.title}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{form.intro}</p>
      <div className="mt-6 space-y-4">
        {form.fields.map((f) => (
          <label key={f.name} className="block">
            <span className="mb-1.5 block text-sm font-medium">
              {f.label}
              {f.required && <span className="text-destructive"> *</span>}
            </span>
            {f.type === "textarea" ? (
              <Textarea name={f.name} required={f.required} rows={3} placeholder={f.placeholder} />
            ) : (
              <Input name={f.name} type={f.type ?? "text"} required={f.required} placeholder={f.placeholder} />
            )}
          </label>
        ))}
      </div>
      {state.message && <p className="mt-4 text-sm text-destructive">{state.message}</p>}
      <Button type="submit" className="mt-6 w-full" disabled={pending}>
        {pending ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}
