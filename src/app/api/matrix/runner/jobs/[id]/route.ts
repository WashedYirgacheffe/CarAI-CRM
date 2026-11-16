import { z } from "zod";
import { prisma } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { logMatrixEvent, notifyAccountDropped, runnerTenant } from "@/server/matrix";

const Body = z.object({
  runnerId: z.string().min(4).max(80),
  status: z.enum(["running", "waiting", "done", "failed"]).optional(),
  error: z.string().max(500).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  account: z
    .object({
      status: z.enum(["new", "pending", "active", "expired", "restricted"]).optional(),
      statusNote: z.string().max(300).nullable().optional(),
      /** 第一次启动时生成的指纹（已有的不会被覆盖） */
      fingerprint: z.record(z.string(), z.unknown()).optional(),
      loggedIn: z.boolean().optional(),
      checked: z.boolean().optional(),
    })
    .optional(),
  event: z.string().max(200).optional(),
});

const hasCookies = (p: unknown) => !!p && typeof p === "object" && "cookiesEnc" in p;

/** 运行器回报任务进度 / 结果，顺带更新账号状态 */
export async function POST(req: Request, ctx: RouteContext<"/api/matrix/runner/jobs/[id]">) {
  const tenantId = await runnerTenant(req);
  if (!tenantId) return Response.json({ error: "令牌无效" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "参数不对" }, { status: 400 });
  const { id } = await ctx.params;
  const b = parsed.data;

  const job = await prisma.matrixJob.findFirst({ where: { id, tenantId, runner: b.runnerId } });
  if (!job) return Response.json({ error: "任务不存在" }, { status: 404 });
  const canceled = job.status === "canceled";

  if (b.status && !canceled && !["done", "failed"].includes(job.status)) {
    const finished = b.status === "done" || b.status === "failed";
    await prisma.matrixJob.update({
      where: { id },
      data: {
        status: b.status,
        error: b.error ?? null,
        ...(b.result ? { result: b.result as Prisma.InputJsonValue } : {}),
        ...(finished ? { finishedAt: new Date() } : {}),
        // 用过的 Cookie 不留在库里
        ...(finished && hasCookies(job.payload) ? { payload: { cookieImport: true } } : {}),
      },
    });
  }

  if (b.account) {
    const acc = await prisma.matrixAccount.findUnique({ where: { id: job.accountId }, select: { fingerprint: true, status: true } });
    const a = b.account;
    await prisma.matrixAccount.update({
      where: { id: job.accountId },
      data: {
        ...(a.status ? { status: a.status } : {}),
        ...(a.statusNote !== undefined ? { statusNote: a.statusNote } : {}),
        ...(a.fingerprint && !acc?.fingerprint ? { fingerprint: a.fingerprint as Prisma.InputJsonValue } : {}),
        ...(a.loggedIn ? { loggedInAt: new Date() } : {}),
        ...(a.checked ? { checkedAt: new Date() } : {}),
      },
    });
    // 原来是已登录、现在失效了：提醒负责人
    if (acc?.status === "active" && (a.status === "expired" || a.status === "restricted")) {
      await notifyAccountDropped(job.accountId, a.statusNote ?? "检查时发现登录已失效");
    }
  }

  if (b.event) {
    const runner = await prisma.matrixRunner.findUnique({ where: { id: b.runnerId }, select: { host: true } });
    await logMatrixEvent({ tenantId, accountId: job.accountId, action: b.event, detail: b.error ?? null, runner: runner?.host ?? null });
  }
  return Response.json({ ok: true, canceled });
}
