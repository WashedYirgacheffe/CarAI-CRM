"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { syncCustomerTimes } from "@/server/pool";
import type { ActionState } from "@/lib/action";

const FILL_FIELDS = [
  "country",
  "website",
  "domain",
  "address",
  "source",
  "customerType",
  "mainProducts",
  "annualVolume",
  "statusId",
  "groupId",
  "nextFollowAt",
] as const;

/**
 * 把 otherIds 合并进 primaryId：联系人、跟进动态、商机、日程、线索、报价单、订单、邮件、WhatsApp 会话都转到主客户；
 * 主客户空着的资料用被合并客户补齐，标签取并集，星级取最高；被合并的客户删除。
 */
export async function mergeCustomersAction(primaryId: string, otherIds: string[]): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user, "customer.delete")) return { ok: false, message: "合并客户需要「删除客户」权限" };
  const ids = [...new Set(otherIds)].filter((id) => id !== primaryId);
  if (!ids.length) return { ok: false, message: "请至少选择一个要合并的客户" };

  const all = await Promise.all([primaryId, ...ids].map((id) => getCustomerForUser(user, id)));
  if (all.some((f) => !f || (!f.access.edit && !f.access.inPool))) return { ok: false, message: "只能合并你有权限编辑的客户" };
  const [primary, ...others] = all.map((f) => f!.customer);
  const t = user.tenantId;

  const fill: Record<string, unknown> = {};
  for (const k of FILL_FIELDS) {
    if (primary[k] == null) {
      const v = others.find((o) => o[k] != null)?.[k];
      if (v != null) fill[k] = v;
    }
  }
  const remark = [primary.remark, ...others.map((o) => o.remark)].filter(Boolean).join("\n");
  const tags = [...new Set([primary.tags, ...others.map((o) => o.tags)].flat())];
  const star = Math.max(primary.star, ...others.map((o) => o.star));
  const poolCount = primary.poolCount + others.reduce((n, o) => n + o.poolCount, 0);
  const where = { tenantId: t, customerId: { in: ids } };

  await prisma.$transaction(async (tx) => {
    await tx.contact.updateMany({ where, data: { customerId: primaryId, isPrimary: false } });
    await tx.opportunity.updateMany({ where, data: { customerId: primaryId } });
    await tx.activity.updateMany({ where, data: { customerId: primaryId } });
    await tx.task.updateMany({ where, data: { customerId: primaryId } });
    await tx.lead.updateMany({ where, data: { customerId: primaryId } });
    await tx.quotation.updateMany({ where, data: { customerId: primaryId } });
    await tx.order.updateMany({ where, data: { customerId: primaryId } });
    await tx.mailMessage.updateMany({ where, data: { customerId: primaryId } });
    await tx.waChat.updateMany({ where, data: { customerId: primaryId } });
    await tx.aiInsight.deleteMany({ where: { tenantId: t, targetId: { in: [primaryId, ...ids] } } });

    // 同一邮箱的联系人只留最早的一个，邮件和会话指向留下的那个
    const contacts = await tx.contact.findMany({ where: { tenantId: t, customerId: primaryId }, orderBy: { createdAt: "asc" } });
    const keep = new Map<string, (typeof contacts)[number]>();
    for (const c of contacts) {
      const key = c.email?.toLowerCase();
      if (!key) continue;
      const k = keep.get(key);
      if (!k) {
        keep.set(key, c);
        continue;
      }
      const kept = k.id;
      // 留下的联系人缺的电话、WhatsApp、职位、备注用重复的补上
      const patch = {
        phone: k.phone ?? c.phone,
        whatsapp: k.whatsapp ?? c.whatsapp,
        title: k.title ?? c.title,
        remark: [k.remark, c.remark].filter(Boolean).join("\n") || null,
      };
      Object.assign(k, patch);
      await tx.contact.updateMany({ where: { tenantId: t, id: kept }, data: patch });
      await tx.mailMessage.updateMany({ where: { tenantId: t, contactId: c.id }, data: { contactId: kept } });
      await tx.waChat.updateMany({ where: { tenantId: t, contactId: c.id }, data: { contactId: kept } });
      await tx.contact.deleteMany({ where: { tenantId: t, id: c.id } });
    }

    await tx.customer.deleteMany({ where: { tenantId: t, id: { in: ids } } });
    await tx.customer.updateMany({
      where: { tenantId: t, id: primaryId },
      data: { ...fill, remark: remark || null, tags, star, poolCount },
    });
    await tx.activity.create({
      data: {
        tenantId: t,
        customerId: primaryId,
        type: "SYSTEM",
        event: "merged",
        content: `合并了客户：${others.map((o) => o.name).join("、")}`,
        userId: user.id,
      },
    });
  });
  await syncCustomerTimes(t, primaryId);
  revalidatePath("/customers", "layout");
  revalidatePath(`/customers/${primaryId}`);
  return { ok: true, message: `已把 ${others.length} 个客户合并到「${primary.name}」` };
}
