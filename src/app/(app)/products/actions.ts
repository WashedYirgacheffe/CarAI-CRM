"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantDb } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import { getSeller, isUniqueError } from "@/server/documents";
import { AiError, aiConfigured, aiJson, clip } from "@/server/ai";
import { productStats } from "@/server/product-stats";
import { clickLabel, sectionLabel } from "@/lib/share-visit";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { CURRENCIES } from "@/lib/crm";

const DENIED: ActionState = { ok: false, message: "没有操作权限" };

async function guard() {
  const user = await requireUser();
  return can(user, "product.manage") ? user : null;
}

const opt = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
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
  categoryId: z
    .string()
    .optional()
    .transform((v) => v || null),
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
  images: z
    .string()
    .optional()
    .transform((v, ctx) => {
      try {
        const list = v ? (JSON.parse(v) as unknown) : [];
        if (Array.isArray(list) && list.length <= 8 && list.every((u) => typeof u === "string" && u.startsWith("/api/files/") && u.length <= 500))
          return list as string[];
      } catch {}
      ctx.addIssue({ code: "custom", message: "图片地址不正确" });
      return z.NEVER;
    }),
  videoUrl: opt(500).refine((v) => !v || v.startsWith("/api/files/"), "视频地址不正确"),
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
  revalidatePath("/products", "layout");
  return { ok: true, message: id ? "产品已保存" : "产品已添加" };
}

export async function setProductStatusAction(id: string, status: "ACTIVE" | "INACTIVE"): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  await tenantDb(user.tenantId).product.updateMany({ where: { id }, data: { status } });
  revalidatePath("/products", "layout");
  return { ok: true, message: status === "ACTIVE" ? "已恢复在售" : "已停售，新单据里不再出现" };
}

export async function deleteProductAction(id: string): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  // 已开出的报价单 / 订单明细是快照，删除产品不影响它们
  await tenantDb(user.tenantId).product.deleteMany({ where: { id } });
  revalidatePath("/products", "layout");
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
  revalidatePath("/products", "layout");
  return { ok: true, message: "分类已保存" };
}

export async function deleteCategoryAction(id: string): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const db = tenantDb(user.tenantId);
  const used = await db.product.count({ where: { categoryId: id } });
  await db.productCategory.deleteMany({ where: { id } });
  revalidatePath("/products", "layout");
  return { ok: true, message: used ? `已删除，${used} 个产品变为未分类` : "分类已删除" };
}

// ── 产品卡 Listing（客户打开产品卡看到的标题、卖点、介绍） ──

const listingSchema = z.object({
  listingTitle: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v || null),
  bullets: z
    .array(z.string().trim().max(300))
    .max(8)
    .transform((list) => list.filter(Boolean)),
  listingDesc: z
    .string()
    .trim()
    .max(8000)
    .transform((v) => v || null),
  keywords: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || null),
});
export type ListingInput = z.input<typeof listingSchema>;

export async function saveListingAction(id: string, input: ListingInput): Promise<ActionState> {
  const user = await guard();
  if (!user) return DENIED;
  const parsed = listingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "内容不正确" };
  const r = await tenantDb(user.tenantId).product.updateMany({ where: { id }, data: { ...parsed.data, listingUpdatedAt: new Date() } });
  if (!r.count) return { ok: false, message: "产品不存在" };
  revalidatePath("/products", "layout");
  return { ok: true, message: "产品卡已保存" };
}

export type ListingDraft = { listingTitle: string; bullets: string[]; listingDesc: string; keywords: string; notes: string[] };

