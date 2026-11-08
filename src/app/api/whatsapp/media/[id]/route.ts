import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getCustomerForUser } from "@/server/customers";
import { serveObject } from "@/server/storage";

/** WhatsApp 图片 / 视频 / 语音 / 文件：账号本人，或能查看所关联客户的同事 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/whatsapp/media/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const m = await tenantDb(user.tenantId).waMessage.findFirst({
    where: { id },
    select: { mediaKey: true, mediaMime: true, mediaName: true, account: { select: { userId: true } }, chat: { select: { customerId: true } } },
  });
  if (!m?.mediaKey) return new Response("Not found", { status: 404 });
  const allowed = m.account.userId === user.id || (m.chat.customerId && (await getCustomerForUser(user, m.chat.customerId)));
  if (!allowed) return new Response("Forbidden", { status: 403 });
  const download = req.nextUrl.searchParams.has("download");
  return serveObject(m.mediaKey, {
    contentType: m.mediaMime ?? "application/octet-stream",
    filename: m.mediaName ?? undefined,
    download,
  });
}
