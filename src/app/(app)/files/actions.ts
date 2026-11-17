"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { deleteFile, saveAttachment, updateFile } from "@/server/files";

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
