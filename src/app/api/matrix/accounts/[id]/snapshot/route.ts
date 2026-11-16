import { can, getCurrentUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { serveObject } from "@/server/storage";

/** 账号封面截图：能在社媒矩阵里看到这个账号的人才能看（管理员看全部，其他人只看自己负责的） */
export async function GET(_req: Request, ctx: RouteContext<"/api/matrix/accounts/[id]/snapshot">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const manage = can(user, "matrix.manage");
  if (!manage && !can(user, "matrix.use")) return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const acc = await prisma.matrixAccount.findFirst({
    where: { id, tenantId: user.tenantId, ...(manage ? {} : { ownerId: user.id }) },
    select: { snapshotKey: true },
  });
  if (!acc?.snapshotKey) return new Response("Not found", { status: 404 });
  // 地址带 ?v=截图时间，内容换了地址就换了，可以长期缓存
  return serveObject(acc.snapshotKey, { contentType: "image/jpeg", cache: "private, max-age=86400" });
}
