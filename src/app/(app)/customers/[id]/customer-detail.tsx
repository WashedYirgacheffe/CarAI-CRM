"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Mail, MoreHorizontal, Pencil, Phone, Plus, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import {
  FOLLOW_METHODS,
  countryName,
  followMethodLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  relativeDays,
  toLocalInput,
} from "@/lib/crm";
import { StarRating, StatusBadge } from "@/components/crm/bits";
import { CustomerForm, type CustomerOptionsProp, type EditableCustomer } from "@/components/crm/customer-form";
import { ReleaseForm } from "@/components/crm/customer-table";
import { OpportunityForm, type StageOption } from "@/components/crm/opportunity-form";
import { TaskForm, TaskList, type TaskItem } from "@/components/crm/tasks";
import type { CustomerAccess } from "@/server/customers";
import { CustomerDocsCard, type CustomerDocRow } from "./customer-docs";
import {
  addFollowUpAction,
  claimCustomersAction,
  deleteContactAction,
  deleteCustomerAction,
  releaseCustomersAction,
  saveContactAction,
  setStarAction,
  transferCustomersAction,
} from "../actions";

type CustomerView = EditableCustomer & {
  domain: string | null;
  statusName: string | null;
  statusColor: string | null;
  groupName: string | null;
  ownerName: string | null;
  createdAt: string;
  assignedAt: string | null;
  lastContactAt: string | null;
  nextFollowAt: string | null;
  poolReason: string | null;
};

type ContactView = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  remark: string | null;
  isPrimary: boolean;
};

type ActivityView = {
  id: string;
  type: "FOLLOW_UP" | "SYSTEM";
  event: string | null;
  method: string | null;
  content: string;
  userName: string;
  opportunityName: string | null;
  createdAt: string;
};

type OpportunityView = {
  id: string;
  customerId: string;
  name: string;
  amount: string;
  currency: string;
  stageId: string;
  stageName: string;
  stageKind: "OPEN" | "WON" | "LOST";
  probability: number;
  ownerName: string | null;
  expectedCloseAt: string | null;
  remark: string | null;
};

type Perms = {
  transfer: boolean;
  delete: boolean;
  claim: boolean;
  createOpportunity: boolean;
  viewOpportunity: boolean;
  createQuotation: boolean;
  createOrder: boolean;
};

type Modal = "edit" | "transfer" | "release" | "delete" | "opportunity" | "task" | null;

