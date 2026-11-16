import { z } from "zod";
import { prisma } from "@/server/db";
import { playwrightProxy, runnerAuth } from "@/server/matrix";
import { WATCH_PLATFORMS } from "@/lib/matrix";

const Body = z.object({
  /** 运行器现在常驻着的账号 */
  watching: z.array(z.string().max(40)).max(50),
});

/**
 * 桌面版常驻监听：报心跳（哪些账号正在实时收私信），取回该常驻的账号。
 * 只给桌面软件用：归属这台电脑、已登录、开了收私信、平台已适配的账号。
 */
export async function POST(req: Request) {
  const auth = await runnerAuth(req);
  if (!auth) return Response.json({ error: "令牌无效" }, { status: 401 });
  if (!auth.device) return Response.json({ accounts: [] });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "参数不对" }, { status: 400 });
  const deviceId = auth.device.id;

  if (parsed.data.watching.length) {
    await prisma.matrixAccount.updateMany({
      where: { id: { in: parsed.data.watching }, tenantId: auth.tenantId, deviceId },
      data: { watchedAt: new Date() },
    });
  }

  const rows = await prisma.matrixAccount.findMany({
    where: {
      tenantId: auth.tenantId,
      deviceId,
      status: "active",
      inboxSync: true,
      platform: { in: [...WATCH_PLATFORMS] },
      proxyId: { not: null },
      // 正在迁移环境的不常驻（迁入前目录是空的，会被误判成登录失效）
      jobs: { none: { kind: { in: ["export", "import"] }, status: { in: ["queued", "running", "waiting"] } } },
    },
    include: { proxy: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return Response.json({
    accounts: rows.map((a) => ({
      id: a.id,
      platform: a.platform,
      name: a.name,
      os: a.os,
      fingerprint: a.fingerprint,
      status: a.status,
      proxy: playwrightProxy(a.proxy!),
    })),
  });
}
