"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantDb } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { checkSocial, saveCustomerSocial } from "@/server/social";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import type { ResearchReport } from "@/lib/ai-research";
import { detectPlatform, handleOf, normalizeSocialUrl, platformInfo } from "@/lib/social";

function touch(customerId: string) {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/social", "layout");
}

async function editable(customerId: string) {
  const user = await requireUser();
  const found = await getCustomerForUser(user, customerId);
  return found?.access.edit ? user : null;
}

const SocialSchema = z.object({
  customerId: z.string().min(1),
  id: z.string().optional(),
  url: z.string().trim().min(4, "填一下主页链接").max(500),
  platform: z.string().optional(),
  handle: z.string().trim().max(100).optional(),
});

/** 客户详情：添加 / 修改一个社媒账号 */
export async function saveSocialAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = SocialSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const d = parsed.data;
  const user = await editable(d.customerId);
  if (!user) return { ok: false, message: "没有编辑这个客户的权限" };
  if (d.id) {
    // 改链接：原地更新，保留已经跟踪到的动态
    const url = normalizeSocialUrl(d.url);
    if (!url) return { ok: false, fieldErrors: { url: ["链接格式不对"] } };
    const platform = d.platform && d.platform !== "auto" ? platformInfo(d.platform).key : detectPlatform(url);
    const dup = await tenantDb(user.tenantId).customerSocial.findFirst({ where: { customerId: d.customerId, url, id: { not: d.id } }, select: { id: true } });
    if (dup) return { ok: false, fieldErrors: { url: ["这个账号已经有了"] } };
    await tenantDb(user.tenantId).customerSocial.updateMany({
      where: { id: d.id, customerId: d.customerId },
      data: { url, platform, handle: d.handle || handleOf(url), feedUrl: null, fingerprint: null, lastError: null },
    });
    touch(d.customerId);
    return { ok: true, message: "已保存" };
  }
  const r = await saveCustomerSocial(user.tenantId, user.id, d.customerId, { url: d.url, platform: d.platform, handle: d.handle });
  if ("error" in r) return { ok: false, fieldErrors: { url: [r.error ?? "链接格式不对"] } };
  touch(d.customerId);
  return { ok: true, message: r.existed ? "这个账号已经有了" : "已添加社媒账号" };
}

export async function deleteSocialAction(customerId: string, id: string): Promise<ActionState> {
  const user = await editable(customerId);
  if (!user) return { ok: false, message: "没有编辑这个客户的权限" };
  await tenantDb(user.tenantId).customerSocial.deleteMany({ where: { id, customerId } });
  touch(customerId);
  return { ok: true, message: "已删除" };
}

/** 单个账号开 / 关跟踪 */
export async function toggleSocialWatchAction(customerId: string, id: string, watch: boolean): Promise<ActionState> {
  const user = await editable(customerId);
  if (!user) return { ok: false, message: "没有编辑这个客户的权限" };
  await tenantDb(user.tenantId).customerSocial.updateMany({ where: { id, customerId }, data: { watch } });
  touch(customerId);
  return { ok: true, message: watch ? "已开启跟踪" : "已停止跟踪" };
}

/** 马上查一次更新 */
export async function checkSocialNowAction(customerId: string, id: string): Promise<ActionState> {
  const user = await editable(customerId);
  if (!user) return { ok: false, message: "没有编辑这个客户的权限" };
  const row = await tenantDb(user.tenantId).customerSocial.findFirst({ where: { id, customerId }, select: { id: true } });
  if (!row) return { ok: false, message: "账号不存在" };
  const r = await checkSocial(row.id);
  touch(customerId);
  if (r.error) return { ok: false, message: r.error };
  return { ok: true, message: r.added ? `发现 ${r.added} 条更新` : "查过了，暂时没有新内容" };
}

/** 穿透报告里挖到的社媒：一键加到客户（url 为空 = 全部加上） */
export async function addResearchSocialsAction(researchId: string, url?: string): Promise<ActionState> {
  const user = await requireUser();
  const row = await tenantDb(user.tenantId).aiResearch.findFirst({ where: { id: researchId, status: "done" } });
  if (!row?.customerId || !row.report) return { ok: false, message: "报告不存在" };
  const found = await getCustomerForUser(user, row.customerId);
  if (!found?.access.edit) return { ok: false, message: "没有编辑这个客户的权限" };
  const list = ((row.report as ResearchReport).socials ?? []).filter((s) => !url || s.url === url);
  if (!list.length) return { ok: false, message: "没有可添加的账号" };
  let added = 0;
  for (const s of list) {
    const r = await saveCustomerSocial(user.tenantId, user.id, row.customerId, { url: s.url, platform: s.platform, handle: s.handle, source: "research" });
    if (!("error" in r) && !r.existed) added++;
  }
  touch(row.customerId);
  return { ok: true, message: added ? `已添加 ${added} 个社媒账号` : "这些账号都已经有了" };
}
