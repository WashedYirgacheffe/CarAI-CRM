import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getCustomerForUser } from "@/server/customers";
import { asAttachments, serveAttachment } from "@/server/mail/store";

/** 下载邮件附件：邮箱本人，或能查看所归档客户的同事 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/mail/attachments/[id]/[attId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id, attId } = await ctx.params;
  const m = await tenantDb(user.tenantId).mailMessage.findFirst({ where: { id }, include: { account: { select: { userId: true } } } });
  if (!m) return new Response("Not found", { status: 404 });
  const allowed = m.account.userId === user.id || (m.customerId && (await getCustomerForUser(user, m.customerId)));
  if (!allowed) return new Response("Forbidden", { status: 403 });
  const att = asAttachments(m.attachments).find((a) => a.id === attId);
  if (!att) return new Response("Not found", { status: 404 });
  return serveAttachment(user.tenantId, att);
}