/** AI 优化 Listing：只给建议，用户确认后才保存 */
export async function optimizeListingAction(id: string, focus?: string): Promise<ActionState & { draft?: ListingDraft }> {
  const user = await requireUser();
  if (!can(user, "product.manage") || !can(user, "ai.use")) return DENIED;
  if (!aiConfigured()) return { ok: false, message: "还没有配置 AI" };
  const p = await tenantDb(user.tenantId).product.findFirst({ where: { id }, include: { category: { select: { name: true } } } });
  if (!p) return { ok: false, message: "产品不存在" };
  const stats = await productStats(user.tenantId, id);
  const seller = await getSeller(user.tenantId);

  const facts = [
    `中文品名：${p.name}`,
    p.nameEn && `英文品名：${p.nameEn}`,
    p.category && `分类：${p.category.name}`,
    p.model && `型号：${p.model}`,
    p.spec && `规格：${p.spec}`,
    p.moq && `MOQ：${p.moq} ${p.unit}`,
    p.cartonQty && `包装：每箱 ${p.cartonQty} ${p.unit}${p.cartonSize ? `，外箱 ${p.cartonSize}` : ""}`,
    p.hsCode && `HS：${p.hsCode}`,
    p.remark && `内部备注（可能含卖点，不要照抄内部信息、价格成本）：${clip(p.remark, 800)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const current = [
    p.listingTitle && `标题：${p.listingTitle}`,
    p.bullets.length && `卖点：\n${p.bullets.map((b) => `- ${b}`).join("\n")}`,
    p.listingDesc && `介绍：${clip(p.listingDesc, 3000)}`,
    p.keywords && `关键词：${p.keywords}`,
  ]
    .filter(Boolean)
    .join("\n");
  const behavior = stats.visits
    ? [
        `共被打开 ${stats.visits} 次（${stats.customers} 个客户），平均停留 ${Math.round(stats.avgMs / 1000)} 秒`,
        stats.sections.length &&
          `各部分累计停留：${stats.sections.map((s) => `${sectionLabel(s.name)} ${Math.round(s.ms / 1000)} 秒（${s.reach} 次看到）`).join("，")}`,
        stats.clicks.length && `点击：${stats.clicks.map((c) => `${clickLabel(c.name)} ${c.count} 次`).join("，")}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "还没有客户打开过";

  try {
    const draft = await aiJson<ListingDraft>({
      system:
        "你是外贸 B2B 独立站的产品文案专家，给海外批发商 / 进口商写英文产品页。要求：只写资料里有依据的内容，不编造认证、材质、数据；语气专业克制，不用夸张词（best、No.1、perfect）；面向采购决策：用途、规格、品质、包装、起订量、定制能力。只输出 JSON。",
      messages: [
        {
          role: "user",
          content: `公司：${seller.name}\n\n产品资料：\n${facts}\n\n现在的产品卡：\n${current || "（还没写）"}\n\n客户查看数据：\n${behavior}\n${focus ? `\n这次的要求：${clip(focus, 300)}\n` : ""}
请输出 JSON：
{"listingTitle":"英文标题，60~110 字符，核心词在前，含型号/关键规格","bullets":["3~6 条英文卖点，每条以 2~4 个词的短语开头加冒号，后面一句说明，不超过 160 字符"],"listingDesc":"英文详细介绍，2~4 段，段落用空行分隔，150~350 词","keywords":"8~15 个英文搜索词，逗号分隔","notes":["2~4 条中文说明：改了什么、为什么；如果有查看数据，说说数据说明了什么、还缺什么资料（如认证、实拍图）"]}`,
        },
      ],
      maxTokens: 2500,
      temperature: 0.4,
      timeoutMs: 90_000,
    });
    return {
      ok: true,
      draft: {
        listingTitle: String(draft.listingTitle ?? "").slice(0, 200),
        bullets: (Array.isArray(draft.bullets) ? draft.bullets : []).map((b) => String(b).slice(0, 300)).slice(0, 8),
        listingDesc: String(draft.listingDesc ?? "").slice(0, 8000),
        keywords: String(draft.keywords ?? "").slice(0, 500),
        notes: (Array.isArray(draft.notes) ? draft.notes : []).map(String).slice(0, 5),
      },
    };
  } catch (e) {
    return { ok: false, message: e instanceof AiError ? e.message : "AI 暂时不可用，请稍后再试" };
  }
}
