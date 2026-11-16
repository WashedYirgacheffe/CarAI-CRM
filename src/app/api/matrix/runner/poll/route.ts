import { z } from "zod";
import { prisma } from "@/server/db";
import { decryptSecret } from "@/server/crypto";
import { addCloudUsage, deviceRunnerId, logMatrixEvent, playwrightProxy, runnerAuth } from "@/server/matrix";
import { claimReplies, settleReplies } from "@/server/inbox";
import { cloudEnabledFor } from "@/server/matrix-cloud";

const Body = z.object({
  runnerId: z.string().min(4).max(80),
  host: z.string().max(120),
  version: z.string().max(40).optional(),
  /** 运行器手上正在跑的任务 */
  running: z.array(z.string()).max(50),
  /** 还能再接几个任务 */
  free: z.number().int().min(0).max(20),
  /** 桌面版的状态说明（如「正在下载浏览器内核 41%」，这期间 free 为 0） */
  note: z.string().max(200).optional(),
});

/**
 * 运行器轮询：报心跳 → 告诉它哪些任务被取消了 → 有空位就领一个新任务。
 * 运行器重启后，之前没跑完的任务（不在 running 里）标成失败。
 */
export async function POST(req: Request) {
  const auth = await runnerAuth(req);
  if (!auth) return Response.json({ error: "令牌无效" }, { status: 401 });
  const { tenantId, device } = auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "参数不对" }, { status: 400 });
  const { host, version, running, free, note } = parsed.data;
  // 桌面软件的运行器 id 由设备决定，不信任客户端传的
  const runnerId = device ? deviceRunnerId(device.id) : parsed.data.runnerId;
  if (!device && runnerId.startsWith("dev-")) return Response.json({ error: "参数不对" }, { status: 400 });
  if (device) await prisma.matrixDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), appVersion: version, statusNote: note || null } });

  // 云端运行器按心跳间隔累计运行时长
  if (runnerId.startsWith("cloud-")) {
    const prev = await prisma.matrixRunner.findUnique({ where: { id: runnerId }, select: { lastSeenAt: true } });
    if (prev) await addCloudUsage(tenantId, (Date.now() - prev.lastSeenAt.getTime()) / 1000);
  }

  await prisma.matrixRunner.upsert({
    where: { id: runnerId },
    create: { id: runnerId, tenantId, host, version, busy: running.length },
    update: { tenantId, host, version, busy: running.length, lastSeenAt: new Date() },
  });

  // 运行器丢了的任务（重启 / 崩溃）
  const lost = await prisma.matrixJob.findMany({
    where: { tenantId, runner: runnerId, status: { in: ["running", "waiting"] }, id: { notIn: running } },
    select: { id: true, accountId: true, kind: true },
  });
  for (const j of lost) {
    await prisma.matrixJob.update({ where: { id: j.id }, data: { status: "failed", error: "运行器重启，任务中断", finishedAt: new Date() } });
    if (j.kind === "login") await prisma.matrixAccount.updateMany({ where: { id: j.accountId, status: "pending" }, data: { status: "new" } });
    if (j.kind === "reply") await settleReplies(j.accountId, [], "运行器重启，没发出去");
    if (j.kind === "export") await prisma.matrixAccount.update({ where: { id: j.accountId }, data: { statusNote: "迁移没完成：运行器重启" } });
    if (j.kind === "import") {
      await prisma.matrixAccount.update({ where: { id: j.accountId }, data: { status: "new", statusNote: "迁入没完成（运行器重启），需要重新登录" } });
    }
  }

  const canceled = running.length
    ? (await prisma.matrixJob.findMany({ where: { id: { in: running }, status: "canceled" }, select: { id: true } })).map((j) => j.id)
    : [];

  if (free <= 0) return Response.json({ canceled, job: null });
  // 企业关掉了云端：云端运行器只领「迁出环境」（把账号搬到电脑上），别的不领，空闲后自己退出
  const exportOnly = runnerId.startsWith("cloud-") && !(await cloudEnabledFor(tenantId));

  // 领任务：同一账号已有任务在跑的先不领
  const busyAccounts = (
    await prisma.matrixJob.findMany({ where: { tenantId, status: { in: ["running", "waiting"] } }, select: { accountId: true } })
  ).map((j) => j.accountId);
  // 桌面软件只领归属自己的账号；云端和命令行运行器只领没有归属设备的
  const next = await prisma.matrixJob.findFirst({
    where: {
      tenantId,
      status: "queued",
      accountId: { notIn: busyAccounts },
      account: { deviceId: device ? device.id : null },
      ...(exportOnly ? { kind: "export" } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!next) return Response.json({ canceled, job: null });
  const claimed = await prisma.matrixJob.updateMany({
    where: { id: next.id, status: "queued" },
    data: { status: "running", runner: runnerId, startedAt: new Date() },
  });
  if (!claimed.count) return Response.json({ canceled, job: null });

  const account = await prisma.matrixAccount.findUnique({ where: { id: next.accountId }, include: { proxy: true } });
  if (!account || !account.proxy) {
    await prisma.matrixJob.update({
      where: { id: next.id },
      data: { status: "failed", error: account ? "账号没有绑定代理" : "账号已删除", finishedAt: new Date() },
    });
    return Response.json({ canceled, job: null });
  }
  // 回复任务：领走时才取这个账号所有待发的消息
  const replies = next.kind === "reply" ? await claimReplies(account.id) : undefined;
  if (replies && !replies.length) {
    await prisma.matrixJob.update({ where: { id: next.id }, data: { status: "done", finishedAt: new Date() } });
    return Response.json({ canceled, job: null });
  }
  await logMatrixEvent({ tenantId, accountId: account.id, action: `start:${next.kind}`, runner: host });

  // 导入的 Cookie 加密存在任务里，交给运行器时才解开
  // 迁移环境的一次性密钥同样只在这里解开
  const { cookiesEnc, keyEnc, ...payload } = (next.payload ?? {}) as { cookiesEnc?: string; keyEnc?: string } & Record<string, unknown>;
  let cookies: unknown[] | undefined;
  if (cookiesEnc) {
    try {
      cookies = JSON.parse(decryptSecret(cookiesEnc)) as unknown[];
    } catch {
      cookies = undefined;
    }
  }

  return Response.json({
    canceled,
    job: {
      id: next.id,
      kind: next.kind,
      payload,
      ...(cookies ? { cookies } : {}),
      ...(replies ? { replies } : {}),
      ...(keyEnc ? { transferKey: decryptSecret(keyEnc) } : {}),
      account: {
        id: account.id,
        platform: account.platform,
        name: account.name,
        os: account.os,
        fingerprint: account.fingerprint,
        status: account.status,
      },
      proxy: playwrightProxy(account.proxy),
      proxyExitIp: account.proxy.exitIp,
    },
  });
}
