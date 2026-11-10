"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { logActivity } from "@/server/customers";
import { readShareToken } from "@/server/share";
import { SHARE_FORMS, type ShareFormKind } from "./forms";

export type SubmitState = { ok: boolean; message?: string };

/**
 * 客户提交表单（不用登录）。
 * 会话已关联客户：记到客户动态；没关联：询价表单新建一条线索。都会给会话负责人建一条提醒。
 */
export async function submitShareFormAction(kind: ShareFormKind, token: string, _prev: SubmitState, fd: FormData): Promise<SubmitState> {
  const form = SHARE_FORMS[kind];
  const chatId = form ? readShareToken(kind, token) : null;
  if (!form || !chatId) return { ok: false, message: "This link is invalid or has expired." };
  const chat = await prisma.waChat.findUnique({ where: { id: chatId }, include: { account: { select: { userId: true } } } });
  if (!chat) return { ok: false, message: "This link is invalid or has expired." };

  const values: Record<string, string> = {};
  for (const f of form.fields) {
    const v = String(fd.get(f.name) ?? "")
      .trim()
      .slice(0, f.type === "textarea" ? 3000 : 300);
    if (f.required && !v) return { ok: false, message: `Please fill in “${f.label}”.` };
    if (v) values[f.name] = v;
  }

  // 防刷：同一个链接 10 分钟内最多提交 3 次
  const link = `/whatsapp?chat=${chat.id}`;
  const recent = await prisma.task.count({
    where: { tenantId: chat.tenantId, link, kind: "form_submitted", createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
  });
  if (recent >= 3) return { ok: false, message: "Too many submissions, please try again later." };

  const who = chat.name || (chat.phone ? `+${chat.phone}` : "客户");
  const lines = form.fields.filter((f) => values[f.name]).map((f) => `${f.label}: ${values[f.name]}`);
  const content = `【${form.zh}】${who} 通过 WhatsApp 链接提交：\n${lines.join("\n")}`;

  let leadId: string | null = null;
  if (chat.customerId) {
    await logActivity({
      tenantId: chat.tenantId,
      customerId: chat.customerId,
      type: "FOLLOW_UP",
      method: "WHATSAPP",
      event: `form_${kind}`,
      content,
    });
  } else if (kind === "inquiry") {
    const lead = await prisma.lead.create({
      data: {
        tenantId: chat.tenantId,
        contactName: values.name,
        companyName: values.company ?? null,
        email: values.email ?? null,
        whatsapp: chat.phone ? `+${chat.phone}` : null,
        country: null,
        source: "WhatsApp 询价表单",
        products: values.products ?? null,
        inquiry: lines.join("\n"),
        ownerId: chat.account.userId,
        assignedAt: new Date(),
      },
    });
    leadId = lead.id;
  }

  await prisma.task.create({
    data: {
      tenantId: chat.tenantId,
      ownerId: chat.account.userId,
      customerId: chat.customerId,
      title: kind === "inquiry" ? `${who} 提交了询价表单，尽快报价` : `${who} 提交了收货信息，核对后安排单证`,
      note: content.slice(0, 2000),
      kind: "form_submitted",
      link: leadId ? `/leads?q=${encodeURIComponent(values.email ?? values.name ?? "")}` : link,
      dueAt: new Date(),
    },
  });
  revalidatePath("/whatsapp", "layout");
  return { ok: true, message: "Thank you! We have received your information and will get back to you soon." };
}