export function CustomerDetail({
  tz,
  access,
  perms,
  members,
  options,
  stages,
  customer: c,
  contacts,
  activities,
  opportunities,
  tasks,
  quotations,
  orders,
}: {
  tz: string;
  access: CustomerAccess;
  perms: Perms;
  members: { id: string; name: string }[];
  options: CustomerOptionsProp;
  stages: StageOption[];
  customer: CustomerView;
  contacts: ContactView[];
  activities: ActivityView[];
  opportunities: OpportunityView[];
  tasks: TaskItem[];
  /** null = 没有查看权限 */
  quotations: CustomerDocRow[] | null;
  orders: CustomerDocRow[] | null;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<Modal>(null);
  const [editingOpp, setEditingOpp] = useState<OpportunityView | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setModal(null);
  const canEdit = access.edit;

  async function run(p: Promise<{ ok?: boolean }>, after?: () => void) {
    setBusy(true);
    const r = await runAction(p as never);
    setBusy(false);
    if (r.ok) {
      close();
      after?.();
    }
  }

  const overdue = c.nextFollowAt && new Date(c.nextFollowAt) < new Date();

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card p-5">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{c.name}</h1>
            <StatusBadge name={c.statusName} color={c.statusColor} />
            {access.inPool && <Badge variant="outline">公海</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <StarRating value={c.star} size="md" onChange={canEdit ? (v) => setStarAction(c.id, v) : undefined} />
            {c.country && <span>{countryName(c.country)}</span>}
            {c.website && (
              <a
                href={/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-primary"
              >
                <Globe className="size-3.5" />
                {c.domain ?? c.website}
              </a>
            )}
            <span>负责人：{c.ownerName ?? "无（公海）"}</span>
            {c.groupName && <span>分组：{c.groupName}</span>}
          </div>
          {c.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {c.tags.map((t) => (
                <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {access.inPool && perms.claim && (
            <Button disabled={busy} onClick={() => run(claimCustomersAction([c.id]))}>
              领取到我的客户
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" onClick={() => setModal("edit")}>
              <Pencil /> 编辑
            </Button>
          )}
          {(canEdit || (access.inPool && perms.delete)) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="更多操作">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && perms.transfer && <DropdownMenuItem onSelect={() => setModal("transfer")}>转移给同事</DropdownMenuItem>}
                {canEdit && <DropdownMenuItem onSelect={() => setModal("release")}>放入公海</DropdownMenuItem>}
                {perms.delete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setModal("delete")}>
                      删除客户
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* 左：跟进 + 动态 */}
        <div className="min-w-0 space-y-4">
          {canEdit && <FollowUpForm customerId={c.id} tz={tz} />}
          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline">动态 {activities.length > 0 && `(${activities.length})`}</TabsTrigger>
              {perms.viewOpportunity && <TabsTrigger value="opps">商机 ({opportunities.length})</TabsTrigger>}
              {quotations && <TabsTrigger value="quotations">报价单 ({quotations.length})</TabsTrigger>}
              {orders && <TabsTrigger value="orders">订单 ({orders.length})</TabsTrigger>}
              <TabsTrigger value="tasks">日程 ({tasks.filter((t) => !t.done).length})</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline" className="mt-3">
              <Timeline activities={activities} tz={tz} />
            </TabsContent>
            {perms.viewOpportunity && (
              <TabsContent value="opps" className="mt-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">商机</CardTitle>
                    {canEdit && perms.createOpportunity && (
                      <CardAction>
                        <Button size="sm" variant="outline" onClick={() => setModal("opportunity")}>
                          <Plus /> 新建商机
                        </Button>
                      </CardAction>
                    )}
                  </CardHeader>
                  <CardContent>
                    {opportunities.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">还没有商机</p>
                    ) : (
                      <ul className="divide-y">
                        {opportunities.map((o) => (
                          <li key={o.id} className="flex items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{o.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {o.ownerName}
                                {o.expectedCloseAt && ` · 预计 ${formatDate(o.expectedCloseAt, tz)} 成交`}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-medium tabular-nums">{formatMoney(o.amount, o.currency)}</span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  o.stageKind === "WON" && "border-emerald-300 text-emerald-700",
                                  o.stageKind === "LOST" && "text-muted-foreground",
                                )}
                              >
                                {o.stageName}
                              </Badge>
                              {canEdit && (
                                <Button variant="ghost" size="icon-sm" aria-label="编辑商机" onClick={() => setEditingOpp(o)}>
                                  <Pencil />
                                </Button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}
            {quotations && (
              <TabsContent value="quotations" className="mt-3">
                <CustomerDocsCard kind="quotation" customerId={c.id} rows={quotations} canCreate={canEdit && perms.createQuotation} tz={tz} />
              </TabsContent>
            )}
            {orders && (
              <TabsContent value="orders" className="mt-3">
                <CustomerDocsCard kind="order" customerId={c.id} rows={orders} canCreate={canEdit && perms.createOrder} tz={tz} />
              </TabsContent>
            )}
            <TabsContent value="tasks" className="mt-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">日程</CardTitle>
                  {canEdit && (
                    <CardAction>
                      <Button size="sm" variant="outline" onClick={() => setModal("task")}>
                        <Plus /> 新建日程
                      </Button>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent>
                  <TaskList tasks={tasks} tz={tz} showCustomer={false} empty="没有关联的日程" />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* 右：联系人 + 资料 */}
        <div className="space-y-4">
          <ContactsCard customerId={c.id} contacts={contacts} canEdit={canEdit} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">客户资料</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">
                <Info label="最近跟进">{relativeDays(c.lastContactAt)}</Info>
                <Info label="下次跟进">
                  {c.nextFollowAt ? (
                    <span className={cn(overdue && "font-medium text-destructive")}>{formatDateTime(c.nextFollowAt, tz)}</span>
                  ) : null}
                </Info>
                <Info label="来源">{c.source}</Info>
                <Info label="类型">{c.customerType}</Info>
                <Info label="主营产品">{c.mainProducts}</Info>
                <Info label="年采购额">{c.annualVolume}</Info>
                <Info label="地址">{c.address}</Info>
                <Info label="备注">{c.remark && <span className="whitespace-pre-wrap">{c.remark}</span>}</Info>
                {access.inPool && <Info label="公海原因">{c.poolReason}</Info>}
                <Info label="创建时间">{formatDate(c.createdAt, tz)}</Info>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 弹窗 */}
      <Dialog open={modal === "edit"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-2xl">
          {modal === "edit" && <CustomerForm customer={c} options={options} onDone={close} />}
        </DialogContent>
      </Dialog>
      <Dialog open={modal === "release"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {modal === "release" && (
            <ReleaseForm
              count={1}
              busy={busy}
              onCancel={close}
              onSubmit={(why) => run(releaseCustomersAction([c.id], why), () => router.push("/customers"))}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={modal === "transfer"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {modal === "transfer" && (
            <TransferForm
              members={members.filter((m) => m.name !== c.ownerName)}
              busy={busy}
              onCancel={close}
              onSubmit={(uid) => run(transferCustomersAction([c.id], uid))}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={modal === "opportunity" || !!editingOpp} onOpenChange={(o) => !o && (close(), setEditingOpp(null))}>
        <DialogContent>
          {(modal === "opportunity" || editingOpp) && (
            <OpportunityForm
              key={editingOpp?.id ?? "new"}
              opportunity={editingOpp ?? { customerId: c.id, name: "" }}
              stages={stages}
              tz={tz}
              onDone={() => {
                close();
                setEditingOpp(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={modal === "task"} onOpenChange={(o) => !o && close()}>
        <DialogContent>{modal === "task" && <TaskForm customerId={c.id} tz={tz} onDone={close} />}</DialogContent>
      </Dialog>
      <AlertDialog open={modal === "delete"} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{c.name}」？</AlertDialogTitle>
            <AlertDialogDescription>联系人、跟进动态、商机和日程会一起删除，且无法恢复。不再跟进的客户建议放入公海。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                run(deleteCustomerAction(c.id), () => router.push(access.inPool ? "/customers/pool" : "/customers"));
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </>
  );
}

function FollowUpForm({ customerId, tz }: { customerId: string; tz: string }) {
  const [state, submit, pending] = useActionForm(addFollowUpAction, (form) => form.reset());
  const [method, setMethod] = useState("EMAIL");
  const [defaultNext] = useState(() => toLocalInput(new Date(Date.now() + 3 * 86_400_000), tz, false) + "T10:00");
  return (
    <form onSubmit={submit} className="rounded-xl border bg-card p-4">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="method" value={method} />
      <div className="mb-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="跟进方式">
        {FOLLOW_METHODS.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={method === m.value}
            onClick={() => setMethod(m.value)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              method === m.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <Textarea name="content" placeholder="记录这次沟通的内容：客户需求、报价、异议、约定的下一步…" rows={3} />
      <FieldErrors state={state} name="content" />
      {state.message && !state.ok && <p className="mt-1 text-sm text-destructive">{state.message}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Label htmlFor="fu-next" className="text-sm font-normal text-muted-foreground">
          下次跟进
        </Label>
        <Input id="fu-next" name="nextFollowAt" type="datetime-local" defaultValue={defaultNext} className="w-auto" />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Checkbox name="createTask" defaultChecked /> 同时加入日程
        </label>
        <Button type="submit" size="sm" className="ml-auto" disabled={pending}>
          {pending ? "保存中…" : "保存跟进"}
        </Button>
      </div>
    </form>
  );
}

const METHOD_ICON: Record<string, React.ReactNode> = {
  EMAIL: <Mail className="size-3.5" />,
  PHONE: <Phone className="size-3.5" />,
};

function Timeline({ activities, tz }: { activities: ActivityView[]; tz: string }) {
  if (!activities.length) {
    return <p className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">还没有动态</p>;
  }
  return (
    <ol className="relative space-y-4 rounded-xl border bg-card p-5 before:absolute before:top-6 before:bottom-6 before:left-[1.85rem] before:w-px before:bg-border">
      {activities.map((a) =>
        a.type === "FOLLOW_UP" ? (
          <li key={a.id} className="relative flex gap-3">
            <span className="z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              {METHOD_ICON[a.method ?? ""] ?? <Star className="size-3" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{a.userName}</span> · {followMethodLabel(a.method)}跟进 ·{" "}
                <span className="tabular-nums">{formatDateTime(a.createdAt, tz)}</span>
                {a.opportunityName && ` · 商机：${a.opportunityName}`}
              </p>
              <p className="mt-1 text-sm whitespace-pre-wrap">{a.content}</p>
            </div>
          </li>
        ) : (
          <li key={a.id} className="relative flex gap-3 text-xs text-muted-foreground">
            <span className="z-10 mt-1 ml-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/40" />
            <p>
              <span className="tabular-nums">{formatDateTime(a.createdAt, tz)}</span> · {a.userName} {a.content}
            </p>
          </li>
        ),
      )}
    </ol>
  );
}

function ContactsCard({ customerId, contacts, canEdit }: { customerId: string; contacts: ContactView[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<Partial<ContactView> | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">联系人 ({contacts.length})</CardTitle>
        {canEdit && (
          <CardAction>
            <Button size="sm" variant="ghost" onClick={() => setEditing({})}>
              <Plus /> 添加
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {contacts.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">还没有联系人</p>
        ) : (
          <ul className="space-y-3">
            {contacts.map((ct) => (
              <li key={ct.id} className="group text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{ct.name}</span>
                  {ct.isPrimary && <Badge variant="secondary">主联系人</Badge>}
                  {canEdit && (
                    <span className="ml-auto flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                      <Button variant="ghost" size="icon-xs" aria-label={`编辑 ${ct.name}`} onClick={() => setEditing(ct)}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`删除 ${ct.name}`}
                        onClick={() => runAction(deleteContactAction(ct.id))}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  )}
                </div>
                {ct.title && <p className="text-xs text-muted-foreground">{ct.title}</p>}
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {ct.email && (
                    <a href={`mailto:${ct.email}`} className="flex items-center gap-1.5 hover:text-primary">
                      <Mail className="size-3" />
                      {ct.email}
                    </a>
                  )}
                  {ct.phone && (
                    <p className="flex items-center gap-1.5">
                      <Phone className="size-3" />
                      {ct.phone}
                    </p>
                  )}
                  {ct.whatsapp && (
                    <a
                      href={`https://wa.me/${ct.whatsapp.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 hover:text-primary"
                    >
                      <span className="text-[10px] font-semibold">WA</span>
                      {ct.whatsapp}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <ContactForm key={editing.id ?? "new"} customerId={customerId} contact={editing} first={!contacts.length} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ContactForm({
  customerId,
  contact,
  first,
  onDone,
}: {
  customerId: string;
  contact: Partial<ContactView>;
  first: boolean;
  onDone: () => void;
}) {
  const [state, submit, pending] = useActionForm(saveContactAction, onDone);
  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{contact.id ? "编辑联系人" : "添加联系人"}</DialogTitle>
      </DialogHeader>
      <input type="hidden" name="customerId" value={customerId} />
      {contact.id && <input type="hidden" name="id" value={contact.id} />}
      <FieldGroup className="gap-4 py-4">
        <FormMessage state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="ct-name">姓名</FieldLabel>
            <Input id="ct-name" name="name" defaultValue={contact.name} required autoFocus />
            <FieldErrors state={state} name="name" />
          </Field>
          <Field>
            <FieldLabel htmlFor="ct-title">职位</FieldLabel>
            <Input id="ct-title" name="title" defaultValue={contact.title ?? ""} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ct-email">邮箱</FieldLabel>
            <Input id="ct-email" name="email" type="email" defaultValue={contact.email ?? ""} />
            <FieldErrors state={state} name="email" />
          </Field>
          <Field>
            <FieldLabel htmlFor="ct-phone">电话</FieldLabel>
            <Input id="ct-phone" name="phone" defaultValue={contact.phone ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ct-wa">WhatsApp</FieldLabel>
            <Input id="ct-wa" name="whatsapp" defaultValue={contact.whatsapp ?? ""} placeholder="+1 555 123 4567" />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="ct-remark">备注</FieldLabel>
          <Input id="ct-remark" name="remark" defaultValue={contact.remark ?? ""} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="isPrimary" defaultChecked={contact.isPrimary ?? first} /> 设为主联系人
        </label>
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

function TransferForm({
  members,
  busy,
  onCancel,
  onSubmit,
}: {
  members: { id: string; name: string }[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (uid: string) => void;
}) {
  const [uid, setUid] = useState(members[0]?.id ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (uid) onSubmit(uid);
      }}
    >
      <DialogHeader>
        <DialogTitle>转移客户</DialogTitle>
        <DialogDescription>转移后由新负责人跟进，你会失去编辑权限（上级除外）。</DialogDescription>
      </DialogHeader>
      <FieldGroup className="py-4">
        <Field>
          <FieldLabel htmlFor="tr-member">新负责人</FieldLabel>
          {members.length ? (
            <NativeSelect id="tr-member" value={uid} onChange={(e) => setUid(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <p className="text-sm text-muted-foreground">你的数据范围内没有其他成员。</p>
          )}
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={busy || !uid}>
          确定转移
        </Button>
      </DialogFooter>
    </form>
  );
}
