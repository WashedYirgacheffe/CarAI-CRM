"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ExternalLink, Pencil, Plus, Trash2, Truck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { StatusBadge } from "@/components/crm/bits";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import {
  CARRIER_SUGGESTIONS,
  CONTAINER_TYPES,
  SHIPMENT_STATUSES,
  SHIP_MODES,
  shipMode,
  shipmentStatus,
  shippingNotice,
  trackingLink,
} from "@/lib/shipping";
import { cn } from "@/lib/utils";
import { addShipmentNoteAction, deleteShipmentAction, saveShipmentAction, setShipmentStatusAction } from "../shipment-actions";

export type ShipmentView = {
  id: string;
  no: string;
  status: string;
  mode: string;
  forwarder: string | null;
  carrier: string | null;
  bookingNo: string | null;
  blNo: string | null;
  containerNo: string | null;
  containerType: string | null;
  sealNo: string | null;
  vessel: string | null;
  trackingNo: string | null;
  trackingUrl: string | null;
  portLoading: string | null;
  portDischarge: string | null;
  packages: number | null;
  grossWeight: string | null;
  volume: string | null;
  freight: string | null;
  freightCcy: string | null;
  /** 下面这些都是 YYYY-MM-DD（企业时区） */
  cutoffAt: string | null;
  etd: string | null;
  eta: string | null;
  atd: string | null;
  ata: string | null;
  deliveredAt: string | null;
  remark: string | null;
  events: { id: string; status: string | null; at: string; note: string | null; by: string | null }[];
};

type OrderInfo = { id: string; no: string; buyer: string; contact: string | null; port: string | null; seller: string };

