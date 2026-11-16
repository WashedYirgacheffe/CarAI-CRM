import { prisma } from "@/server/db";
import { runnerCaller } from "@/server/matrix";
import { getObject, putObject } from "@/server/storage";
import { TRANSFER_MAX_PARTS, TRANSFER_PART_BYTES } from "@/lib/matrix";
import { bundleKey } from "@/server/matrix-transfer";

/*
 * 迁移浏览器环境的加密压缩包（运行器端用任务里下发的一次性密钥 AES-256-GCM 加密，服务器和 OSS 只见到密文）。
 * PUT ?part=n：迁出任务上传第 n 块；GET ?part=n：迁入任务下载第 n 块。只能操作自己在跑的任务。
 */

function partOf(req: Request) {
  const n = Number(new URL(req.url).searchParams.get("part"));
  return Number.isInteger(n) && n >= 0 && n < TRANSFER_MAX_PARTS ? n : null;
}

async function runningJob(req: Request, id: string, kind: "export" | "import") {
  const caller = await runnerCaller(req, req.headers.get("x-runner-id"));
  if (!caller) return null;
  return prisma.matrixJob.findFirst({ where: { id, tenantId: caller.tenantId, runner: caller.runnerId, kind, status: "running" } });
}

export async function PUT(req: Request, ctx: RouteContext<"/api/matrix/runner/jobs/[id]/bundle">) {
  const { id } = await ctx.params;
  const job = await runningJob(req, id, "export");
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 });
  const part = partOf(req);
  if (part === null) return Response.json({ error: "分块序号不对" }, { status: 400 });
  const body = Buffer.from(await req.arrayBuffer());
  if (!body.length || body.length > TRANSFER_PART_BYTES) return Response.json({ error: "分块大小不对" }, { status: 400 });
  await putObject(bundleKey(job.tenantId, job.id, part), body, { contentType: "application/octet-stream" });
  return Response.json({ ok: true });
}

export async function GET(req: Request, ctx: RouteContext<"/api/matrix/runner/jobs/[id]/bundle">) {
  const { id } = await ctx.params;
  const job = await runningJob(req, id, "import");
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 });
  const part = partOf(req);
  const p = (job.payload ?? {}) as { from?: string; parts?: number };
  if (part === null || !p.from || part >= (p.parts ?? 0)) return Response.json({ error: "分块序号不对" }, { status: 400 });
  const data = await getObject(bundleKey(job.tenantId, p.from, part)).catch(() => null);
  if (!data) return Response.json({ error: "压缩包不见了" }, { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: { "content-type": "application/octet-stream", "content-length": String(data.length), "cache-control": "no-store" },
  });
}
