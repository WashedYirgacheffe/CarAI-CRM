import { z } from "zod";
import { prisma } from "@/server/db";
import { logMatrixEvent, notifyAccountDropped, runnerAuth } from "@/server/matrix";
import { InboxPayload, ingestInbox } from "@/server/inbox";

const Body = InboxPayload.partial().extend({
  /** 常驻时发现登录失效 */
  expired: z.string().max(300).optional(),
  /** 第一次启动时生成的指纹（已有的不覆盖） */
  fingerprint: z.record(z.string(), z.unknown()).optional(),
});

/** 常驻监听上报：新私信、登录失效。只能报归属这台电脑的账号 */
export async function POST(req: Request, ctx: RouteContext<"/api/matrix/runner/watch/[accountId]">) {
  const auth = await runnerAuth(req);
  if (!auth?.device) return Response.json({ error: "令牌无效" }, { status: 401 });
  const { accountId } = await ctx.params;
  const acc = await prisma.matrixAccount.findFirst({
    where: { id: accountId, tenantId: auth.tenantId, deviceId: auth.device.id },
    select: { id: true, status: true, fingerprint: true },
  });
  if (!acc) return Response.json({ error: "账号不归属这台电脑" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "参数不对" }, { status: 400 });
  const b = parsed.data;

  if (b.fingerprint && !acc.fingerprint) {
    await prisma.matrixAccount.update({ where: { id: acc.id }, data: { fingerprint: b.fingerprint as object } });
  }
  if (b.expired) {
    await prisma.matrixAccount.update({
      where: { id: acc.id },
      data: { status: "expired", statusNote: b.expired, checkedAt: new Date(), watchedAt: null },
    });
    if (acc.status === "active") await notifyAccountDropped(acc.id, b.expired);
    await logMatrixEvent({ tenantId: auth.tenantId, accountId: acc.id, action: "watch:expired", detail: b.expired });
    return Response.json({ ok: true, received: 0 });
  }
  const received = b.threads?.length ? await ingestInbox(auth.tenantId, acc.id, { threads: b.threads }) : 0;
  await prisma.matrixAccount.update({ where: { id: acc.id }, data: { checkedAt: new Date(), watchedAt: new Date() } });
  return Response.json({ ok: true, received });
}
