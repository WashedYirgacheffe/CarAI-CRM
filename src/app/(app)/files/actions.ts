"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { deleteFile, ensureFileText, saveAttachment, updateFile } from "@/server/files";
import { tenantDb } from "@/server/db";
import { getCustomerForUser } from "@/server/customers";
import { guessCategory } from "@/lib/files";

const refresh = (customerId?: string | null) => {
  if (customerId) revalidatePath(`/customers/${customerId}`);
};

export async function updateFileAction(
  id: string,
  patch: {
    name?: string;
    category?: string;
    note?: string;
    customerId?: string;
  },
) {
  const user = await requireUser();
  const r = await updateFile(user, id, patch);
  if (r.ok) refresh(r.customerId);
  return { ok: r.ok, message: r.message };
}

export async function deleteFileAction(id: string) {
  const user = await requireUser();
  const r = await deleteFile(user, id);
  if (r.ok) refresh(r.customerId);
  return { ok: r.ok, message: r.message };
}

/** WhatsApp 文件 / 邮件附件存进客户资料 */
export async function saveAttachmentAction(p: {
  customerId?: string;
  waMessageId?: string;
  mailId?: string;
  attId?: string;
  category?: string;
}) {
  const user = await requireUser();
  const r = await saveAttachment(user, p);
  if (r.ok) refresh(r.customerId);
  return { ok: r.ok, message: r.message };
}

/** 「其他」分类的文件重新识别一遍（新增了单据类型、或以前没读出文字的 Excel / Word） */
export async function reclassifyFilesAction(customerId: string) {
  const user = await requireUser();
  const c = await getCustomerForUser(user, customerId);
  if (!c?.access.edit) return { ok: false, message: "没有编辑这个客户的权限" };
  const db = tenantDb(user.tenantId);
  const files = await db.crmFile.findMany({
    where: { customerId: c.customer.id, category: "OTHER" },
    select: { id: true, key: true, name: true, mime: true, text: true, textState: true, category: true },
    take: 200,
  });
  let n = 0;
  for (const f of files) {
    const g = await ensureFileText(f).catch(() => f);
    const category = g.category !== "OTHER" ? g.category : guessCategory(g.name, g.mime, g.text);
    if (category === "OTHER") continue;
    if (g.category === "OTHER") await db.crmFile.update({ where: { id: f.id }, data: { category } });
    n++;
  }
  refresh(c.customer.id);
  return { ok: true, message: n ? `重新识别了 ${n} 个文件的分类` : "没有能识别出分类的文件" };
}
