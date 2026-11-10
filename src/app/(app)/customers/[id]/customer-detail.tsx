"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Mail,
  MapPin,
  MessageCircle,
  MoreVertical,
  PenSquare,
  NotebookPen,
  Pencil,
  Phone,
  Plus,
  Star,
  Tag as TagIcon,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomerAiPanel, CustomerMails, CustomerWhatsapp, type CustomerMailRow, type CustomerWaRow } from "./customer-comms";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { FOLLOW_METHODS, countryName, followMethodLabel, formatDate, formatDateTime, formatMoney, relativeDays, toLocalInput } from "@/lib/crm";
import { COUNTRY_TZ } from "@/lib/dashboard";
import { StarRating, StatusBadge } from "@/components/crm/bits";
import { CustomerForm, type CustomerOptionsProp, type EditableCustomer } from "@/components/crm/customer-form";
import { ReleaseForm } from "@/components/crm/customer-table";
import { OpportunityForm, type StageOption } from "@/components/crm/opportunity-form";
import { TaskForm, TaskList, type TaskItem } from "@/components/crm/tasks";
import type { CustomerAccess } from "@/server/customers";
import { CustomerDocsCard, type CustomerDocRow } from "./customer-docs";
import { PaneEmpty, PaneToolbar, Panel } from "./detail-ui";
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
  insights,
}: {
  tz: string;
  /** 往来概况（服务端渲染的图表块） */
  insights?: React.ReactNode;
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
  const composeHref = comms.mailEnabled && primaryEmail ? `/mail/compose?to=${encodeURIComponent(primaryEmail)}` : null;
  const showWa = comms.waEnabled || comms.wa.length > 0;
  const canClaim = access.inPool && perms.claim;
  const openOpps = opportunities.filter((o) => o.stageKind === "OPEN");
  const openTasks = tasks.filter((t) => !t.done);
  const listHref = access.inPool ? "/customers/pool" : "/customers";

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
  const primaryPhone = contacts.find((x) => x.phone)?.phone ?? null;
  const waHref = comms.waEnabled && primaryWa ? `/whatsapp?phone=${encodeURIComponent(primaryWa)}&customerId=${c.id}` : null;
  const focusFollowUp = () => {
    const el = document.getElementById("follow-up");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector("textarea")?.focus({ preventScroll: true });
  };

  return (
    <div className="space-y-3 md:space-y-4">
      {/* 标题栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={listHref} className="inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ChevronLeft className="size-4" />
            {access.inPool ? "公海客户" : "客户列表"}
          </Link>
          <span className="h-4 w-px bg-border" aria-hidden />
          <h1 className="text-lg font-semibold tracking-tight">客户详情</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 手机端这些操作在底部操作栏 */}
          <span className="hidden items-center gap-2 md:flex">
            {canClaim && (
              <Button disabled={busy} onClick={() => run(claimCustomersAction([c.id]))}>
                领取到我的客户
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" onClick={() => setModal("edit")}>
                <Pencil /> 编辑
              </Button>
            )}
            {composeHref && (
              <Button variant={canClaim ? "outline" : "default"} asChild>
                <Link href={composeHref}>
                  <PenSquare /> 写邮件
                </Link>
              </Button>
            )}
          </span>
          {(canEdit || (access.inPool && perms.delete)) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="更多操作" className="max-md:size-9 max-md:rounded-full">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem className="md:hidden" onSelect={() => setModal("edit")}>
                    编辑客户
                  </DropdownMenuItem>
                )}
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

      {/* 手机 / 平板单栏时用 order 重新排：档案 → AI → 联系人 → 商机/日程 → 写跟进 → 页签 → 资料 */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 md:gap-4 xl:grid-cols-[23.5rem_minmax(0,1fr)]">
        {/* 左栏：客户档案 + AI + 联系人 + 资料 */}
        <div className="min-w-0 max-xl:contents xl:space-y-4">
          <section className="surface max-xl:order-1">
            <div className="space-y-4 p-4 md:p-5">
              <div className="flex items-start gap-4">
                <div className="relative shrink-0">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
                    {initialOf(c.name)}
                  </div>
                  <span
                    className={cn(
                      "absolute -right-1.5 -bottom-1.5 rounded-full px-1.5 py-px text-[10px] font-medium ring-2 ring-card",
                      access.inPool ? "bg-amber-100 text-amber-700" : "bg-primary text-primary-foreground",
                    )}
                  >
                    {access.inPool ? "公海" : "私海"}
                  </span>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <h2 className="text-xl leading-snug font-bold break-words">{c.name}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <StarRating value={c.star} size="md" onChange={canEdit ? (v) => setStarAction(c.id, v) : undefined} />
                    {c.statusName && <StatusBadge name={c.statusName} color={c.statusColor} />}
                  </div>
                </div>
              </div>

              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {c.country && (
                  <MetaLine icon={<MapPin />}>
                    <span className="text-foreground">{countryName(c.country)}</span>
                    <span className="ml-1.5 text-xs">{c.country}</span>
                  </MetaLine>
                )}
                {c.country && <LocalTime country={c.country} myTz={tz} />}
                {c.website && (
                  <MetaLine icon={<Globe />}>
                    <a
                      href={/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-foreground hover:text-primary hover:underline"
                    >
                      {c.domain ?? c.website}
                    </a>
                  </MetaLine>
                )}
                <MetaLine icon={<UserRound />}>
                  负责人 <span className="ml-1 text-foreground">{c.ownerName ?? "无（公海）"}</span>
                </MetaLine>
              </ul>

              {c.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {c.tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary/8 px-2.5 py-0.5 text-xs text-primary">
                      <TagIcon className="size-3" />
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-border/70 p-4 text-sm md:p-5">
              <GridField label="客户分组">{c.groupName}</GridField>
              <GridField label="客户来源">{c.source}</GridField>
              <GridField label="客户类型">{c.customerType}</GridField>
              <GridField label="最近联系">{when(c.lastContactAt, tz)}</GridField>
              <GridField label="下次跟进">
                {c.nextFollowAt ? (
                  <span className={cn("tabular-nums", overdue && "font-medium text-destructive")}>{formatDateTime(c.nextFollowAt, tz)}</span>
                ) : null}
              </GridField>
              {access.inPool ? (
                <GridField label="进入公海">{c.poolEnteredAt && <span className="tabular-nums">{formatDate(c.poolEnteredAt, tz)}</span>}</GridField>
              ) : (
                <GridField label="进公海倒计时">
                  {c.poolDueAt ? <PoolDue at={c.poolDueAt} tz={tz} /> : <span className="text-muted-foreground">不会自动进公海</span>}
                </GridField>
              )}
            </dl>
          </section>

          {comms.ai && (
            <div className="max-xl:order-2">
              <CustomerAiPanel customerId={c.id} brief={comms.ai.brief} next={comms.ai.next} tz={tz} />
            </div>
          )}

          <div className="max-xl:order-3">
            <ContactsCard customerId={c.id} contacts={contacts} canEdit={canEdit} mailEnabled={comms.mailEnabled} waEnabled={comms.waEnabled} />
          </div>

          <Panel title="客户资料" bodyClassName="space-y-5" className="max-xl:order-7">
            <InfoSection title="公司信息">
              <Info label="主营产品">{c.mainProducts}</Info>
              <Info label="年采购额">{c.annualVolume}</Info>
              <Info label="地址">{c.address}</Info>
              <Info label="备注">{c.remark && <span className="whitespace-pre-wrap">{c.remark}</span>}</Info>
            </InfoSection>
            <InfoSection title="跟进信息">
              <Info label="最近跟进">{when(c.lastFollowAt, tz)}</Info>
              <Info label="最近收件">{c.lastMailRecvAt && when(c.lastMailRecvAt, tz)}</Info>
              <Info label="最近发件">{c.lastMailSentAt && when(c.lastMailSentAt, tz)}</Info>
              <Info label="WhatsApp">{c.lastWaAt && when(c.lastWaAt, tz)}</Info>
              {c.poolCount > 0 && (
                <Info label="进公海次数">
                  <span className="tabular-nums">{c.poolCount} 次</span>
                </Info>
              )}
              {access.inPool && <Info label="公海原因">{c.poolReason}</Info>}
            </InfoSection>
            <InfoSection title="系统信息">
              <Info label="创建时间">
                <span className="tabular-nums">{formatDate(c.createdAt, tz)}</span>
              </Info>
              {c.assignedAt && (
                <Info label="分配时间">
                  <span className="tabular-nums">{formatDate(c.assignedAt, tz)}</span>
                </Info>
              )}
              <Info label="原负责人">{c.prevOwnerName}</Info>
            </InfoSection>
          </Panel>
        </div>

        {/* 右栏：进行中的商机 / 计划日程 + 写跟进 + 页签 */}
        <div className="min-w-0 max-xl:contents xl:space-y-4">
          <div className="space-y-3 max-xl:order-4">
            {perms.viewOpportunity && (
              <CollapseBar
                title="进行中的商机"
                count={openOpps.length}
                action={
                  canEdit &&
                  perms.createOpportunity && (
                    <Button size="xs" variant="ghost" className="text-primary" onClick={() => setModal("opportunity")}>
                      <Plus /> 添加
                    </Button>
                  )
                }
              >
                {openOpps.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">没有进行中的商机</p>
                ) : (
                  <ul className="divide-y divide-border/70">
                    {openOpps.map((o) => (
                      <OppRow key={o.id} o={o} tz={tz} onEdit={canEdit ? () => setEditingOpp(o) : undefined} />
                    ))}
                  </ul>
                )}
              </CollapseBar>
            )}
            <CollapseBar
              title="跟进提醒"
              count={openTasks.length}
              action={
                canEdit && (
                  <Button size="xs" variant="ghost" className="text-primary" onClick={() => setModal("task")}>
                    <Plus /> 设提醒
                  </Button>
                )
              }
            >
              <TaskList tasks={openTasks} tz={tz} showCustomer={false} empty="没有待办提醒。在等工厂报价、等船期？点「设提醒」" />
            </CollapseBar>
          </div>

          {canEdit && (
            <div id="follow-up" className="scroll-mt-24 max-xl:order-5">
              <FollowUpForm customerId={c.id} tz={tz} />
            </div>
          )}

          {insights && <div className="max-xl:order-6">{insights}</div>}

          <section className="surface max-xl:order-6">
            <Tabs defaultValue="timeline" className="gap-0">
              {/* 页签吸顶（顶栏下方） */}
              <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 overflow-x-auto rounded-t-2xl border-b border-border/70 bg-card px-1 [scrollbar-width:none] md:top-[calc(3.5rem+env(safe-area-inset-top))] md:px-3">
                <TabsList variant="line" className="h-12">
                  <TabsTrigger value="timeline" className="px-3">
                    动态 {activities.length > 0 && <TabCount n={activities.length} />}
                  </TabsTrigger>
                  {perms.viewOpportunity && (
                    <TabsTrigger value="opps" className="px-3">
                      商机 <TabCount n={opportunities.length} />
                    </TabsTrigger>
                  )}
                  {quotations && (
                    <TabsTrigger value="quotations" className="px-3">
                      报价单 <TabCount n={quotations.length} />
                    </TabsTrigger>
                  )}
                  {orders && (
                    <TabsTrigger value="orders" className="px-3">
                      订单 <TabCount n={orders.length} />
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="tasks" className="px-3">
                    日程 <TabCount n={openTasks.length} />
                  </TabsTrigger>
                  <TabsTrigger value="mails" className="px-3">
                    邮件 <TabCount n={comms.mails.length} />
                  </TabsTrigger>
                  {showWa && (
                    <TabsTrigger value="wa" className="px-3">
                      WhatsApp
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>
              <div className="p-4 md:p-5">
                <TabsContent value="timeline">
                  <Timeline activities={activities} tz={tz} />
                </TabsContent>
                {perms.viewOpportunity && (
                  <TabsContent value="opps">
                    <PaneToolbar
                      action={
                        canEdit &&
                        perms.createOpportunity && (
                          <Button size="sm" variant="outline" onClick={() => setModal("opportunity")}>
                            <Plus /> 新建商机
                          </Button>
                        )
                      }
                    >
                      {opportunities.length > 0 && (
                        <span className="tabular-nums">
                          共 {opportunities.length} 个商机，进行中 {openOpps.length} 个
                        </span>
                      )}
                    </PaneToolbar>
                    {opportunities.length === 0 ? (
                      <PaneEmpty>还没有商机</PaneEmpty>
                    ) : (
                      <ul className="divide-y divide-border/70">
                        {opportunities.map((o) => (
                          <OppRow key={o.id} o={o} tz={tz} onEdit={canEdit ? () => setEditingOpp(o) : undefined} />
                        ))}
                      </ul>
                    )}
                  </TabsContent>
                )}
                {quotations && (
                  <TabsContent value="quotations">
                    <CustomerDocsCard kind="quotation" customerId={c.id} rows={quotations} canCreate={canEdit && perms.createQuotation} tz={tz} />
                  </TabsContent>
                )}
                {orders && (
                  <TabsContent value="orders">
                    <CustomerDocsCard kind="order" customerId={c.id} rows={orders} canCreate={canEdit && perms.createOrder} tz={tz} />
                  </TabsContent>
                )}
                <TabsContent value="tasks">
                  <PaneToolbar
                    action={
                      canEdit && (
                        <Button size="sm" variant="outline" onClick={() => setModal("task")}>
                          <Plus /> 设提醒
                        </Button>
                      )
                    }
                  >
                    {tasks.length > 0 && (
                      <span className="tabular-nums">
                        共 {tasks.length} 条日程，未完成 {openTasks.length} 条
                      </span>
                    )}
                  </PaneToolbar>
                  <TaskList tasks={tasks} tz={tz} showCustomer={false} empty="没有关联的日程" />
                </TabsContent>
                <TabsContent value="mails">
                  <CustomerMails rows={comms.mails} tz={tz} composeHref={composeHref} />
                </TabsContent>
                {showWa && (
                  <TabsContent value="wa">
                    <CustomerWhatsapp rows={comms.wa} tz={tz} chatHref={waHref} />
                  </TabsContent>
                )}
              </div>
            </Tabs>
          </section>
        </div>
      </div>

      {/* 手机端底部操作栏（在底部导航上方） */}
      <div className="h-14 md:hidden" aria-hidden />
      <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-1 border-t border-border/70 bg-card/95 px-2 py-1.5 backdrop-blur md:hidden">
        {composeHref && <BarLink href={composeHref} icon={<Mail />} label="邮件" />}
        {waHref && <BarLink href={waHref} icon={<MessageCircle />} label="WhatsApp" />}
        {primaryPhone && <BarLink href={`tel:${primaryPhone.replace(/[^\d+]/g, "")}`} icon={<Phone />} label="电话" />}
        {canClaim ? (
          <Button className="ml-auto h-10 flex-1 rounded-full" disabled={busy} onClick={() => run(claimCustomersAction([c.id]))}>
            领取到我的客户
          </Button>
        ) : canEdit ? (
          <Button className="ml-auto h-10 flex-1 rounded-full" onClick={focusFollowUp}>
            <NotebookPen /> 写跟进
          </Button>
        ) : null}
      </div>

      {/* 弹窗 */}
      <Dialog open={modal === "edit"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-2xl">{modal === "edit" && <CustomerForm customer={c} options={options} onDone={close} />}</DialogContent>
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
        <DialogContent className="sm:max-w-lg">{modal === "task" && <TaskForm customerId={c.id} tz={tz} onDone={close} />}</DialogContent>
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
                run(deleteCustomerAction(c.id), () => router.push(listHref));
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

function BarLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex h-11 min-w-14 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] text-muted-foreground active:bg-muted [&_svg]:size-5 [&_svg]:text-foreground/80"
    >
      {icon}
      {label}
    </Link>
  );
}

function initialOf(name: string) {
  const ch = Array.from(name.trim())[0] ?? "?";
  return ch.toUpperCase();
}

function MetaLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-2 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground/70">
      {icon}
      <span className="flex min-w-0 flex-wrap items-center">{children}</span>
    </li>
  );
}

function GridField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h3>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">{children}</dl>
    </div>
  );
}

function TabCount({ n }: { n: number }) {
  return <span className="text-xs font-normal text-muted-foreground tabular-nums">{n}</span>;
}

/** 右栏顶部的可折叠条：进行中的商机 / 计划日程 */
function CollapseBar({ title, count, action, children }: { title: string; count: number; action?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="surface">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          {title}
          <span className="text-muted-foreground tabular-nums">({count})</span>
        </button>
        {action}
      </div>
      {open && <div className="border-t border-border/70 px-4 py-1">{children}</div>}
    </section>
  );
}

function OppRow({ o, tz, onEdit }: { o: OpportunityView; tz: string; onEdit?: () => void }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{o.name}</p>
        <p className="text-xs text-muted-foreground">
          {o.ownerName}
          {o.expectedCloseAt && (
            <>
              {" · 预计 "}
              <span className="tabular-nums">{formatDate(o.expectedCloseAt, tz)}</span>
              {" 成交"}
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-medium whitespace-nowrap tabular-nums">{formatMoney(o.amount, o.currency)}</span>
        <Badge
          variant={o.stageKind === "WON" ? "success" : o.stageKind === "LOST" ? "secondary" : "outline"}
          className={cn(o.stageKind === "LOST" && "text-muted-foreground")}
        >
          {o.stageName}
        </Badge>
        {onEdit && (
          <Button variant="ghost" size="icon-sm" aria-label="编辑商机" onClick={onEdit}>
            <Pencil />
          </Button>
        )}
      </div>
    </li>
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
    <form onSubmit={submit} className="surface p-4 md:p-5">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="method" value={method} />
      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="跟进方式">
        <span className="mr-1 text-sm font-semibold">写跟进</span>
        {FOLLOW_METHODS.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={method === m.value}
            onClick={() => setMethod(m.value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors",
              method === m.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <Textarea name="content" placeholder="记录这次沟通的内容：客户需求、报价、异议、约定的下一步…" rows={3} className="rounded-xl" />
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
        <Button type="submit" className="ml-auto" disabled={pending}>
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
    return <PaneEmpty>还没有动态</PaneEmpty>;
  }
  const count = (k: ActivityKind | "all") => (k === "all" ? activities.length : activities.filter((a) => kindOf(a) === k).length);
  const shown = kind === "all" ? activities : activities.filter((a) => kindOf(a) === kind);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="动态分类">
        {ACTIVITY_KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            role="tab"
            aria-selected={kind === k.key}
            onClick={() => setKind(k.key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors",
              kind === k.key ? "bg-primary/10 font-medium text-primary" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {k.label} <span className="tabular-nums opacity-70">{count(k.key)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <PaneEmpty>这一类还没有动态</PaneEmpty>
      ) : (
        <ol className="relative space-y-5 before:absolute before:top-2 before:bottom-2 before:left-2.5 before:w-px before:bg-border/80">
          {shown.map((a) =>
            a.type === "FOLLOW_UP" ? (
              <li key={a.id} className="relative flex gap-3">
                <span className="z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-card">
                  {METHOD_ICON[a.method ?? ""] ?? <Star className="size-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{a.userName}</span> · {followMethodLabel(a.method)}
                    {a.event ? "" : "跟进"} · <span className="tabular-nums">{formatDateTime(a.createdAt, tz)}</span>
                    {a.opportunityName && ` · 商机：${a.opportunityName}`}
                  </p>
                  <p className="mt-1.5 rounded-xl bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">{a.content}</p>
                </div>
              </li>
            ) : (
              <li key={a.id} className="relative flex gap-3 text-xs text-muted-foreground">
                <span className="z-10 mt-1 ml-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/40 ring-4 ring-card" />
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
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour"));
  const weekday = get("weekday");
  const working = !["Sat", "Sun"].includes(weekday) && hour >= 9 && hour < 18;
  const offset = (z: string) => {
    const s =
      new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "longOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value ??
      "GMT";
    const m = s.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  };
  const diff = (offset(zone) - offset(myTz)) / 60;
  const WEEK: Record<string, string> = { Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六", Sun: "周日" };
  return (
    <li
      className="flex min-w-0 items-center gap-2"
      title={`${zone}，${diff === 0 ? "与你同一时区" : `比你${diff > 0 ? "早" : "晚"} ${Math.abs(diff)} 小时`}`}
    >
      <Clock className="size-4 shrink-0 text-muted-foreground/70" />
      <span className="flex flex-wrap items-center gap-1.5">
        <span>
          当地{" "}
          <span className="text-foreground tabular-nums">
            {get("hour")}:{get("minute")}
          </span>{" "}
          {WEEK[weekday]}
        </span>
        <span className={cn("rounded-full px-1.5 text-[11px]", working ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground")}>
          {working ? "工作时间" : "非工作时间"}
        </span>
      </span>
    </li>
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
    <Panel
      title={
        <>
          联系人 <span className="font-normal text-muted-foreground tabular-nums">({contacts.length})</span>
        </>
      }
      icon={<Users className="size-4 text-muted-foreground" />}
      action={
        canEdit && (
          <Button size="xs" variant="ghost" className="text-primary" onClick={() => setEditing({})}>
            <Plus /> 添加
          </Button>
        )
      }
      bodyClassName="pb-2"
    >
      {contacts.length === 0 ? (
        <p className="pt-2 pb-5 text-center text-sm text-muted-foreground">还没有联系人</p>
      ) : (
        <ul className="divide-y divide-border/70">
          {contacts.map((ct) => (
            <li key={ct.id} className="group flex gap-3 py-3 text-sm">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                {initialOf(ct.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{ct.name}</span>
                  {ct.isPrimary && (
                    <span className="shrink-0 rounded-md bg-primary/10 px-1.5 text-[11px] leading-5 font-medium text-primary" title="主联系人">
                      主
                    </span>
                  )}
                  {canEdit && (
                    <span className="ml-auto flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                      <Button variant="ghost" size="icon-xs" aria-label={`编辑 ${ct.name}`} onClick={() => setEditing(ct)}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-xs" aria-label={`删除 ${ct.name}`} onClick={() => runAction(deleteContactAction(ct.id))}>
                        <Trash2 />
                      </Button>
                    </span>
                  )}
                </div>
                {ct.title && <p className="text-xs text-muted-foreground">{ct.title}</p>}
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {ct.email && (
                    <a
                      href={mailEnabled ? `/mail/compose?to=${encodeURIComponent(ct.email)}` : `mailto:${ct.email}`}
                      className="flex min-w-0 items-center gap-1.5 hover:text-primary"
                    >
                      <Mail className="size-3 shrink-0" />
                      <span className="truncate">{ct.email}</span>
                    </a>
                  )}
                  {ct.phone && (
                    <p className="flex items-center gap-1.5 tabular-nums">
                      <Phone className="size-3 shrink-0" />
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
                      className="flex items-center gap-1.5 tabular-nums hover:text-primary"
                    >
                      <MessageCircle className="size-3 shrink-0" />
                      {ct.whatsapp}
                    </a>
                  )}
                  {ct.remark && <p className="line-clamp-2">{ct.remark}</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <ContactForm
              key={editing.id ?? "new"}
              customerId={customerId}
              contact={editing}
              first={!contacts.length}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Panel>
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
