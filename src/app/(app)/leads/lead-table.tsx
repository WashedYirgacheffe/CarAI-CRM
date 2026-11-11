"use client";

import { useState } from "react";
import { EmptyState } from "@/components/crm/empty-state";
import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Hand, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2, UserCheck, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DesktopOnly, MobileCard, MobileList } from "@/components/crm/mobile-list";
import { ActionSheet } from "@/components/crm/swipe-row";
import type { MenuEntry } from "@/components/crm/action-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { COUNTRIES, CURRENCIES, CUSTOMER_SOURCES, LEAD_INVALID_REASONS, LEAD_STATUSES, countryName, formatDate } from "@/lib/crm";
import { assignLeadsAction, claimLeadAction, convertLeadAction, deleteLeadAction, saveLeadAction, setLeadStatusAction } from "./actions";

export type LeadRow = {
  id: string;
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  country: string | null;
  source: string | null;
  products: string | null;
  inquiry: string | null;
  status: "NEW" | "QUALIFYING" | "CONTACTED" | "CONVERTED" | "INVALID";
  invalidReason: string | null;
  invalidNote: string | null;
  ownerId: string | null;
  ownerName: string | null;
  customerId: string | null;
  customerName: string | null;
  createdAt: string;
};

type Perms = { create: boolean; edit: boolean; delete: boolean; assign: boolean; createOpportunity: boolean };
type Modal = { kind: "edit"; lead: Partial<LeadRow> } | { kind: "convert" | "invalid"; lead: LeadRow } | { kind: "assign"; ids: string[] } | null;

/** 跟进中的三个阶段，可以互相切换 */
const PROGRESS = LEAD_STATUSES.filter(
  (s): s is Extract<(typeof LEAD_STATUSES)[number], { value: "NEW" | "QUALIFYING" | "CONTACTED" }> =>
    s.value === "NEW" || s.value === "QUALIFYING" || s.value === "CONTACTED",
);

const STATUS_STYLE: Record<LeadRow["status"], string> = {
  NEW: "bg-brand-soft text-brand-ink",
  QUALIFYING: "bg-foreground/[0.07] text-foreground",
  CONTACTED: "bg-amber-50 text-amber-800",
  CONVERTED: "bg-emerald-50 text-emerald-700",
  INVALID: "bg-muted text-muted-foreground",
};

