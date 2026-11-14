import { getCurrentUser } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { getCustomerForUser } from "@/server/customers";
import { serveObject } from "@/server/storage";

/**
 * WhatsApp 头像：id 为会话 id，或 me（自己的头像）。权限同聊天媒体：账号本人，或能查看所关联客户的同事。
 * 页面上的地址带 ?v=换头像的时间，同一个 v 内容不变，浏览器长期缓存；不带 v 的只缓存 5 分钟。
 */
export async function GET(req: Request, ctx: RouteContext<"/api/whatsapp/avatar/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const cache = new URL(req.url).searchParams.has("v") ? undefined : "private, max-age=300";
  if (id === "me") {
    const a = await prisma.waAccount.findUnique({ where: { userId: user.id }, select: { avatarKey: true } });
    if (!a?.avatarKey) return new Response("Not found", { status: 404 });
    return serveObject(a.avatarKey, { contentType: "image/jpeg", cache });
  }
  const c = await tenantDb(user.tenantId).waChat.findFirst({
    where: { id },
    select: { avatarKey: true, customerId: true, account: { select: { userId: true } } },
  });
  if (!c?.avatarKey) return new Response("Not found", { status: 404 });
  const allowed = c.account.userId === user.id || (c.customerId && (await getCustomerForUser(user, c.customerId)));
  if (!allowed) return new Response("Forbidden", { status: 403 });
  return serveObject(c.avatarKey, { contentType: "image/jpeg", cache });
}
