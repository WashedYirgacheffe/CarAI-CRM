"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantDb } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import { isUniqueError } from "@/server/documents";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { CURRENCIES } from "@/lib/crm";

const DENIED: ActionState = { ok: false, message: "没有操作权限" };

async function guard() {
  const user = await requireUser();
  return can(user, "product.manage") ? user : null;
}

const opt = (max = 500) => z.string().trim().max(max).optional().transform((v) => v || null);
const optNum = (max: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= max), "请输入有效的数字");
const optInt = (max: number) => optNum(max).refine((v) => v === null || Number.isInteger(v), "请输入整数");

const productSchema = z.object({
  id: z.string().optional(),
  sku: z.string().trim().min(1, "请填写产品编号").max(64),
  name: z.string().trim().min(1, "请填写产品名称").max(200),
  nameEn: opt(200),
  categoryId: z.string().optional().transform((v) => v || null),
  model: opt(100),
  spec: opt(2000),
  unit: z.string().trim().min(1, "请填写单位").max(20),
  price: z.coerce.number({ message: "价格格式不正确" }).min(0, "价格不能为负").max(1e9),
  currency: z.enum(CURRENCIES),
  costPrice: optNum(1e9),
  moq: optInt(1e9),
  hsCode: opt(20),
  cartonQty: optInt(1e7),
  cartonSize: opt(50),
  grossWeight: optNum(1e6),
  netWeight: optNum(1e6),
  imageUrl: opt(500).refine((v) => !v || v.startsWith("/api/files/") || /^https?:\/\//.test(v), "图片地址不正确"),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  remark: opt(2000),
});

export async function saveProductAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const parsed = productSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, ...data } = parsed.data;
  const db = tenantDb(user.tenantId);
  if (data.categoryId && !(await db.productCategory.count({ where: { id: data.categoryId } }))) {
    return { ok: false, fieldErrors: { categoryId: ["分类不存在"] } };
  }
  // 编号不区分大小写：LED-A60 和 led-a60 视为同一个
  const clash = await db.product.findFirst({
    where: { sku: { equals: data.sku, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) },
    select: { sku: true },
  });
  if (clash) return { ok: false, fieldErrors: { sku: [`产品编号已存在（${clash.sku}）`] } };
  try {
    if (id) {
      const r = await db.product.updateMany({ where: { id }, data });
      if (!r.count) return { ok: false, message: "产品不存在" };
    } else {
      await db.product.create({ data: { ...data, tenantId: user.tenantId, createdById: user.id } });
    }
  } catch (e) {
    if (isUniqueError(e)) return { ok: false, fieldErrors: { sku: ["这个产品编号已经存在"] } };
    throw e;
  }
  revalidatePath("/products");
  return { ok: true, message: id ? "产品已保存" : "产品已添加" };
}

export async function setProductStatusAction(id: string, status: "ACTIVE" | "INACTIVE"): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  await tenantDb(user.tenantId).product.updateMany({ where: { id }, data: { status } });
  revalidatePath("/products");
  return { ok: true, message: status === "ACTIVE" ? "已恢复在售" : "已停售，新单据里不再出现" };
}

export async function deleteProductAction(id: string): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  // 已开出的报价单 / 订单明细是快照，删除产品不影响它们
  await tenantDb(user.tenantId).product.deleteMany({ where: { id } });
  revalidatePath("/products");
  return { ok: true, message: "产品已删除" };
}

// ── 分类 ──

const categorySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请填写分类名称").max(30),
});

export async function saveCategoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const parsed = categorySchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const { id, name } = parsed.data;
  const db = tenantDb(user.tenantId);
  try {
    if (id) await db.productCategory.updateMany({ where: { id }, data: { name } });
    else {
      const max = await db.productCategory.aggregate({ _max: { sort: true } });
      await db.productCategory.create({ data: { name, tenantId: user.tenantId, sort: (max._max.sort ?? -1) + 1 } });
    }
  } catch (e) {
    if (isUniqueError(e)) return { ok: false, fieldErrors: { name: ["已有同名分类"] } };
    throw e;
  }
  revalidatePath("/products");
  return { ok: true, message: "分类已保存" };
}

export async function deleteCategoryAction(id: string): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const db = tenantDb(user.tenantId);
  const used = await db.product.count({ where: { categoryId: id } });
  await db.productCategory.deleteMany({ where: { id } });
  revalidatePath("/products");
  return { ok: true, message: used ? `已删除，${used} 个产品变为未分类` : "分类已删除" };
}
