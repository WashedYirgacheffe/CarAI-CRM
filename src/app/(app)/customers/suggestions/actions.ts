"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import { syncCustomerTimes } from "@/server/pool";
import { extractDomain } from "@/lib/crm";
import type { ActionState } from "@/lib/action";
import { createCustomerAction } from "../actions";

type Input = { kind: "mail" | "wa"; ref: string; company: string; contactName: string; country: string };

/** 按建档建议新建客户（负责人是自己），并把相关邮件 / WhatsApp 会话归到新客户 */
export async function createFromSuggestionAction(input: Input): Promise<ActionState & { id?: string }> {
  const user = await requireUser();
  if (!can(user, "customer.create")) return { ok: false, message: "没有新建客户的权限" };
  const t = user.tenantId;

  const fd = new FormData();
  fd.set("name", input.company);
  fd.set("country", input.country);
  fd.set("contactName", input.contactName);
  let chat: { id: string; phone: string | null } | null = null;
  if (input.kind === "mail") {
    const addr = input.ref.trim().toLowerCase();
    fd.set("contactEmail", addr);
    fd.set("source", "邮件往来");
    const domain = extractDomain(addr);
    if (domain) fd.set("website", domain);
  } else {
    chat = await prisma.waChat.findFirst({ where: { tenantId: t, id: input.ref, account: { userId: user.id } }, select: { id: true, phone: true } });
    if (!chat?.phone) return { ok: false, message: "会话不存在或没有手机号" };
    fd.set("contactWhatsapp", `+${chat.phone}`);
    fd.set("source", "WhatsApp");
  }

  const r = await createCustomerAction({}, fd);
  if (!r.ok || !r.id) return r;
  const contact = await prisma.contact.findFirst({ where: { tenantId: t, customerId: r.id }, select: { id: true } });

  if (input.kind === "mail") {
    const addr = input.ref.trim().toLowerCase();
    await prisma.mailMessage.updateMany({
      where: { tenantId: t, customerId: null, OR: [{ fromAddr: { equals: addr, mode: "insensitive" } }, { toList: { array_contains: [{ address: addr }] } }] },
      data: { customerId: r.id, contactId: contact?.id ?? null },
    });
  } else if (chat) {
    await prisma.waChat.updateMany({ where: { tenantId: t, customerId: null, phone: chat.phone }, data: { customerId: r.id, contactId: contact?.id ?? null } });
  }
  await syncCustomerTimes(t, r.id);
  revalidatePath("/customers/suggestions");
  return { ok: true, message: `已建档「${input.company}」`, id: r.id };
}

/** 忽略建议：以后不再提示（全公司生效） */
export async function ignoreSuggestionAction(key: string): Promise<ActionState> {
  const user = await requireUser();
  if (!/^(mail|wa):.{3,200}$/.test(key)) return { ok: false, message: "参数错误" };
  await prisma.suggestionIgnore.upsert({
    where: { tenantId_key: { tenantId: user.tenantId, key } },
    create: { tenantId: user.tenantId, key, userId: user.id },
    update: {},
  });
  revalidatePath("/customers/suggestions");
  return { ok: true, message: "已忽略，以后不再提示" };
}
