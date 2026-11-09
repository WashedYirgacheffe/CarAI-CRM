"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Clock, Globe, Mail, MoreHorizontal, Pencil, Phone, Plus, Star, Trash2 } from "lucide-react";
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
import { CustomerAiPanel, CustomerMails, CustomerWhatsapp, type CustomerMailRow, type CustomerWaRow } from "./customer-comms";
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
import { COUNTRY_TZ } from "@/lib/dashboard";
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
  lastFollowAt: string | null;
  lastMailRecvAt: string | null;
  lastMailSentAt: string | null;
  lastWaAt: string | null;
  nextFollowAt: string | null;
  poolReason: string | null;
  poolDueAt: string | null;
  poolCount: number;
  poolEnteredAt: string | null;
  prevOwnerName: string | null;
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

export type CommsProp = {
  /** 当前用户是否绑定了可用邮箱 */
  mailEnabled: boolean;
  /** 当前用户是否有 WhatsApp 权限 */
  waEnabled: boolean;
  mails: CustomerMailRow[];
  wa: CustomerWaRow[];
  /** null = 没有 AI 权限 */
  ai: { brief: { content: string; createdAt: string } | null; next: { content: string; createdAt: string } | null } | null;
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
  comms,
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
  comms: CommsProp;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<Modal>(null);
  const [editingOpp, setEditingOpp] = useState<OpportunityView | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setModal(null);
  const canEdit = access.edit;
  const primaryEmail = contacts.find((x) => x.email)?.email ?? null;
  const primaryWa = contacts.find((x) => x.whatsapp || x.phone)?.whatsapp ?? contacts.find((x) => x.phone)?.phone ?? null;

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
            {c.country && <LocalTime country={c.country} myTz={tz} />}
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
              <TabsTrigger value="mails">邮件 ({comms.mails.length})</TabsTrigger>
              {(comms.waEnabled || comms.wa.length > 0) && <TabsTrigger value="wa">WhatsApp</TabsTrigger>}
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
            <TabsContent value="mails" className="mt-3">
              <CustomerMails rows={comms.mails} tz={tz} composeHref={comms.mailEnabled && primaryEmail ? `/mail/compose?to=${encodeURIComponent(primaryEmail)}` : null} />
            </TabsContent>
            {(comms.waEnabled || comms.wa.length > 0) && (
              <TabsContent value="wa" className="mt-3">
                <CustomerWhatsapp
                  rows={comms.wa}
                  tz={tz}
                  chatHref={comms.waEnabled && primaryWa ? `/whatsapp?phone=${encodeURIComponent(primaryWa)}&customerId=${c.id}` : null}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* 右：联系人 + 资料 */}
        <div className="space-y-4">
          {comms.ai && <CustomerAiPanel customerId={c.id} brief={comms.ai.brief} next={comms.ai.next} tz={tz} />}
          <ContactsCard customerId={c.id} contacts={contacts} canEdit={canEdit} mailEnabled={comms.mailEnabled} waEnabled={comms.waEnabled} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">客户资料</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">
                <Info label="最近联系">{when(c.lastContactAt, tz)}</Info>
                <Info label="最近跟进">{when(c.lastFollowAt, tz)}</Info>
                <Info label="最近收件">{c.lastMailRecvAt && when(c.lastMailRecvAt, tz)}</Info>
                <Info label="最近发件">{c.lastMailSentAt && when(c.lastMailSentAt, tz)}</Info>
                <Info label="WhatsApp">{c.lastWaAt && when(c.lastWaAt, tz)}</Info>
                <Info label="下次跟进">
                  {c.nextFollowAt ? (
                    <span className={cn(overdue && "font-medium text-destructive")}>{formatDateTime(c.nextFollowAt, tz)}</span>
                  ) : null}
                </Info>
                {!access.inPool && (
                  <Info label="进公海">
                    {c.poolDueAt ? <PoolDue at={c.poolDueAt} tz={tz} /> : <span className="text-muted-foreground">不会自动进公海</span>}
                  </Info>
                )}
                {access.inPool && <Info label="进入公海">{c.poolEnteredAt && formatDate(c.poolEnteredAt, tz)}</Info>}
                {c.poolCount > 0 && <Info label="进公海次数">{c.poolCount} 次</Info>}
                <Info label="原负责人">{c.prevOwnerName}</Info>
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

const MAIL_EVENTS = new Set(["mail_out", "mail_in", "mail_linked"]);
const CHAT_EVENTS = new Set(["wa_out", "wa_linked"]);
type ActivityKind = "follow" | "mail" | "chat" | "other";
const ACTIVITY_KINDS: { key: ActivityKind | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "follow", label: "跟进" },
  { key: "mail", label: "邮件" },
  { key: "chat", label: "聊天" },
  { key: "other", label: "其他" },
];

function kindOf(a: ActivityView): ActivityKind {
  if (a.event && MAIL_EVENTS.has(a.event)) return "mail";
  if (a.event && CHAT_EVENTS.has(a.event)) return "chat";
  return a.type === "FOLLOW_UP" ? "follow" : "other";
}

function Timeline({ activities, tz }: { activities: ActivityView[]; tz: string }) {
  const [kind, setKind] = useState<ActivityKind | "all">("all");
  if (!activities.length) {
    return <p className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">还没有动态</p>;
  }
  const count = (k: ActivityKind | "all") => (k === "all" ? activities.length : activities.filter((a) => kindOf(a) === k).length);
  const shown = kind === "all" ? activities : activities.filter((a) => kindOf(a) === kind);
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap gap-1 border-b px-4 py-2" role="tablist" aria-label="动态分类">
        {ACTIVITY_KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            role="tab"
            aria-selected={kind === k.key}
            onClick={() => setKind(k.key)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs transition-colors",
              kind === k.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {k.label} <span className="tabular-nums opacity-70">{count(k.key)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">这一类还没有动态</p>
      ) : (
        <ol className="relative space-y-4 p-5 before:absolute before:top-6 before:bottom-6 before:left-[1.85rem] before:w-px before:bg-border">
          {shown.map((a) =>
            a.type === "FOLLOW_UP" ? (
              <li key={a.id} className="relative flex gap-3">
                <span className="z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  {METHOD_ICON[a.method ?? ""] ?? <Star className="size-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{a.userName}</span> · {followMethodLabel(a.method)}
                    {a.event ? "" : "跟进"} · <span className="tabular-nums">{formatDateTime(a.createdAt, tz)}</span>
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
      )}
    </div>
  );
}

/** 「3 天前（11/05 14:20）」 */
function when(at: string | null, tz: string) {
  if (!at) return <span className="text-muted-foreground">从未</span>;
  return (
    <span title={formatDateTime(at, tz)}>
      {relativeDays(at)} <span className="text-xs text-muted-foreground tabular-nums">{formatDate(at, tz)}</span>
    </span>
  );
}

function PoolDue({ at, tz }: { at: string; tz: string }) {
  const now = useMinute();
  if (now === null) return <span>{formatDate(at, tz)}</span>;
  const days = Math.ceil((new Date(at).getTime() - now) / 86_400_000);
  return (
    <span className={cn(days <= 7 && "font-medium text-amber-600")}>
      {formatDate(at, tz)}（{days <= 0 ? "即将回收" : `${days} 天后`}）
    </span>
  );
}

// 每 30 秒更新一次的「当前时间（毫秒，取整到分钟）」；服务端渲染时为 null，避免水合不一致
const subscribeMinute = (cb: () => void) => {
  const t = setInterval(cb, 30_000);
  return () => clearInterval(t);
};
function useMinute() {
  return useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => null,
  );
}

/** 客户所在国家的当地时间，以及是否在工作时间（周一到周五 9-18 点） */
function LocalTime({ country, myTz }: { country: string; myTz: string }) {
  const now = useMinute();
  const zone = COUNTRY_TZ[country];
  if (!zone || now === null) return null;
  const d = new Date(now);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour"));
  const weekday = get("weekday");
  const working = !["Sat", "Sun"].includes(weekday) && hour >= 9 && hour < 18;
  const offset = (z: string) => {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "longOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value ?? "GMT";
    const m = s.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  };
  const diff = (offset(zone) - offset(myTz)) / 60;
  const WEEK: Record<string, string> = { Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六", Sun: "周日" };
  return (
    <span className="inline-flex items-center gap-1" title={`${zone}，${diff === 0 ? "与你同一时区" : `比你${diff > 0 ? "早" : "晚"} ${Math.abs(diff)} 小时`}`}>
      <Clock className="size-3.5" />
      当地 <span className="tabular-nums">{get("hour")}:{get("minute")}</span> {WEEK[weekday]}
      <span className={cn("rounded px-1 text-[11px]", working ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>
        {working ? "工作时间" : "非工作时间"}
      </span>
    </span>
  );
}

function ContactsCard({
  customerId,
  contacts,
  canEdit,
  mailEnabled,
  waEnabled,
}: {
  customerId: string;
  contacts: ContactView[];
  canEdit: boolean;
  mailEnabled: boolean;
  waEnabled: boolean;
}) {
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
                    <a href={mailEnabled ? `/mail/compose?to=${encodeURIComponent(ct.email)}` : `mailto:${ct.email}`} className="flex items-center gap-1.5 hover:text-primary">
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
                      href={
                        waEnabled
                          ? `/whatsapp?phone=${ct.whatsapp.replace(/\D/g, "")}&customerId=${customerId}`
                          : `https://wa.me/${ct.whatsapp.replace(/\D/g, "")}`
                      }
                      target={waEnabled ? undefined : "_blank"}
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
