import { prisma } from "@/server/db";
import { runnerTenant } from "@/server/matrix";
import { getFile } from "@/server/matrix-live";

/** 运行器下载网页上传的文件（只能取自己在跑的任务的） */
export async function GET(req: Request, ctx: RouteContext<"/api/matrix/runner/jobs/[id]/files/[fid]">) {
  const tenantId = await runnerTenant(req);
  if (!tenantId) return Response.json({ error: "令牌无效" }, { status: 401 });
  const { id, fid } = await ctx.params;
  const runnerId = req.headers.get("x-runner-id") ?? "";
  const job = await prisma.matrixJob.findFirst({ where: { id, tenantId, runner: runnerId }, select: { id: true } });
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 });
  const f = getFile(id, fid);
  if (!f) return Response.json({ error: "文件不存在" }, { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: { "content-type": f.type, "content-length": String(f.data.length), "cache-control": "no-store" },
  });
}
