"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { runAction } from "@/hooks/use-action-form";
import { COUNTRIES, formatDateTime } from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { Suggestion } from "@/server/suggestions";
import { createFromSuggestionAction, ignoreSuggestionAction } from "./actions";

export function SuggestionList({ rows, tz }: { rows: Suggestion[]; tz: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<"all" | "mail" | "wa">("all");
  const [creating, setCreating] = useState<Suggestion | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = rows.filter((r) => !hidden.has(r.key) && (kind === "all" || r.kind === kind));

  const ignore = async (s: Suggestion) => {
    const r = await runAction(ignoreSuggestionAction(s.key));
    if (r.ok) setHidden((h) => new Set(h).add(s.key));
  };

  return (
    <>
      <div className="mb-3 flex gap-1">
        {(
          [
            ["all", "全部", rows.length],
            ["mail", "邮件", rows.filter((r) => r.kind === "mail").length],
            ["wa", "WhatsApp", rows.filter((r) => r.kind === "wa").length],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              "rounded-full px-3 py-1 text-sm transition-colors",
              kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {label} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="surface py-16 text-center text-sm text-muted-foreground">暂时没有需要建档的往来对象</p>
      ) : (
        <ul className="divide-y surface">
          {shown.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {s.kind === "mail" ? <Mail className="size-4" /> : <MessageCircle className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {s.name || s.address}
                  {s.name && <span className="ml-2 font-normal text-muted-foreground">{s.address}</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.kind === "mail" ? `${s.count} 封往来邮件（收到 ${s.inCount} 封）` : `${s.count} 条消息`} · 最近{" "}
                  <span className="tabular-nums">{formatDateTime(s.lastAt, tz)}</span>
                  {s.lastText && ` · ${s.lastText}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => ignore(s)}>
                  忽略
                </Button>
                <Button size="sm" onClick={() => setCreating(s)}>
                  <UserPlus /> 建档
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)}>
        <DialogContent className="sm:max-w-md">
          {creating && (
            <CreateForm
              s={creating}
              onDone={(id) => {
                setCreating(null);
                if (id) router.push(`/customers/${id}`);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateForm({ s, onDone }: { s: Suggestion; onDone: (id?: string) => void }) {
  const [company, setCompany] = useState(s.company);
  const [contactName, setContactName] = useState(s.name ?? "");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await createFromSuggestionAction({ kind: s.kind, ref: s.ref, company, contactName, country });
    await runAction(Promise.resolve(r));
    setBusy(false);
    if (r.ok) onDone(r.id);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>建档：{s.address}</DialogTitle>
        <DialogDescription>新客户的负责人是你，{s.kind === "mail" ? "和这个邮箱的往来邮件" : "这个 WhatsApp 会话"}会自动归到客户下。</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="sg-company">公司名称</FieldLabel>
          <Input id="sg-company" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={200} autoFocus />
        </Field>
        <Field>
          <FieldLabel htmlFor="sg-contact">联系人姓名</FieldLabel>
          <Input id="sg-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={100} />
        </Field>
        <Field>
          <FieldLabel htmlFor="sg-country">国家 / 地区</FieldLabel>
          <NativeSelect id="sg-country" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">未知</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button variant="outline" onClick={() => onDone()}>
          取消
        </Button>
        <Button onClick={submit} disabled={busy || company.trim().length < 2}>
          {busy ? "建档中…" : "建档"}
        </Button>
      </DialogFooter>
    </>
  );
}
