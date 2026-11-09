"use client";

import { useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { DATA_SCOPE_OPTIONS, PERMISSION_GROUPS } from "@/lib/permissions";
import { deleteRoleAction, saveRoleAction } from "../actions";

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  systemKey: string | null;
  dataScope: string;
  permissions: string[];
  members: number;
};

const NEW = "__new__";

export function RoleEditor({ roles }: { roles: RoleRow[] }) {
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? NEW);
  const selected: RoleRow =
    roles.find((r) => r.id === selectedId) ??
    { id: "", name: "", description: "", systemKey: null, dataScope: "SELF", permissions: [], members: 0 };

  return (
    <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="space-y-2">
        <ul className="surface p-1">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                  r.id === selectedId ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "hover:bg-muted",
                )}
              >
                <span className="flex items-center gap-1.5">
                  {r.name}
                  {r.systemKey === "admin" && <Lock className="size-3 text-muted-foreground" />}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{r.members} 人</span>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" className="w-full" onClick={() => setSelectedId(NEW)}>
          <Plus /> 新建角色
        </Button>
      </div>
      <RoleForm key={selectedId} role={selected} onCreated={() => setSelectedId(roles[0]?.id ?? NEW)} />
    </div>
  );
}

function RoleForm({ role, onCreated }: { role: RoleRow; onCreated: () => void }) {
  const isNew = !role.id;
  const locked = role.systemKey === "admin";
  const [state, action, pending] = useActionForm(saveRoleAction, isNew ? onCreated : undefined);
  const [perms, setPerms] = useState<Set<string>>(new Set(role.permissions));

  const toggle = (key: string, on: boolean) =>
    setPerms((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <form onSubmit={action} className="surface">
      {role.id && <input type="hidden" name="id" value={role.id} />}
      {[...perms].map((p) => (
        <input key={p} type="hidden" name="permissions" value={p} />
      ))}
      <fieldset disabled={locked} className="contents">
        <div className="space-y-4 border-b p-5">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">{isNew ? "新建角色" : role.name}</h2>
            {role.systemKey && <Badge variant="secondary">内置</Badge>}
            {locked && <span className="text-xs text-muted-foreground">管理员拥有全部权限，不可修改</span>}
          </div>
          <FormMessage state={state} />
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="r-name">角色名称</FieldLabel>
              <Input id="r-name" name="name" defaultValue={role.name} required />
              <FieldErrors state={state} name="name" />
            </Field>
            <Field>
              <FieldLabel htmlFor="r-desc">说明</FieldLabel>
              <Input id="r-desc" name="description" defaultValue={role.description ?? ""} />
            </Field>
          </FieldGroup>
        </div>

        <div className="border-b p-5">
          <p className="mb-3 text-sm font-medium">数据范围</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {DATA_SCOPE_OPTIONS.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer gap-2 rounded-lg border p-3 text-sm has-checked:border-primary/50 has-checked:bg-primary/5"
              >
                <input type="radio" name="dataScope" value={o.value} defaultChecked={role.dataScope === o.value} className="mt-0.5 accent-primary" />
                <span>
                  <span className="font-medium">{o.label}</span>
                  <span className="block text-xs text-muted-foreground">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="p-5">
          <p className="mb-3 text-sm font-medium">功能权限</p>
          <div className="space-y-4">
            {PERMISSION_GROUPS.map((g) => {
              const all = g.items.every((i) => perms.has(i.key));
              return (
                <div key={g.key} className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={all}
                      onCheckedChange={(v) => g.items.forEach((i) => toggle(i.key, v === true))}
                    />
                    {g.label}
                  </label>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {g.items.map((i) => (
                      <label key={i.key} className="flex items-center gap-2 text-sm text-foreground/80">
                        <Checkbox checked={perms.has(i.key)} onCheckedChange={(v) => toggle(i.key, v === true)} />
                        {i.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </fieldset>

      {!locked && (
        <div className="flex items-center gap-2 border-t p-4">
          <Button type="submit" disabled={pending}>
            {pending ? "保存中…" : "保存"}
          </Button>
          {!isNew && !role.systemKey && (
            <Button
              type="button"
              variant="ghost"
              className="ml-auto text-destructive"
              onClick={() => {
                if (confirm(`确定删除角色「${role.name}」？`)) runAction(deleteRoleAction(role.id));
              }}
            >
              <Trash2 /> 删除角色
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
