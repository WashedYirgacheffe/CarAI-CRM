import { prisma } from "@/server/db";
import { runnerCaller } from "@/server/matrix";
import { pushFrame } from "@/server/matrix-live";

const MAX_FRAME = 2 * 1024 * 1024;
const statusCache = new Map<string, { at: number; canceled: boolean }>();

/** 云端运行器上传一帧画面（JPEG，画面没变时为空），取回网页上的点击和按键 */
export async function POST(req: Request, ctx: RouteContext<"/api/matrix/runner/jobs/[id]/frame">) {
  const caller = await runnerCaller(req, req.headers.get("x-runner-id"));
  if (!caller) return Response.json({ error: "令牌无效" }, { status: 401 });
  const { tenantId, runnerId } = caller;
  const { id } = await ctx.params;

  // 取消状态每 2 秒查一次库
  let cached = statusCache.get(id);
  if (!cached || Date.now() - cached.at > 2000) {
    const job = await prisma.matrixJob.findFirst({ where: { id, tenantId, runner: runnerId }, select: { status: true } });
    if (!job) return Response.json({ error: "任务不存在" }, { status: 404 });
    cached = { at: Date.now(), canceled: job.status === "canceled" };
    statusCache.set(id, cached);
    for (const [k, v] of statusCache) if (Date.now() - v.at > 60_000) statusCache.delete(k);
  }

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > MAX_FRAME) return Response.json({ error: "画面太大" }, { status: 413 });
  const [w, h] = (req.headers.get("x-page-size") ?? "").split("x").map(Number);
  let url = "";
  try {
    url = decodeURIComponent(req.headers.get("x-page-url") ?? "");
  } catch {}
  const chooser = req.headers.get("x-file-chooser") === "1";
  const { inputs, idle } = pushFrame(id, body.length ? body : null, { url, width: w || 0, height: h || 0, chooser });
  return Response.json({ inputs, idle, canceled: cached.canceled });
}
