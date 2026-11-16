import { after } from "next/server";
import { prisma } from "@/server/db";
import { runnerTenant } from "@/server/matrix";
import { cloudEnabledFor, cloudRunnerId, stopCloudRunner } from "@/server/matrix-cloud";

/**
 * 云端运行器空闲、准备退出时调用。还有排队任务就让它留下（stay），
 * 否则删掉心跳记录（之后有任务会重新拉起）并停掉 Sandbox。
 */
export async function POST(req: Request) {
  const tenantId = await runnerTenant(req);
  if (!tenantId) return Response.json({ error: "令牌无效" }, { status: 401 });
  // 只算会交给云端的任务（账号没有归属设备）；企业关了云端就直接走
  const queued = (await cloudEnabledFor(tenantId))
    ? await prisma.matrixJob.count({ where: { tenantId, status: "queued", account: { deviceId: null } } })
    : 0;
  if (queued) return Response.json({ stay: true });
  await prisma.matrixRunner.deleteMany({ where: { id: cloudRunnerId(tenantId) } });
  after(async () => {
    // 等运行器进程退出后再停机
    await new Promise((r) => setTimeout(r, 3000));
    await stopCloudRunner(tenantId);
  });
  return Response.json({ stay: false });
}
