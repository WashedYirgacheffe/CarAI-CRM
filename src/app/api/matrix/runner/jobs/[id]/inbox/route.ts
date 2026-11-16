import { prisma } from "@/server/db";
import { runnerCaller } from "@/server/matrix";
import { InboxPayload, ingestInbox } from "@/server/inbox";

/** 运行器上报同步到的私信（同步任务、回复任务发完后都会报） */
export async function POST(req: Request, ctx: RouteContext<"/api/matrix/runner/jobs/[id]/inbox">) {
  const caller = await runnerCaller(req, req.headers.get("x-runner-id"));
  if (!caller) return Response.json({ error: "令牌无效" }, { status: 401 });
  const { tenantId, runnerId } = caller;
  const { id } = await ctx.params;
  const job = await prisma.matrixJob.findFirst({ where: { id, tenantId, runner: runnerId }, select: { accountId: true } });
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 });
  const parsed = InboxPayload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "参数不对" }, { status: 400 });
  const received = await ingestInbox(tenantId, job.accountId, parsed.data);
  return Response.json({ ok: true, received });
}
