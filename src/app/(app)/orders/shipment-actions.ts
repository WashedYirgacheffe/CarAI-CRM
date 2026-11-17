"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { docInScope } from "@/server/documents";
import { logActivity } from "@/server/customers";
import { audit } from "@/server/audit";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { dateInput } from "@/lib/docs";
import { parseLocalInput } from "@/lib/crm";
import { SHIPMENT_STATUSES, shipmentStatus, type ShipmentStatusValue } from "@/lib/shipping";

const denied = (message = "没有操作权限"): ActionState => ({ ok: false, message });
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const optNum = (max: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .pipe(z.number({ message: "数字格式不正确" }).min(0, "不能为负").max(max).nullable());

async function editableOrder(user: CurrentUser, id: string) {
  if (!can(user, "order.edit")) return null;
  const o = await tenantDb(user.tenantId).order.findFirst({ where: { id } });
  if (!o || !(await docInScope(user, o.ownerId))) return null;
  return o;
}

async function editableShipment(user: CurrentUser, id: string) {
  const s = await tenantDb(user.tenantId).shipment.findFirst({ where: { id } });
  if (!s) return null;
  const o = await editableOrder(user, s.orderId);
  return o ? { s, o } : null;
}

function revalidate(orderId: string, customerId: string) {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/shipments");
  revalidatePath(`/customers/${customerId}`);
}

/** 批次号 SH20261117-01：当天第几批 */
async function nextShipmentNo(tenantId: string, tz: string) {
  const day = dateInput(tz).replaceAll("-", "");
  const prefix = `SH${day}-`;
  const last = await tenantDb(tenantId).shipment.findFirst({ where: { no: { startsWith: prefix } }, orderBy: { no: "desc" }, select: { no: true } });
  const n = last ? Number(last.no.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(2, "0")}`;
}

const shipmentSchema = z.object({
  id: z.string().optional(),
  orderId: z.string().min(1),
  mode: z.enum(["sea", "air", "express", "rail", "truck"]),
  forwarder: optText(100),
  carrier: optText(100),
  bookingNo: optText(100),
  blNo: optText(100),
  containerNo: optText(300),
  containerType: optText(30),
  sealNo: optText(200),
  vessel: optText(100),
  trackingNo: optText(100),
  trackingUrl: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || null)
    .refine((v) => !v || /^https?:\/\//i.test(v), "链接要以 http:// 或 https:// 开头"),
  portLoading: optText(100),
  portDischarge: optText(100),
  packages: optNum(1e7).transform((v) => (v === null ? null : Math.round(v))),
  grossWeight: optNum(1e8),
  volume: optNum(1e6),
  freight: optNum(1e10),
  freightCcy: optText(5),
  cutoffAt: z.string().optional(),
  etd: z.string().optional(),
  eta: z.string().optional(),
  remark: optText(2000),
});

const DATE_FIELDS = ["cutoffAt", "etd", "eta"] as const;

export async function saveShipmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = shipmentSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, orderId, cutoffAt: rawCutoff, etd: rawEtd, eta: rawEta, ...d } = parsed.data;
  const tz = user.timezone;
  const raws = { cutoffAt: rawCutoff, etd: rawEtd, eta: rawEta };
  const dates = { cutoffAt: null, etd: null, eta: null } as Record<(typeof DATE_FIELDS)[number], Date | null>;
  for (const k of DATE_FIELDS) {
    const raw = raws[k]?.trim();
    const v = raw ? parseLocalInput(raw, tz) : null;
    if (raw && !v) return { ok: false, fieldErrors: { [k]: ["日期格式不正确"] } };
    dates[k] = v;
  }
  const data = { ...d, ...dates };

  if (id) {
    const found = await editableShipment(user, id);
    if (!found) return denied();
    await tenantDb(user.tenantId).shipment.updateMany({ where: { id }, data });
    await syncEtaTask(user, { ...found.s, ...data }, found.o);
    await audit(user, { action: "update", entity: "shipment", entityId: id, entityName: found.s.no, summary: `修改了订单 ${found.o.no} 的发货批次 ${found.s.no}` });
    revalidate(found.o.id, found.o.customerId);
    return { ok: true, message: "物流信息已保存" };
  }

  const o = await editableOrder(user, orderId);
  if (!o) return denied();
  let created = null;
  for (let i = 0; i < 5 && !created; i++) {
    const no = await nextShipmentNo(user.tenantId, tz);
    created = await prisma.shipment
      .create({
        data: {
          ...data,
          tenantId: user.tenantId,
          orderId: o.id,
          customerId: o.customerId,
          no,
          createdById: user.id,
          events: { create: { status: "BOOKING", at: new Date(), note: "新建发货批次", userId: user.id } },
        },
      })
      .catch((e: { code?: string }) => {
        if (e?.code === "P2002") return null;
        throw e;
      });
  }
  if (!created) return { ok: false, message: "批次号冲突，请再试一次" };
  await syncEtaTask(user, created, o);
  await logActivity({ tenantId: user.tenantId, customerId: o.customerId, opportunityId: o.opportunityId, event: "order", content: `订单 ${o.no} 新建发货批次 ${created.no}`, userId: user.id });
  await audit(user, { action: "create", entity: "shipment", entityId: created.id, entityName: created.no, summary: `给订单 ${o.no} 新建了发货批次 ${created.no}` });
  revalidate(o.id, o.customerId);
  return { ok: true, message: `发货批次 ${created.no} 已创建` };
}

/** 有 ETA 且还没到港：给负责人建（或更新）一条到港提醒；到港 / 签收 / 取消后关掉 */
async function syncEtaTask(
  user: CurrentUser,
  s: { id: string; no: string; status: string; eta: Date | null; portDischarge: string | null },
  o: { id: string; no: string; customerId: string; ownerId: string | null },
) {
  const link = `/orders/${o.id}#shipment-${s.id}`;
  const db = tenantDb(user.tenantId);
  const open = await db.task.findFirst({ where: { kind: "arrival", link, done: false } });
  const live = s.eta && !["ARRIVED", "DELIVERED", "CANCELLED"].includes(s.status);
  if (!live) {
    if (open) await db.task.updateMany({ where: { id: open.id }, data: { done: true, doneAt: new Date() } });
    return;
  }
  const title = `订单 ${o.no} 批次 ${s.no} 预计到港${s.portDischarge ? `（${s.portDischarge}）` : ""}`;
  if (open) await db.task.updateMany({ where: { id: open.id }, data: { title, dueAt: s.eta! } });
  else
    await db.task.create({
      data: {
        tenantId: user.tenantId,
        title,
        dueAt: s.eta!,
        kind: "arrival",
        note: "到港后跟客户确认清关、提货，并提醒付尾款",
        link,
        customerId: o.customerId,
        ownerId: o.ownerId ?? user.id,
        createdById: user.id,
      },
    });
}

const statusValues = SHIPMENT_STATUSES.map((s) => s.value) as [ShipmentStatusValue, ...ShipmentStatusValue[]];

/** 改状态（记一条节点）：开船时订单自动变「已发货」；签收时记签收时间 */
export async function setShipmentStatusAction(id: string, status: string, at: string, note: string): Promise<ActionState> {
  const user = await requireUser();
  const found = await editableShipment(user, id);
  if (!found) return denied();
  const st = z.enum(statusValues).safeParse(status);
  if (!st.success) return denied("状态不正确");
  const when = (at && parseLocalInput(at, user.timezone)) || new Date();
  const { s, o } = found;
  const patch: Record<string, unknown> = { status: st.data };
  if (st.data === "DEPARTED" && !s.atd) patch.atd = when;
  if (st.data === "ARRIVED" && !s.ata) patch.ata = when;
  if (st.data === "DELIVERED" && !s.deliveredAt) patch.deliveredAt = when;
  await prisma.$transaction([
    prisma.shipment.updateMany({ where: { tenantId: user.tenantId, id }, data: patch }),
    prisma.shipmentEvent.create({ data: { shipmentId: id, status: st.data, at: when, note: note.trim().slice(0, 500) || null, userId: user.id } }),
  ]);
  const label = shipmentStatus(st.data, s.mode).label;
  let extra = "";
  if (st.data === "DEPARTED" && (o.status === "CONFIRMED" || o.status === "PRODUCING") && o.approval !== "PENDING" && o.approval !== "REJECTED") {
    await prisma.order.updateMany({ where: { tenantId: user.tenantId, id: o.id }, data: { status: "SHIPPED" } });
    extra = "，订单已改为「已发货」";
  }
  await syncEtaTask(user, { ...s, status: st.data }, o);
  await logActivity({
    tenantId: user.tenantId,
    customerId: o.customerId,
    opportunityId: o.opportunityId,
    event: "order",
    content: `订单 ${o.no} 批次 ${s.no}：${label}${note.trim() ? `（${note.trim().slice(0, 100)}）` : ""}${extra}`,
    userId: user.id,
  });
  await audit(user, { action: "status", entity: "shipment", entityId: id, entityName: s.no, summary: `订单 ${o.no} 批次 ${s.no} 状态：${shipmentStatus(s.status, s.mode).label} → ${label}` });
  revalidate(o.id, o.customerId);
  revalidatePath("/orders");
  return { ok: true, message: `已更新为「${label}」${extra}` };
}

/** 只记一条进展（不改状态），比如「船延误两天」 */
export async function addShipmentNoteAction(id: string, note: string, at: string): Promise<ActionState> {
  const user = await requireUser();
  const found = await editableShipment(user, id);
  if (!found) return denied();
  const text = note.trim().slice(0, 500);
  if (!text) return denied("请填写进展");
  const when = (at && parseLocalInput(at, user.timezone)) || new Date();
  await prisma.shipmentEvent.create({ data: { shipmentId: id, at: when, note: text, userId: user.id } });
  revalidate(found.o.id, found.o.customerId);
  return { ok: true, message: "已记录" };
}

export async function deleteShipmentAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const found = await editableShipment(user, id);
  if (!found) return denied();
  const { s, o } = found;
  await tenantDb(user.tenantId).shipment.deleteMany({ where: { id } });
  await tenantDb(user.tenantId).task.updateMany({ where: { kind: "arrival", link: `/orders/${o.id}#shipment-${id}`, done: false }, data: { done: true, doneAt: new Date() } });
  await audit(user, { action: "delete", entity: "shipment", entityId: id, entityName: s.no, summary: `删除了订单 ${o.no} 的发货批次 ${s.no}` });
  revalidate(o.id, o.customerId);
  return { ok: true, message: `批次 ${s.no} 已删除` };
}
