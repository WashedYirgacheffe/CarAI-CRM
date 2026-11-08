"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { STATUS_COLORS, STATUS_COLOR_NAMES } from "@/lib/crm";
import { StatusBadge } from "@/components/crm/bits";
import { deleteGroupAction, deleteStatusAction, saveGroupAction, saveStatusAction } from "../business-actions";

type Status = { id: string; name: string; color: string; count: number };
type Group = { id: string; name: string; parentId: string | null; count: number };

const COLOR_LABEL: Record<string, string> = { slate: "灰", blue: "蓝", amber: "黄", emerald: "绿", violet: "紫", rose: "红" };

function flatten(groups: Group[]) {
  const out: (Group & { depth: number })[] = [];
  const walk = (pid: string | null, depth: number) => {
    for (const g of groups.filter((x) => x.parentId === pid)) {
      out.push({ ...g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function ClassifySettings({ statuses, groups }: { statuses: Status[]; groups: Group[] }) {
  const [status, setStatus] = useState<Partial<Status> | null>(null);
  const [group, setGroup] = useState<Partial<Group> | null>(null);
  const tree = flatten(groups);
  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">客户状态</CardTitle>
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setStatus({ color: "slate" })}>
              <Plus /> 添加
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {statuses.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <StatusBadge name={s.name} color={s.color} />
                <span className="text-xs text-muted-foreground tabular-nums">{s.count} 个客户</span>
                <span className="ml-auto">
                  <Button variant="ghost" size="icon-sm" aria-label={`编辑 ${s.name}`} onClick={() => setStatus(s)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`删除 ${s.name}`} onClick={() => runAction(deleteStatusAction(s.id))}>
                    <Trash2 />
                  </Button>
                </span>
              </li>
            ))}
            {!statuses.length && <li className="py-6 text-center text-sm text-muted-foreground">还没有状态</li>}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">客户分组</CardTitle>
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setGroup({})}>
              <Plus /> 添加
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {tree.map((g) => (
              <li key={g.id} className="flex items-center gap-3 py-2" style={{ paddingLeft: `${g.depth * 1.25}rem` }}>
                <span className={cn("text-sm", g.depth === 0 && "font-medium")}>{g.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{g.count} 个客户</span>
                <span className="ml-auto">
                  {g.depth < 2 && (
                    <Button variant="ghost" size="icon-sm" aria-label={`在 ${g.name} 下添加`} onClick={() => setGroup({ parentId: g.id })}>
                      <Plus />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-sm" aria-label={`编辑 ${g.name}`} onClick={() => setGroup(g)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`删除 ${g.name}`} onClick={() => runAction(deleteGroupAction(g.id))}>
                    <Trash2 />
                  </Button>
                </span>
              </li>
            ))}
            {!tree.length && <li className="py-6 text-center text-sm text-muted-foreground">还没有分组</li>}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={!!status} onOpenChange={(o) => !o && setStatus(null)}>
        <DialogContent>{status && <StatusForm key={status.id ?? "new"} status={status} onDone={() => setStatus(null)} />}</DialogContent>
      </Dialog>
      <Dialog open={!!group} onOpenChange={(o) => !o && setGroup(null)}>
        <DialogContent>
          {group && <GroupForm key={group.id ?? `new-${group.parentId}`} group={group} tree={tree} onDone={() => setGroup(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusForm({ status, onDone }: { status: Partial<Status>; onDone: () => void }) {
  const [state, submit, pending] = useActionForm(saveStatusAction, onDone);
  const [color, setColor] = useState(status.color ?? "slate");
  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{status.id ? "编辑状态" : "添加状态"}</DialogTitle>
      </DialogHeader>
      {status.id && <input type="hidden" name="id" value={status.id} />}
      <input type="hidden" name="color" value={color} />
      <FieldGroup className="gap-4 py-4">
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="cs-name">状态名称</FieldLabel>
          <Input id="cs-name" name="name" defaultValue={status.name} required autoFocus />
          <FieldErrors state={state} name="name" />
        </Field>
        <Field>
          <FieldLabel>颜色</FieldLabel>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="颜色">
            {STATUS_COLOR_NAMES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                onClick={() => setColor(c)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium",
                  STATUS_COLORS[c],
                  color === c && "ring-2 ring-ring ring-offset-1",
                )}
              >
                {COLOR_LABEL[c]}
              </button>
            ))}
          </div>
        </Field>
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

function GroupForm({ group, tree, onDone }: { group: Partial<Group>; tree: (Group & { depth: number })[]; onDone: () => void }) {
  const [state, submit, pending] = useActionForm(saveGroupAction, onDone);
  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{group.id ? "编辑分组" : "添加分组"}</DialogTitle>
      </DialogHeader>
      {group.id && <input type="hidden" name="id" value={group.id} />}
      <FieldGroup className="gap-4 py-4">
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="cg-name">分组名称</FieldLabel>
          <Input id="cg-name" name="name" defaultValue={group.name} required autoFocus />
          <FieldErrors state={state} name="name" />
        </Field>
        <Field>
          <FieldLabel htmlFor="cg-parent">上级分组</FieldLabel>
          <NativeSelect id="cg-parent" name="parentId" defaultValue={group.parentId ?? ""}>
            <option value="">无（一级分组）</option>
            {tree
              .filter((g) => g.depth < 2 && g.id !== group.id)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {"　".repeat(g.depth) + g.name}
                </option>
              ))}
          </NativeSelect>
          <FieldErrors state={state} name="parentId" />
        </Field>
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
