"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, Hand, Plus, UserPlus, Waves, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { runAction } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { formatDate, relativeDays } from "@/lib/crm";
import { CountryLabel, StarRating, StatusBadge, Tags } from "@/components/crm/bits";
import { CustomerForm, type CustomerOptionsProp } from "@/components/crm/customer-form";
import { assignPoolCustomersAction, claimCustomersAction, releaseCustomersAction, transferCustomersAction } from "@/app/(app)/customers/actions";
import type { CustomerRow } from "@/server/customer-list";
import { DesktopOnly, MobileCard, MobileLine, MobileList } from "@/components/crm/mobile-list";

type Member = { id: string; name: string };

export type CustomerTablePerms = {
  create?: boolean;
  transfer?: boolean;
  release?: boolean;
  claim?: boolean;
  assign?: boolean;
};

type BatchDialog = "transfer" | "release" | "assign" | null;

/** 新建客户按钮（放在页面标题右侧），自带新建弹窗 */
export function NewCustomerButton({ options }: { options: CustomerOptionsProp }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> 新建客户
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">{open && <CustomerForm options={options} onDone={() => setOpen(false)} />}</DialogContent>
      </Dialog>
    </>
  );
}

/**
 * 客户列表（卡片右栏）：工具条（标题 + 数量、批量操作、toolbar 插槽放筛选）→ 表格 → footer 插槽放分页。
 * 新建客户按钮见 NewCustomerButton。
 */
