"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { deleteStageAction, moveStageAction, saveStageAction } from "../business-actions";

type Stage = { id: string; name: string; probability: number; kind: "OPEN" | "WON" | "LOST"; count: number };
const KIND = { OPEN: "进行中", WON: "赢单", LOST: "输单" } as const;

export function StageTable({ stages }: { stages: Stage[] }) {
  const [editing, setEditing] = useState<Partial<Stage> | null>(null);
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setEditing({ kind: "OPEN", probability: 50 })}>
          <Plus /> 添加阶段
        </Button>
      </div>
      <div className="max-w-3xl surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 pl-2 md:w-24 md:pl-4">顺序</TableHead>
              <TableHead>阶段</TableHead>
              <TableHead className="hidden md:table-cell">赢率</TableHead>
              <TableHead className="hidden md:table-cell">类型</TableHead>
              <TableHead className="hidden md:table-cell">商机数</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {stages.map((s, i) => (
              <TableRow key={s.id}>
                <TableCell className="pl-2 whitespace-nowrap md:pl-4">
                  <Button variant="ghost" size="icon-xs" aria-label="上移" disabled={i === 0} onClick={() => runAction(moveStageAction(s.id, -1))}>
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="下移"
                    disabled={i === stages.length - 1}
                    onClick={() => runAction(moveStageAction(s.id, 1))}
                  >
                    <ArrowDown />
                  </Button>
                </TableCell>
                <TableCell className="font-medium whitespace-normal">
                  {s.name}
                  <span className="block text-xs font-normal text-muted-foreground md:hidden">
                    赢率 {s.probability}% · {KIND[s.kind]} · {s.count} 个商机
                  </span>
                </TableCell>
                <TableCell className="hidden tabular-nums md:table-cell">{s.probability}%</TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant={s.kind === "OPEN" ? "outline" : "secondary"}>{KIND[s.kind]}</Badge>
                </TableCell>
                <TableCell className="hidden tabular-nums md:table-cell">{s.count}</TableCell>
                <TableCell className="pr-2 whitespace-nowrap md:pr-4">
                  <Button variant="ghost" size="icon-sm" aria-label={`编辑 ${s.name}`} onClick={() => setEditing(s)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`删除 ${s.name}`} onClick={() => runAction(deleteStageAction(s.id))}>
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>{editing && <StageForm key={editing.id ?? "new"} stage={editing} onDone={() => setEditing(null)} />}</DialogContent>
      </Dialog>
    </>
  );
}

function StageForm({ stage, onDone }: { stage: Partial<Stage>; onDone: () => void }) {
  const [state, submit, pending] = useActionForm(saveStageAction, onDone);
  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{stage.id ? "编辑阶段" : "添加阶段"}</DialogTitle>
      </DialogHeader>
      {stage.id && <input type="hidden" name="id" value={stage.id} />}
      <FieldGroup className="gap-4 py-4">
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="st-name">阶段名称</FieldLabel>
          <Input id="st-name" name="name" defaultValue={stage.name} required autoFocus />
          <FieldErrors state={state} name="name" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="st-prob">赢率 %</FieldLabel>
            <Input id="st-prob" name="probability" type="number" min={0} max={100} defaultValue={stage.probability} />
            <FieldErrors state={state} name="probability" />
          </Field>
          <Field>
            <FieldLabel htmlFor="st-kind">类型</FieldLabel>
            <NativeSelect id="st-kind" name="kind" defaultValue={stage.kind}>
              <option value="OPEN">进行中</option>
              <option value="WON">赢单</option>
              <option value="LOST">输单</option>
            </NativeSelect>
          </Field>
        </div>
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
