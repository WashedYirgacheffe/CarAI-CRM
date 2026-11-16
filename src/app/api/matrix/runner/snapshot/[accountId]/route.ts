import { prisma } from "@/server/db";
import { runnerAuth } from "@/server/matrix";
import { putObject } from "@/server/storage";

const MAX = 1.5 * 1024 * 1024;

/** 运行器上传账号页面的截图（JPEG），作为社媒矩阵列表里的封面。每个账号只留最新一张 */
export async function PUT(req: Request, ctx: RouteContext<"/api/matrix/runner/snapshot/[accountId]">) {
  const auth = await runnerAuth(req);
  if (!auth) return Response.json({ error: "令牌无效" }, { status: 401 });
  const { accountId } = await ctx.params;
  // 桌面版只能传归属自己的账号；云端 / 命令行运行器只能传没有归属电脑的
  const acc = await prisma.matrixAccount.findFirst({
    where: { id: accountId, tenantId: auth.tenantId, deviceId: auth.device ? auth.device.id : null },
    select: { id: true },
  });
  if (!acc) return Response.json({ error: "账号不存在" }, { status: 404 });
  const body = Buffer.from(await req.arrayBuffer());
  if (!body.length || body.length > MAX) return Response.json({ error: "图片大小不对" }, { status: 413 });
  // JPEG 文件头
  if (body[0] !== 0xff || body[1] !== 0xd8) return Response.json({ error: "只收 JPEG" }, { status: 415 });
  const key = `matrix-snap/${auth.tenantId}/${acc.id}.jpg`;
  await putObject(key, body, { contentType: "image/jpeg" });
  await prisma.matrixAccount.update({ where: { id: acc.id }, data: { snapshotKey: key, snapshotAt: new Date() } });
  return Response.json({ ok: true });
}