/** 新建线索按钮（放在页面标题右侧），自带新建弹窗 */
export function NewLeadButton({ canAssign }: { canAssign: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> 新建线索
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          {open && <LeadForm key="new" lead={{}} canAssign={canAssign} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * 线索列表（卡片右栏）：工具条（标题 + 数量、批量分配、搜索）→ 表格 → footer 插槽放分页。
 * 新建线索按钮见 NewLeadButton。
 */
export function LeadTable({
  rows,
  tab,
  q,
  tz,
  members,
  perms,
  title,
  total,
  footer,
}: {
  rows: LeadRow[];
  tab: string;
  q: string;
  tz: string;
  members: { id: string; name: string }[];
  currentUserId: string;
  perms: Perms;
  title: string;
  total: number;
  footer?: React.ReactNode;
}) {
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids = [...selected].filter((id) => rows.some((r) => r.id === id));
  const close = () => setModal(null);
  const toggle = (id: string, v: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  const [sheetLead, setSheetLead] = useState<LeadRow | null>(null);
  const menu = (l: LeadRow): MenuEntry[] => {
    const open = l.status === "NEW" || l.status === "QUALIFYING" || l.status === "CONTACTED";
    return [
      { label: "编辑", icon: Pencil, hidden: !perms.edit, onSelect: () => setModal({ kind: "edit", lead: l }) },
      ...PROGRESS.filter((p) => p.value !== l.status).map((p) => ({
        label: `改为「${p.label}」`,
        hidden: !(perms.edit && open),
        onSelect: () => void runAction(setLeadStatusAction(l.id, p.value)),
      })),
      { label: "标记为无效", icon: Ban, hidden: !(perms.edit && open), onSelect: () => setModal({ kind: "invalid", lead: l }) },
      {
        label: "恢复为新线索",
        icon: RotateCcw,
        hidden: !(perms.edit && l.status === "INVALID"),
        onSelect: () => void runAction(setLeadStatusAction(l.id, "NEW")),
      },
      { label: "分配给…", icon: UserPlus, hidden: !(perms.assign && open), onSelect: () => setModal({ kind: "assign", ids: [l.id] }) },
      "sep",
      { label: "删除", icon: Trash2, destructive: true, hidden: !perms.delete, onSelect: () => void runAction(deleteLeadAction(l.id)) },
    ];
  };
  const actions = (l: LeadRow, open: boolean) => (
    <div className="flex items-center gap-1">
      {!l.ownerId && open && perms.edit && (
        <Button size="sm" variant="outline" onClick={() => runAction(claimLeadAction(l.id))}>
          领取
        </Button>
      )}
      {l.ownerId && open && perms.edit && (
        <Button size="sm" variant="outline" onClick={() => setModal({ kind: "convert", lead: l })}>
          转客户
        </Button>
      )}
      {(perms.edit || perms.delete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="更多操作" className="max-md:hidden">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            {perms.edit && <DropdownMenuItem onSelect={() => setModal({ kind: "edit", lead: l })}>编辑</DropdownMenuItem>}
            {perms.edit &&
              open &&
              PROGRESS.filter((p) => p.value !== l.status).map((p) => (
                <DropdownMenuItem key={p.value} onSelect={() => runAction(setLeadStatusAction(l.id, p.value))}>
                  改为「{p.label}」
                </DropdownMenuItem>
              ))}
            {perms.edit && open && <DropdownMenuItem onSelect={() => setModal({ kind: "invalid", lead: l })}>标记为无效</DropdownMenuItem>}
            {perms.edit && l.status === "INVALID" && (
              <DropdownMenuItem onSelect={() => runAction(setLeadStatusAction(l.id, "NEW"))}>恢复为新线索</DropdownMenuItem>
            )}
            {perms.assign && open && <DropdownMenuItem onSelect={() => setModal({ kind: "assign", ids: [l.id] })}>分配给…</DropdownMenuItem>}
            {perms.delete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => runAction(deleteLeadAction(l.id))}>
                  删除
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-3 md:px-5">
        <h2 className="mr-1 flex min-h-8 items-baseline gap-1.5 text-[15px] font-medium">
          {title}
          <span className="text-[13px] font-normal text-muted-foreground">
            · <span className="tabular-nums">{total}</span> 条线索
          </span>
        </h2>
        {perms.assign && ids.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-full bg-accent py-0.5 pr-1 pl-3 text-[13px] text-accent-foreground">
            <span>
              已选 <span className="font-medium tabular-nums">{ids.length}</span> 条
            </span>
            <Button variant="outline" size="xs" className="bg-card" onClick={() => setModal({ kind: "assign", ids })}>
              分配给…
            </Button>
            <Button size="icon-xs" variant="ghost" onClick={() => setSelected(new Set())} aria-label="取消选择">
              <X />
            </Button>
          </div>
        )}
        <Form action="/leads" className="ml-auto w-full sm:w-64">
          {tab !== "todo" && <input type="hidden" name="tab" value={tab} />}
          <div className="relative">
            <button
              type="submit"
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="搜索"
            >
              <Search className="size-4" />
            </button>
            <Input name="q" defaultValue={q} placeholder="公司 / 联系人 / 邮箱 / 询盘内容" className="h-8 pl-8 text-[13px]" />
          </div>
        </Form>
      </div>

      <MobileList empty="没有线索">
        {rows.map((l) => {
          const open = l.status === "NEW" || l.status === "QUALIFYING" || l.status === "CONTACTED";
          return (
            <MobileCard
              key={l.id}
              title={l.companyName ?? l.contactName ?? l.email}
              sub={[l.companyName && l.contactName, l.email, l.country && countryName(l.country)].filter(Boolean).join(" · ")}
              aside={
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[l.status])}>
                  {LEAD_STATUSES.find((s) => s.value === l.status)?.label}
                </span>
              }
              select={
                perms.assign
                  ? { checked: selected.has(l.id), onChange: (v) => toggle(l.id, v), label: "选择", selecting: selected.size > 0 }
                  : undefined
              }
              swipe={{
                left: [
                  {
                    label: "领取",
                    icon: Hand,
                    tone: "primary",
                    hidden: !(!l.ownerId && open && perms.edit),
                    onAction: () => void runAction(claimLeadAction(l.id)),
                  },
                  {
                    label: "转客户",
                    icon: UserCheck,
                    tone: "primary",
                    hidden: !(l.ownerId && open && perms.edit),
                    onAction: () => setModal({ kind: "convert", lead: l }),
                  },
                ],
                right: [
                  { label: "更多", icon: MoreHorizontal, tone: "neutral", hidden: !(perms.edit || perms.delete), onAction: () => setSheetLead(l) },
                  { label: "无效", icon: Ban, tone: "amber", hidden: !(perms.edit && open), onAction: () => setModal({ kind: "invalid", lead: l }) },
                ],
              }}
              footer={
                <>
                  <span className="mr-auto text-xs text-muted-foreground">
                    {[l.source, l.ownerName ?? "待分配", formatDate(l.createdAt, tz)].filter(Boolean).join(" · ")}
                  </span>
                  {actions(l, open)}
                </>
              }
            >
              {l.products && <p className="truncate text-[13px] font-medium">{l.products}</p>}
              {l.inquiry && <p className="line-clamp-2 text-[13px] text-muted-foreground">{l.inquiry}</p>}
              {l.status === "CONVERTED" && l.customerId && (
                <Link href={`/customers/${l.customerId}`} className="relative z-10 mt-1 inline-block text-xs text-primary">
                  已转客户：{l.customerName}
                </Link>
              )}
              {l.status === "INVALID" && l.invalidReason && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  无效：{l.invalidReason}
                  {l.invalidNote && `：${l.invalidNote}`}
                </p>
              )}
            </MobileCard>
          );
        })}
      </MobileList>
      <ActionSheet
        open={!!sheetLead}
        onOpenChange={(o) => !o && setSheetLead(null)}
        title={sheetLead ? (sheetLead.companyName ?? sheetLead.contactName ?? sheetLead.email) : ""}
        items={sheetLead ? menu(sheetLead) : []}
      />

      <DesktopOnly>
        <Table>
          <TableHeader>
            <TableRow>
              {perms.assign && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="全选"
                    checked={rows.length > 0 && ids.length === rows.length ? true : ids.length ? "indeterminate" : false}
                    onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </TableHead>
              )}
              <TableHead>公司 / 联系人</TableHead>
              <TableHead>询盘内容</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>负责人</TableHead>
              <TableHead>时间</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState>没有线索</EmptyState>
                </TableCell>
              </TableRow>
            )}
            {rows.map((l) => {
              const open = l.status === "NEW" || l.status === "QUALIFYING" || l.status === "CONTACTED";
              return (
                <TableRow key={l.id}>
                  {perms.assign && (
                    <TableCell>
                      <Checkbox
                        aria-label="选择"
                        checked={selected.has(l.id)}
                        onCheckedChange={(v) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (v) n.add(l.id);
                            else n.delete(l.id);
                            return n;
                          })
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell className="max-w-64">
                    <div className="truncate font-medium">{l.companyName ?? l.contactName ?? l.email}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[l.companyName && l.contactName, l.email, l.country && countryName(l.country)].filter(Boolean).join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-80">
                    {l.products && <div className="truncate text-xs font-medium">{l.products}</div>}
                    <div className="line-clamp-2 text-sm whitespace-normal text-muted-foreground">{l.inquiry ?? "—"}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{l.source ?? "—"}</TableCell>
                  <TableCell>
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[l.status])}>
                      {LEAD_STATUSES.find((s) => s.value === l.status)?.label}
                    </span>
                    {l.status === "CONVERTED" && l.customerId && (
                      <Link href={`/customers/${l.customerId}`} className="mt-0.5 block max-w-40 truncate text-xs hover:text-primary hover:underline">
                        {l.customerName}
                      </Link>
                    )}
                    {l.status === "INVALID" && l.invalidReason && (
                      <div className="mt-0.5 max-w-40 truncate text-xs text-muted-foreground" title={l.invalidNote ?? undefined}>
                        {l.invalidReason}
                        {l.invalidNote && `：${l.invalidNote}`}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{l.ownerName ?? <span className="text-muted-foreground">待分配</span>}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatDate(l.createdAt, tz)}</TableCell>
                  <TableCell>{actions(l, open)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DesktopOnly>
      {footer}

      <Dialog open={!!modal} onOpenChange={(o) => !o && close()}>
        <DialogContent className={modal?.kind === "edit" ? "sm:max-w-2xl" : undefined}>
          {modal?.kind === "edit" && <LeadForm key={modal.lead.id ?? "new"} lead={modal.lead} canAssign={perms.assign} onDone={close} />}
          {modal?.kind === "convert" && <ConvertForm lead={modal.lead} canOpp={perms.createOpportunity} onDone={close} />}
          {modal?.kind === "invalid" && <InvalidForm lead={modal.lead} onDone={close} />}
          {modal?.kind === "assign" && (
            <AssignForm
              ids={modal.ids}
              members={members}
              onDone={() => {
                close();
                setSelected(new Set());
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function LeadForm({ lead, canAssign, onDone }: { lead: Partial<LeadRow>; canAssign: boolean; onDone: () => void }) {
  const [state, submit, pending] = useActionForm(saveLeadAction, onDone);
  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{lead.id ? "编辑线索" : "新建线索"}</DialogTitle>
      </DialogHeader>
      {lead.id && <input type="hidden" name="id" value={lead.id} />}
      <FieldGroup className="max-h-[68vh] gap-4 overflow-y-auto py-4 pr-1">
        <FormMessage state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="l-company">公司名称</FieldLabel>
            <Input id="l-company" name="companyName" defaultValue={lead.companyName ?? ""} autoFocus />
            <FieldErrors state={state} name="companyName" />
          </Field>
          <Field>
            <FieldLabel htmlFor="l-contact">联系人</FieldLabel>
            <Input id="l-contact" name="contactName" defaultValue={lead.contactName ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="l-email">邮箱</FieldLabel>
            <Input id="l-email" name="email" type="email" defaultValue={lead.email ?? ""} />
            <FieldErrors state={state} name="email" />
          </Field>
          <Field>
            <FieldLabel htmlFor="l-wa">WhatsApp</FieldLabel>
            <Input id="l-wa" name="whatsapp" defaultValue={lead.whatsapp ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="l-phone">电话</FieldLabel>
            <Input id="l-phone" name="phone" defaultValue={lead.phone ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="l-country">国家 / 地区</FieldLabel>
            <NativeSelect id="l-country" name="country" defaultValue={lead.country ?? ""}>
              <option value="">未知</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="l-source">来源</FieldLabel>
            <NativeSelect id="l-source" name="source" defaultValue={lead.source ?? ""}>
              <option value="">未填写</option>
              {CUSTOMER_SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="l-products">意向产品</FieldLabel>
            <Input id="l-products" name="products" defaultValue={lead.products ?? ""} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="l-inquiry">询盘内容</FieldLabel>
          <Textarea id="l-inquiry" name="inquiry" defaultValue={lead.inquiry ?? ""} rows={4} placeholder="粘贴客户的询盘原文" />
        </Field>
        {!lead.id && canAssign && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="unassigned" /> 放入「待分配」，稍后分给业务员
          </label>
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

function ConvertForm({ lead, canOpp, onDone }: { lead: LeadRow; canOpp: boolean; onDone: () => void }) {
  const router = useRouter();
  const [withOpp, setWithOpp] = useState(canOpp);
  const [state, submit, pending] = useActionForm(convertLeadAction, (_f, r) => {
    onDone();
    if (r.customerId) router.push(`/customers/${r.customerId}`);
  });
  const defaultName = lead.companyName ?? (lead.email ? (lead.email.split("@")[1]?.split(".")[0] ?? "") : (lead.contactName ?? ""));
  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>转为客户</DialogTitle>
        <DialogDescription>系统会按公司名和邮箱域名查重：已有客户（你的或公海里的）会直接并入，不会重复建档。</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={lead.id} />
      <FieldGroup className="gap-4 py-4">
        <FormMessage state={state} />
        <Field>
          <FieldLabel htmlFor="cv-name">客户名称</FieldLabel>
          <Input id="cv-name" name="customerName" defaultValue={defaultName} required autoFocus />
          <FieldErrors state={state} name="customerName" />
        </Field>
        {canOpp && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="withOpportunity" checked={withOpp} onCheckedChange={(v) => setWithOpp(!!v)} /> 同时创建商机
          </label>
        )}
        {withOpp && (
          <>
            <Field>
              <FieldLabel htmlFor="cv-opp">商机名称</FieldLabel>
              <Input id="cv-opp" name="oppName" defaultValue={lead.products ? `${lead.products} 询盘` : ""} placeholder="留空则用「客户名 询盘」" />
            </Field>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field>
                <FieldLabel htmlFor="cv-amount">预计金额</FieldLabel>
                <Input id="cv-amount" name="amount" type="number" min={0} step="0.01" />
              </Field>
              <Field>
                <FieldLabel htmlFor="cv-cur">币种</FieldLabel>
                <NativeSelect id="cv-cur" name="currency" defaultValue="USD">
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </>
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "处理中…" : "转为客户"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function InvalidForm({ lead, onDone }: { lead: LeadRow; onDone: () => void }) {
  const [why, setWhy] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await runAction(setLeadStatusAction(lead.id, "INVALID", { reason: why, note }));
        setBusy(false);
        if (r.ok) onDone();
      }}
    >
      <DialogHeader>
        <DialogTitle>标记为无效</DialogTitle>
        <DialogDescription>无效原因会单独统计，方便回头看哪些渠道的询盘质量差。</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4 py-4">
        <Field>
          <FieldLabel htmlFor="inv-why">原因</FieldLabel>
          <NativeSelect id="inv-why" value={why} onChange={(e) => setWhy(e.target.value)} required>
            <option value="">请选择</option>
            {LEAD_INVALID_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="inv-note">补充说明（选填）</FieldLabel>
          <Textarea id="inv-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" variant="destructive" disabled={busy || !why}>
          确定
        </Button>
      </DialogFooter>
    </form>
  );
}

function AssignForm({ ids, members, onDone }: { ids: string[]; members: { id: string; name: string }[]; onDone: () => void }) {
  const [uid, setUid] = useState(members[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await runAction(assignLeadsAction(ids, uid));
        setBusy(false);
        if (r.ok) onDone();
      }}
    >
      <DialogHeader>
        <DialogTitle>分配 {ids.length} 条线索</DialogTitle>
      </DialogHeader>
      <FieldGroup className="py-4">
        <Field>
          <FieldLabel htmlFor="as-member">分配给</FieldLabel>
          <NativeSelect id="as-member" value={uid} onChange={(e) => setUid(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={busy || !uid}>
          确定
        </Button>
      </DialogFooter>
    </form>
  );
}