export function CustomerTable({
  rows,
  mode,
  tz,
  members,
  perms,
  title,
  total,
  toolbar,
  footer,
}: {
  rows: CustomerRow[];
  mode: "mine" | "pool";
  tz: string;
  members: Member[];
  perms: CustomerTablePerms;
  /** @deprecated 新建入口已移到 NewCustomerButton，保留参数兼容 */
  options?: CustomerOptionsProp;
  title: string;
  total: number;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<BatchDialog>(null);
  const [busy, setBusy] = useState(false);
  const ids = [...selected].filter((id) => rows.some((r) => r.id === id));
  const allChecked = rows.length > 0 && ids.length === rows.length;
  const now = new Date();

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  // 手机左滑单行操作：只选中这一行再打开对应弹窗
  const [solo, setSolo] = useState(false);
  const only = (id: string, d: BatchDialog) => {
    setSelected(new Set([id]));
    setSolo(true);
    setDialog(d);
  };
  const closeDialog = () => {
    setDialog(null);
    // 左滑进来的单行操作，取消后不留在多选状态
    if (solo) setSelected(new Set());
    setSolo(false);
  };

  async function run(p: Promise<{ ok?: boolean }>) {
    setBusy(true);
    const r = await runAction(p as never);
    setBusy(false);
    if (r.ok) {
      setSelected(new Set());
      setDialog(null);
      setSolo(false);
    }
  }

  const batchButtons =
    mode === "mine" ? (
      <>
        {perms.transfer && (
          <Button size="xs" variant="outline" className="bg-card" onClick={() => setDialog("transfer")}>
            转移
          </Button>
        )}
        {perms.release && (
          <Button size="xs" variant="outline" className="bg-card" onClick={() => setDialog("release")}>
            放入公海
          </Button>
        )}
      </>
    ) : (
      <>
        {perms.claim && (
          <Button size="xs" variant="outline" className="bg-card" disabled={busy} onClick={() => run(claimCustomersAction(ids))}>
            领取
          </Button>
        )}
        {perms.assign && (
          <Button size="xs" variant="outline" className="bg-card" onClick={() => setDialog("assign")}>
            分配给…
          </Button>
        )}
      </>
    );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-3 md:px-5">
        <h2 className="mr-1 flex min-h-8 items-baseline gap-1.5 text-[15px] font-medium max-md:hidden">
          {title}
          <span className="text-[13px] font-normal text-muted-foreground">
            · <span className="tabular-nums">{total}</span> 个客户
          </span>
        </h2>
        {ids.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-full bg-accent py-0.5 pr-1 pl-3 text-[13px] text-accent-foreground">
            <span>
              已选 <span className="font-medium tabular-nums">{ids.length}</span> 个
            </span>
            {batchButtons}
            <Button size="icon-xs" variant="ghost" onClick={() => setSelected(new Set())} aria-label="取消选择">
              <X />
            </Button>
          </div>
        )}
        {toolbar}
      </div>

      <MobileList empty={mode === "mine" ? "没有符合条件的客户" : "公海里暂时没有客户"}>
        {rows.map((r) => {
          const overdue = r.nextFollowAt && new Date(r.nextFollowAt) < now;
          const poolDays = r.poolDueAt ? Math.ceil((new Date(r.poolDueAt).getTime() - now.getTime()) / 86_400_000) : null;
          return (
            <MobileCard
              key={r.id}
              href={`/customers/${r.id}`}
              title={r.name}
              aside={<StatusBadge name={r.statusName} color={r.statusColor} />}
              sub={
                <span className="flex items-center gap-2">
                  <CountryLabel code={r.country} />
                  {r.contactName && (
                    <span className="truncate">
                      · {r.contactName}
                      {r.contactCount > 1 && ` 等 ${r.contactCount} 人`}
                    </span>
                  )}
                </span>
              }
              select={{ checked: selected.has(r.id), onChange: (v) => toggle(r.id, v), label: `选择 ${r.name}`, selecting: ids.length > 0 }}
              swipe={{
                right:
                  mode === "mine"
                    ? [
                        { label: "放入公海", icon: Waves, tone: "amber", hidden: !perms.release, onAction: () => only(r.id, "release") },
                        { label: "转移", icon: ArrowRightLeft, tone: "neutral", hidden: !perms.transfer, onAction: () => only(r.id, "transfer") },
                      ]
                    : [
                        { label: "领取", icon: Hand, tone: "primary", hidden: !perms.claim, onAction: () => run(claimCustomersAction([r.id])) },
                        { label: "分配", icon: UserPlus, tone: "neutral", hidden: !perms.assign, onAction: () => only(r.id, "assign") },
                      ],
              }}
            >
              <MobileLine
                items={
                  mode === "mine"
                    ? [
                        r.star > 0 && <StarRating value={r.star} />,
                        r.lastContactAt ? `${relativeDays(r.lastContactAt, now)}联系` : "从未联系",
                        r.nextFollowAt && (
                          <span className={cn(overdue && "font-medium text-destructive")}>下次 {formatDate(r.nextFollowAt, tz).slice(5)}</span>
                        ),
                        r.ownerName,
                        poolDays !== null && poolDays <= 7 && (
                          <span className="font-medium text-amber-600">{poolDays <= 0 ? "即将进公海" : `${poolDays} 天后进公海`}</span>
                        ),
                      ]
                    : [`${formatDate(r.poolEnteredAt, tz) || "—"} 进公海`, r.prevOwnerName && `原 ${r.prevOwnerName}`, r.poolReason]
                }
              />
            </MobileCard>
          );
        })}
      </MobileList>

      <DesktopOnly>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="全选"
                  checked={allChecked ? true : ids.length ? "indeterminate" : false}
                  onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </TableHead>
              <TableHead>客户</TableHead>
              <TableHead>国家 / 地区</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>主联系人</TableHead>
              {mode === "mine" ? (
                <>
                  <TableHead>负责人</TableHead>
                  <TableHead>最近联系</TableHead>
                  <TableHead>下次跟进</TableHead>
                  <TableHead>进公海</TableHead>
                </>
              ) : (
                <>
                  <TableHead>进入公海</TableHead>
                  <TableHead>原因</TableHead>
                  <TableHead>原负责人</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                  {mode === "mine" ? "没有符合条件的客户" : "公海里暂时没有客户"}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const overdue = r.nextFollowAt && new Date(r.nextFollowAt) < now;
              const poolDays = r.poolDueAt ? Math.ceil((new Date(r.poolDueAt).getTime() - now.getTime()) / 86_400_000) : null;
              return (
                <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox aria-label={`选择 ${r.name}`} checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, !!v)} />
                  </TableCell>
                  <TableCell className="max-w-72">
                    <Link href={`/customers/${r.id}`} className="font-medium hover:text-primary hover:underline">
                      {r.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <StarRating value={r.star} />
                      {r.groupName && <span className="text-xs text-muted-foreground">{r.groupName}</span>}
                      <Tags tags={r.tags} max={2} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <CountryLabel code={r.country} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge name={r.statusName} color={r.statusColor} />
                  </TableCell>
                  <TableCell className="max-w-56">
                    {r.contactName ? (
                      <div className="truncate">
                        {r.contactName}
                        {r.contactCount > 1 && <span className="text-xs text-muted-foreground"> 等 {r.contactCount} 人</span>}
                        {r.contactEmail && <div className="truncate text-xs text-muted-foreground">{r.contactEmail}</div>}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {mode === "mine" ? (
                    <>
                      <TableCell className="whitespace-nowrap">{r.ownerName}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{relativeDays(r.lastContactAt, now)}</TableCell>
                      <TableCell className={cn("whitespace-nowrap tabular-nums", overdue && "font-medium text-destructive")}>
                        {r.nextFollowAt ? formatDate(r.nextFollowAt, tz) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell
                        className={cn("whitespace-nowrap tabular-nums", poolDays !== null && poolDays <= 7 && "font-medium text-amber-600")}
                        title={r.poolDueAt ? `预计 ${formatDate(r.poolDueAt, tz)} 进入公海` : "不会自动进公海"}
                      >
                        {poolDays === null ? <span className="text-muted-foreground">—</span> : poolDays <= 0 ? "即将回收" : `${poolDays} 天后`}
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatDate(r.poolEnteredAt, tz) || "—"}</TableCell>
                      <TableCell className="max-w-56 truncate text-muted-foreground">{r.poolReason ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {r.prevOwnerName ?? "—"}
                        {r.poolCount > 1 && <span className="ml-1 text-xs">（第 {r.poolCount} 次进公海）</span>}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DesktopOnly>
      {footer}

      <Dialog open={!!dialog} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          {dialog === "release" ? (
            <ReleaseForm count={ids.length} busy={busy} onCancel={closeDialog} onSubmit={(why) => run(releaseCustomersAction(ids, why))} />
          ) : dialog ? (
            <MemberPickForm
              title={dialog === "transfer" ? `转移 ${ids.length} 个客户` : `分配 ${ids.length} 个公海客户`}
              description={dialog === "transfer" ? "转移后，新负责人接手跟进，动态里会留下转移记录。" : "分配后客户进入该成员的私海。"}
              members={members}
              busy={busy}
              onCancel={closeDialog}
              onSubmit={(uid) => run(dialog === "transfer" ? transferCustomersAction(ids, uid) : assignPoolCustomersAction(ids, uid))}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MemberPickForm({
  title,
  description,
  members,
  busy,
  onCancel,
  onSubmit,
}: {
  title: string;
  description: string;
  members: Member[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (userId: string) => void;
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
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <FieldGroup className="py-4">
        <Field>
          <FieldLabel htmlFor="pick-member">负责人</FieldLabel>
          <NativeSelect id="pick-member" value={uid} onChange={(e) => setUid(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={busy || !uid}>
          {busy ? "处理中…" : "确定"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ReleaseForm({
  count,
  busy,
  onCancel,
  onSubmit,
}: {
  count: number;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [why, setWhy] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(why);
      }}
    >
      <DialogHeader>
        <DialogTitle>放入公海{count > 1 ? `（${count} 个客户）` : ""}</DialogTitle>
        <DialogDescription>放入后你将不再是负责人，同事可以从公海领取。</DialogDescription>
      </DialogHeader>
      <FieldGroup className="py-4">
        <Field>
          <FieldLabel htmlFor="release-why">原因</FieldLabel>
          <Input id="release-why" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="如：无采购需求 / 联系不上" autoFocus />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy ? "处理中…" : "放入公海"}
        </Button>
      </DialogFooter>
    </form>
  );
}
