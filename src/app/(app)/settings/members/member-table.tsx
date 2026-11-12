"use client";

import { useState } from "react";
import { MoreHorizontal, Plus } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DesktopOnly, MobileCard, MobileList, MobileMeta } from "@/components/crm/mobile-list";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { saveMemberAction, setMemberStatusAction } from "../actions";

type Option = { id: string; name: string };
export type MemberRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isOwner: boolean;
  active: boolean;
  departmentId: string | null;
  departmentName: string | null;
  roleId: string;
  roleName: string;
  lastLoginAt: string | null;
};

const fmt = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" });

export function MemberTable({
  members,
  departments,
  roles,
  currentUserId,
}: {
  members: MemberRow[];
  departments: Option[];
  roles: Option[];
  currentUserId: string;
}) {
  const [editing, setEditing] = useState<Partial<MemberRow> | null>(null);
  const status = (m: MemberRow) =>
    m.active ? (
      <Badge variant="outline" className="border-emerald-600/30 text-emerald-700">
        在用
      </Badge>
    ) : (
      <Badge variant="outline">已停用</Badge>
    );
  const menu = (m: MemberRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`操作 ${m.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setEditing(m)}>编辑</DropdownMenuItem>
        {!m.isOwner && m.id !== currentUserId && (
          <DropdownMenuItem variant={m.active ? "destructive" : "default"} onSelect={() => runAction(setMemberStatusAction(m.id, !m.active))}>
            {m.active ? "停用账号" : "启用账号"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setEditing({})}>
          <Plus /> 添加成员
        </Button>
      </div>
      <div className="surface">
        <MobileList empty="还没有成员">
          {members.map((m) => (
            <MobileCard
              key={m.id}
              className={m.active ? undefined : "opacity-60"}
              title={
                <>
                  {m.name}
                  {m.isOwner && (
                    <Badge variant="secondary" className="ml-2 align-middle">
                      主账号
                    </Badge>
                  )}
                </>
              }
              sub={m.email}
              aside={
                <span className="flex items-center gap-1">
                  {status(m)}
                  {menu(m)}
                </span>
              }
            >
              <MobileMeta
                items={[
                  ["部门", m.departmentName ?? "—"],
                  ["角色", m.roleName],
                  ["最近登录", m.lastLoginAt ? fmt.format(new Date(m.lastLoginAt)) : "从未登录"],
                ]}
              />
            </MobileCard>
          ))}
        </MobileList>
        <DesktopOnly>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">姓名</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>部门</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近登录</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id} className={m.active ? "" : "text-muted-foreground"}>
                  <TableCell className="pl-4 font-medium">
                    {m.name}
                    {m.isOwner && (
                      <Badge variant="secondary" className="ml-2">
                        主账号
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{m.email}</TableCell>
                  <TableCell>{m.departmentName ?? "—"}</TableCell>
                  <TableCell>{m.roleName}</TableCell>
                  <TableCell>
                    {m.active ? (
                      <Badge variant="outline" className="border-emerald-600/30 text-emerald-700">
                        在用
                      </Badge>
                    ) : (
                      <Badge variant="outline">已停用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{m.lastLoginAt ? fmt.format(new Date(m.lastLoginAt)) : "从未登录"}</TableCell>
                  <TableCell>{menu(m)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DesktopOnly>
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <MemberForm key={editing.id ?? "new"} member={editing} departments={departments} roles={roles} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MemberForm({
  member,
  departments,
  roles,
  onDone,
}: {
  member: Partial<MemberRow>;
  departments: Option[];
  roles: Option[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionForm(saveMemberAction, onDone);
  const isNew = !member.id;
  return (
    <form onSubmit={action}>
      <DialogHeader>
        <DialogTitle>{isNew ? "添加成员" : `编辑 ${member.name}`}</DialogTitle>
      </DialogHeader>
      {member.id && <input type="hidden" name="id" value={member.id} />}
      <FieldGroup className="py-4">
        <FormMessage state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="m-name">姓名</FieldLabel>
            <Input id="m-name" name="name" defaultValue={member.name} required autoFocus />
            <FieldErrors state={state} name="name" />
          </Field>
          <Field>
            <FieldLabel htmlFor="m-phone">手机</FieldLabel>
            <Input id="m-phone" name="phone" defaultValue={member.phone ?? ""} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="m-email">登录邮箱</FieldLabel>
          <Input id="m-email" name="email" type="email" defaultValue={member.email} required />
          <FieldErrors state={state} name="email" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="m-dept">部门</FieldLabel>
            <NativeSelect id="m-dept" name="departmentId" defaultValue={member.departmentId ?? departments[0]?.id}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
            <FieldErrors state={state} name="departmentId" />
          </Field>
          <Field>
            <FieldLabel htmlFor="m-role">角色</FieldLabel>
            <NativeSelect
              id="m-role"
              name="roleId"
              defaultValue={member.roleId ?? roles.find((r) => r.name === "业务员")?.id}
              disabled={member.isOwner}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
            {member.isOwner && <input type="hidden" name="roleId" value={member.roleId} />}
            <FieldErrors state={state} name="roleId" />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="m-password">{isNew ? "初始密码" : "重置密码"}</FieldLabel>
          <Input id="m-password" name="password" type="text" autoComplete="off" required={isNew} minLength={8} />
          <FieldDescription>
            {isNew ? "至少 8 位，把密码告诉成员，登录后可自行修改。" : "留空表示不修改；重置后该成员会被强制下线。"}
          </FieldDescription>
          <FieldErrors state={state} name="password" />
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