export function ShipmentsCard({
  order,
  shipments,
  canEdit,
  today,
}: {
  order: OrderInfo;
  shipments: ShipmentView[];
  canEdit: boolean;
  today: string;
}) {
  const [editing, setEditing] = useState<ShipmentView | "new" | null>(null);
  const [deleting, setDeleting] = useState<ShipmentView | null>(null);
  const router = useRouter();

  return (
    <Card id="shipments">
      <CardHeader>
        <CardTitle>物流</CardTitle>
        {canEdit && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
              <Plus /> 新建发货批次
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {shipments.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl bg-muted/60 px-4 py-5 text-sm text-muted-foreground">
            <Truck className="size-5 shrink-0" />
            <p>还没有发货记录。订舱后建一个发货批次，记下船名、提单号、柜号和开船 / 到港日期，客户问起来一键复制发货通知。</p>
          </div>
        ) : (
          <div className="space-y-4">
            {shipments.map((s) => (
              <ShipmentItem
                key={s.id}
                s={s}
                order={order}
                canEdit={canEdit}
                today={today}
                onEdit={() => setEditing(s)}
                onDelete={() => setDeleting(s)}
                onChanged={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {editing && (
            <ShipmentForm
              orderId={order.id}
              defaultPort={order.port}
              s={editing === "new" ? null : editing}
              onDone={() => {
                setEditing(null);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`删除发货批次 ${deleting?.no ?? ""}？`}
        description="批次的物流节点会一起删除。"
        action={() => deleteShipmentAction(deleting!.id)}
        onDone={() => router.refresh()}
      />
    </Card>
  );
}

const FLOW = SHIPMENT_STATUSES.filter((x) => x.value !== "CANCELLED");

function ShipmentItem({
  s,
  order,
  canEdit,
  today,
  onEdit,
  onDelete,
  onChanged,
}: {
  s: ShipmentView;
  order: OrderInfo;
  canEdit: boolean;
  today: string;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const st = shipmentStatus(s.status, s.mode);
  const link = trackingLink(s);
  const step = FLOW.findIndex((x) => x.value === s.status);
  const copyNotice = async () => {
    const text = shippingNotice({
      orderNo: order.no,
      buyer: order.buyer,
      contact: order.contact,
      mode: s.mode,
      carrier: s.carrier,
      vessel: s.vessel,
      blNo: s.blNo,
      bookingNo: s.bookingNo,
      containerNo: s.containerNo,
      containerType: s.containerType,
      trackingNo: s.trackingNo,
      portLoading: s.portLoading,
      portDischarge: s.portDischarge,
      packages: s.packages,
      grossWeight: s.grossWeight,
      volume: s.volume,
      etd: s.atd ?? s.etd,
      eta: s.eta,
      link,
      seller: order.seller,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success("发货通知已复制，可以粘贴到邮件或 WhatsApp");
    } catch {
      toast.error("复制失败，请检查浏览器权限");
    }
  };

  const facts: [string, string | null][] = [
    [s.mode === "air" ? "航空公司" : s.mode === "express" ? "快递公司" : "船公司", s.carrier],
    ["货代", s.forwarder],
    [s.mode === "air" ? "航班" : "船名航次", s.vessel],
    [s.mode === "air" ? "运单号" : "提单号", s.blNo],
    ["订舱号", s.bookingNo],
    ["柜号", [s.containerNo, s.containerType].filter(Boolean).join(" · ") || null],
    ["封条号", s.sealNo],
    ["快递单号", s.trackingNo],
    ["起运 → 目的", s.portLoading || s.portDischarge ? `${s.portLoading || "—"} → ${s.portDischarge || "—"}` : null],
    [
      "货物",
      [s.packages && `${s.packages} 件`, s.grossWeight && `${Number(s.grossWeight)} kg`, s.volume && `${Number(s.volume)} CBM`].filter(Boolean).join(" · ") ||
        null,
    ],
    ["截关", s.cutoffAt],
    ["ETD", s.atd ? `${s.atd}（已开）` : s.etd],
    ["ETA", s.ata ? `${s.ata}（已到）` : s.eta],
    ["签收", s.deliveredAt],
    ["运费", s.freight ? `${s.freightCcy ?? ""} ${Number(s.freight).toLocaleString()}`.trim() : null],
  ];
  const overdue = s.eta && !s.ata && s.status !== "CANCELLED" && s.status !== "DELIVERED" && s.eta < today;

  return (
    <article id={`shipment-${s.id}`} className="scroll-mt-20 rounded-2xl ring-1 ring-border/70">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3">
        <span className="font-medium tabular-nums">{s.no}</span>
        <span className="text-sm text-muted-foreground">{shipMode(s.mode)}</span>
        <StatusBadge name={st.label} color={st.color} />
        {overdue && <span className="text-xs text-rose-600">已过 ETA 还没到港</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {link && (
            <Button size="sm" variant="ghost" asChild>
              <a href={link} target="_blank" rel="noreferrer">
                <ExternalLink /> 查询轨迹
              </a>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={copyNotice}>
            <Copy /> 复制发货通知
          </Button>
          {canEdit && (
            <>
              <StatusPopover s={s} today={today} onChanged={onChanged} />
              <Button size="icon" variant="ghost" className="size-8" aria-label="编辑发货批次" onClick={onEdit}>
                <Pencil className="size-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="size-8 hover:text-destructive" aria-label="删除发货批次" onClick={onDelete}>
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </header>

      {s.status !== "CANCELLED" && (
        <ol className="flex gap-1 px-4 pt-3" aria-label="物流进度">
          {FLOW.map((f, i) => (
            <li key={f.value} className="flex-1">
              <div className={cn("h-1 rounded-full", i <= step ? "bg-teal-500" : "bg-muted")} />
              <p className={cn("mt-1 truncate text-[11px]", i === step ? "font-medium text-foreground" : "text-muted-foreground")}>
                {shipmentStatus(f.value, s.mode).label}
              </p>
            </li>
          ))}
        </ol>
      )}

      <div className="grid gap-4 px-4 py-3 md:grid-cols-[1fr_16rem]">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="break-words tabular-nums">{v}</dd>
              </div>
            ))}
          {s.remark && (
            <div className="col-span-full">
              <dt className="text-xs text-muted-foreground">备注</dt>
              <dd className="whitespace-pre-line">{s.remark}</dd>
            </div>
          )}
        </dl>
        <Timeline s={s} canEdit={canEdit} today={today} onChanged={onChanged} />
      </div>
    </article>
  );
}

function Timeline({ s, canEdit, today, onChanged }: { s: ShipmentView; canEdit: boolean; today: string; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!note.trim()) return;
    setBusy(true);
    const r = await runAction(addShipmentNoteAction(s.id, note, today));
    setBusy(false);
    if (r.ok) {
      setNote("");
      onChanged();
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">物流节点</p>
      <ol className="max-h-56 space-y-2 overflow-y-auto border-l border-border pl-3 text-sm">
        {[...s.events].reverse().map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute top-1.5 -left-[16.5px] size-2 rounded-full bg-teal-500 ring-2 ring-card" />
            <p className="text-xs text-muted-foreground tabular-nums">
              {e.at}
              {e.by && ` · ${e.by}`}
            </p>
            <p>
              {e.status && <span className="font-medium">{shipmentStatus(e.status, s.mode).label}</span>}
              {e.status && e.note && "："}
              {e.note}
            </p>
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="flex gap-1.5">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            placeholder="记一条进展，如：船延误 2 天"
            className="h-8 text-sm"
            aria-label="物流进展"
          />
          <Button size="sm" variant="secondary" disabled={busy || !note.trim()} onClick={add}>
            记录
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusPopover({ s, today, onChanged }: { s: ShipmentView; today: string; onChanged: () => void }) {
  const next = SHIPMENT_STATUSES[Math.min(SHIPMENT_STATUSES.length - 2, SHIPMENT_STATUSES.findIndex((x) => x.value === s.status) + 1)];
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string>(next.value);
  const [at, setAt] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await runAction(setShipmentStatusAction(s.id, status, at, note));
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setNote("");
      onChanged();
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setStatus(next.value);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          更新状态
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <Field>
          <FieldLabel htmlFor={`st-${s.id}`}>改为</FieldLabel>
          <NativeSelect id={`st-${s.id}`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {SHIPMENT_STATUSES.map((x) => (
              <option key={x.value} value={x.value}>
                {shipmentStatus(x.value, s.mode).label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor={`at-${s.id}`}>日期</FieldLabel>
          <Input id={`at-${s.id}`} type="date" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`nt-${s.id}`}>说明（可不填）</FieldLabel>
          <Textarea id={`nt-${s.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {status === "DEPARTED" && <p className="text-xs text-muted-foreground">开船后，已确认 / 生产中的订单会自动改为「已发货」。</p>}
        <div className="flex justify-end">
          <Button size="sm" disabled={busy} onClick={save}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ShipmentForm({ orderId, defaultPort, s, onDone }: { orderId: string; defaultPort: string | null; s: ShipmentView | null; onDone: () => void }) {
  const [state, submit, pending] = useActionForm(saveShipmentAction, () => onDone());
  const [mode, setMode] = useState(s?.mode ?? "sea");
  const sea = mode === "sea" || mode === "rail";
  const express = mode === "express";
  const f = (k: keyof ShipmentView) => (s?.[k] as string | number | null | undefined) ?? "";
  const field = (name: keyof ShipmentView, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <Field>
      <FieldLabel htmlFor={`sh-${name}`}>{label}</FieldLabel>
      <Input id={`sh-${name}`} name={name} defaultValue={f(name)} {...props} />
      <FieldErrors state={state} name={name} />
    </Field>
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{s ? `编辑发货批次 ${s.no}` : "新建发货批次"}</DialogTitle>
        <DialogDescription>只填已知的就行，之后随时补充。填了 ETA 会在到港当天提醒负责人。</DialogDescription>
      </DialogHeader>
      {s && <input type="hidden" name="id" value={s.id} />}
      <input type="hidden" name="orderId" value={orderId} />
      <FormMessage state={state} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="sh-mode">运输方式</FieldLabel>
          <NativeSelect id="sh-mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {SHIP_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {field("carrier", express ? "快递公司" : mode === "air" ? "航空公司" : "船公司", { list: "carrier-list", placeholder: express ? "DHL" : "Maersk" })}
        {field("forwarder", "货代")}
        {express ? (
          field("trackingNo", "快递单号")
        ) : (
          <>
            {field("bookingNo", "订舱号")}
            {field("blNo", mode === "air" ? "空运单号" : "提单号")}
            {field("vessel", mode === "air" ? "航班号" : "船名航次", { placeholder: mode === "air" ? "CA1234" : "MAERSK XXX / 123E" })}
          </>
        )}
        {sea && (
          <>
            {field("containerNo", "柜号", { placeholder: "多个用逗号分隔" })}
            <Field>
              <FieldLabel htmlFor="sh-containerType">柜型</FieldLabel>
              <Input id="sh-containerType" name="containerType" defaultValue={f("containerType")} list="ctn-types" />
            </Field>
            {field("sealNo", "封条号")}
          </>
        )}
        {field("portLoading", express ? "寄出地" : "起运港", { defaultValue: s ? f("portLoading") : (defaultPort ?? "") })}
        {field("portDischarge", express ? "目的地" : "目的港")}
        {!express && field("cutoffAt", "截关 / 截单", { type: "date" })}
        {field("etd", express ? "寄出日期" : "ETD 预计开船", { type: "date" })}
        {field("eta", express ? "预计送达" : "ETA 预计到港", { type: "date" })}
        {field("packages", "件数", { type: "number", min: 0, step: 1 })}
        {field("grossWeight", "毛重 kg", { type: "number", min: 0, step: "0.001" })}
        {field("volume", "体积 CBM", { type: "number", min: 0, step: "0.001" })}
        {field("freight", "运费（内部）", { type: "number", min: 0, step: "0.01" })}
        <Field>
          <FieldLabel htmlFor="sh-freightCcy">运费币种</FieldLabel>
          <NativeSelect id="sh-freightCcy" name="freightCcy" defaultValue={s?.freightCcy ?? "CNY"}>
            {["CNY", "USD", "EUR"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {field("trackingUrl", "跟踪链接（可不填，常见船司 / 快递会自动生成）", { placeholder: "https://" })}
      <Field>
        <FieldLabel htmlFor="sh-remark">备注</FieldLabel>
        <Textarea id="sh-remark" name="remark" rows={2} defaultValue={f("remark")} />
      </Field>
      <datalist id="carrier-list">
        {CARRIER_SUGGESTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="ctn-types">
        {CONTAINER_TYPES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </form>
  );
}
