"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { deleteDepartmentAction, saveDepartmentAction } from "../actions";

export type DeptNode = { id: string; name: string; parentId: string | null; depth: number; members: number };

export function DepartmentTree({ nodes }: { nodes: DeptNode[] }) {
  const [editing, setEditing] = useState<Partial<DeptNode> | null>(null);

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setEditing({ parentId: nodes[0]?.id })}>
          <Plus /> 新建部门
        </Button>
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {nodes.map((d) => (
          <li key={d.id} className="group flex items-center gap-3 px-4 py-3">
            <span style={{ paddingLeft: d.depth * 20 }} className="flex items-center gap-2">
              {d.depth > 0 && <span className="text-muted-foreground/50">└</span>}
              <span className={d.depth === 0 ? "font-medium" : ""}>{d.name}</span>
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="size-3.5" />
              {d.members}
            </span>
            <span className="ml-auto flex gap-1 opacity-60 group-hover:opacity-100">
              <Button variant="ghost" size="icon-sm" aria-label="新建下级部门" onClick={() => setEditing({ parentId: d.id })}>
                <Plus />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="编辑" onClick={() => setEditing(d)}>
                <Pencil />
              </Button>
              {d.parentId && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="删除"
                  onClick={() => {
                    if (confirm(`确定删除部门「${d.name}」？`)) runAction(deleteDepartmentAction(d.id));
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && <DeptForm key={editing.id ?? "new"} dept={editing} nodes={nodes} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeptForm({ dept, nodes, onDone }: { dept: Partial<DeptNode>; nodes: DeptNode[]; onDone: () => void }) {
  const [state, action, pending] = useActionForm(saveDepartmentAction, onDone);
  const isRoot = dept.id && !dept.parentId;
  return (
    <form onSubmit={action}>
      <DialogHeader>
        <DialogTitle>{dept.id ? "编辑部门" : "新建部门"}</DialogTitle>
      </DialogHeader>
      {dept.id && <input type="hidden" name="id" value={dept.id} />}
      <FieldGroup className="py-4">
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="dept-name">部门名称</FieldLabel>
          <Input id="dept-name" name="name" defaultValue={dept.name} required autoFocus />
          <FieldErrors state={state} name="name" />
        </Field>
        {isRoot ? (
          <input type="hidden" name="parentId" value="__root__" />
        ) : (
          <Field>
            <FieldLabel htmlFor="dept-parent">上级部门</FieldLabel>
            <NativeSelect id="dept-parent" name="parentId" defaultValue={dept.parentId ?? undefined}>
              {nodes
                .filter((n) => n.id !== dept.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {"　".repeat(n.depth)}
                    {n.name}
                  </option>
                ))}
            </NativeSelect>
            <FieldErrors state={state} name="parentId" />
          </Field>
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
