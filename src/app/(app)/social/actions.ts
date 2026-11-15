"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import { ownedWhere } from "@/server/scope";
import { checkSlug } from "@/server/bio";
import type { ActionState } from "@/lib/action";
import { normalizeSocialUrl, parseBioLinks, platformInfo, BIO_THEMES } from "@/lib/social";

/** 社媒动态：标为已读（不传 id = 数据范围内全部） */
export async function markSocialReadAction(ids?: string[]): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "customer.view")) return { ok: false, message: "没有权限" };
  await tenantDb(user.tenantId).socialPost.updateMany({
    where: { readAt: null, customer: await ownedWhere(user), ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  revalidatePath("/social", "layout");
  return { ok: true, message: "已标为已读" };
}

/** 几星及以上的客户自动跟踪社媒（0 = 关闭） */
export async function setWatchStarAction(star: number): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "settings.business")) return { ok: false, message: "需要「业务规则」设置权限" };
  const v = Math.max(0, Math.min(5, Math.round(star)));
  await prisma.tenant.update({ where: { id: user.tenantId }, data: { socialWatchStar: v } });
  revalidatePath("/social", "layout");
  return { ok: true, message: v ? `${v} 星及以上的客户会自动跟踪社媒` : "已关闭社媒跟踪" };
}

const BioSchema = z.object({
  id: z.string().min(1),
  slug: z.string().trim().toLowerCase(),
  title: z.string().trim().min(1, "填一下标题").max(60),
  bio: z.string().trim().max(300).optional(),
  avatar: z.string().trim().max(500).optional(),
  theme: z.string().refine((t) => t in BIO_THEMES),
  published: z.string().optional(),
  links: z.string().max(40_000),
});

/** 保存聚合主页：自己的随便改；部门主页要「部门与成员」权限 */
export async function saveBioAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = BioSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "填写有误" };
  const d = parsed.data;
  const page = await tenantDb(user.tenantId).bioPage.findFirst({ where: { id: d.id } });
  if (!page) return { ok: false, message: "主页不存在" };
  if (page.userId ? page.userId !== user.id : !can(user, "settings.org")) return { ok: false, message: "没有编辑这个主页的权限" };

  const slugError = checkSlug(d.slug);
  if (slugError) return { ok: false, fieldErrors: { slug: [slugError] } };
  if (d.slug !== page.slug && (await prisma.bioPage.findUnique({ where: { slug: d.slug }, select: { id: true } })))
    return { ok: false, fieldErrors: { slug: ["这个地址已经被人用了"] } };

  let raw: unknown;
  try {
    raw = JSON.parse(d.links);
  } catch {
    return { ok: false, message: "链接数据格式不对" };
  }
  const links = [];
  for (const l of parseBioLinks(raw).slice(0, 30)) {
    let url = l.url.trim();
    if (url && !/^(mailto:|tel:)/i.test(url)) url = normalizeSocialUrl(url) ?? "";
    if (l.kind === "link" && !url) return { ok: false, message: `「${l.label || platformInfo(l.platform).label}」的链接格式不对` };
    if (l.kind === "qr" && !url && !l.image) return { ok: false, message: `二维码「${l.label || "未命名"}」要上传图片或填链接` };
    const image = l.image && /^\/api\/files\/[a-z0-9]+\/[a-z0-9]+\.(jpg|png|webp|gif)$/.test(l.image) ? l.image : null;
    links.push({ ...l, url, label: l.label.trim().slice(0, 40), image });
  }
  const avatar = d.avatar && /^\/api\/files\/[a-z0-9]+\/[a-z0-9]+\.(jpg|png|webp|gif)$/.test(d.avatar) ? d.avatar : null;

  await tenantDb(user.tenantId).bioPage.updateMany({
    where: { id: page.id },
    data: { slug: d.slug, title: d.title, bio: d.bio || null, avatar, theme: d.theme, published: d.published === "on", links },
  });
  revalidatePath("/social/bio");
  revalidatePath(`/b/${page.slug}`);
  return { ok: true, message: "主页已保存" };
}
