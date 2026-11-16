import { prisma } from "@/server/db";
import { enqueueMatrixJob, logMatrixEvent, runnableAccounts } from "@/server/matrix";
import { kickCloud } from "@/server/matrix-cloud";
import { scheduleInboxSync, settleReplies } from "@/server/inbox";
import { AUTO_CHECK_EVERY_MS, JOB_TIMEOUT_MS, RUNNER_STALE_MS } from "@/lib/matrix";

/*
 * 社媒矩阵的定时活（在 web 进程里跑，见 src/instrumentation.ts）：
 * 1. 任务超时：排队太久没人领、运行太久、运行器掉线的任务标成失败
 * 2. 定时检查登录：已登录的账号每 12 小时无界面检查一次，掉线了提醒负责人（提醒在运行器回报时建）
 * 3. 收私信：开了「收私信」的账号每 10 分钟同步一次
 */

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[matrix]", ...a);

const QUEUE_TIMEOUT_MS = 30 * 60_000;
/** 每个企业每轮最多排几个检查任务，免得一次把云端运行器塞满 */
const CHECKS_PER_TENANT = 20;

async function fail(jobs: { id: string; tenantId: string; accountId: string; kind: string }[], error: string) {
  for (const j of jobs) {
    const r = await prisma.matrixJob.updateMany({
      where: { id: j.id, status: { in: ["queued", "running", "waiting"] } },
      data: { status: "failed", error, finishedAt: new Date() },
    });
    if (!r.count) continue;
    if (j.kind === "login") await prisma.matrixAccount.updateMany({ where: { id: j.accountId, status: "pending" }, data: { status: "new" } });
    if (j.kind === "reply") await settleReplies(j.accountId, [], error);
    await logMatrixEvent({ tenantId: j.tenantId, accountId: j.accountId, action: `${j.kind}:timeout`, detail: error });
  }
  return jobs.length;
}

/** 超时和掉线的任务标成失败 */
export async function expireMatrixJobs() {
  const now = Date.now();
  const sel = { id: true, tenantId: true, accountId: true, kind: true, runner: true, startedAt: true } as const;
  let n = await fail(
    await prisma.matrixJob.findMany({ where: { status: "queued", createdAt: { lt: new Date(now - QUEUE_TIMEOUT_MS) } }, select: sel }),
    "排队 30 分钟没有运行器领取",
  );

  // 取消 / 失败的 Cookie 导入任务：Cookie 不留在库里
  await prisma.matrixJob.updateMany({
    where: { status: { in: ["done", "failed", "canceled"] }, payload: { path: ["cookiesEnc"], string_starts_with: "" } },
    data: { payload: { cookieImport: true } },
  });

  const active = await prisma.matrixJob.findMany({ where: { status: { in: ["running", "waiting"] } }, select: sel });
  if (!active.length) return n;
  const timedOut = active.filter((j) => j.startedAt && now - j.startedAt.getTime() > (JOB_TIMEOUT_MS[j.kind] ?? JOB_TIMEOUT_MS.login));
  n += await fail(timedOut, "任务超时");

  const runnerIds = [...new Set(active.map((j) => j.runner).filter((r): r is string => !!r))];
  const alive = new Set(
    (await prisma.matrixRunner.findMany({ where: { id: { in: runnerIds }, lastSeenAt: { gte: new Date(now - 2 * RUNNER_STALE_MS) } }, select: { id: true } })).map(
      (r) => r.id,
    ),
  );
  const orphaned = active.filter((j) => !timedOut.includes(j) && (!j.runner || !alive.has(j.runner)));
  n += await fail(orphaned, "运行器掉线，任务中断");
  return n;
}

/** 给到期的已登录账号排检查任务；云端运行器没开就拉起来 */
export async function scheduleMatrixChecks() {
  const cutoff = new Date(Date.now() - AUTO_CHECK_EVERY_MS);
  const due = await prisma.matrixAccount.findMany({
    where: {
      status: "active",
      proxyId: { not: null },
      OR: [{ loggedInAt: null }, { loggedInAt: { lt: cutoff } }],
      // 12 小时内建过检查任务的不再建（失败了也等下一轮，免得反复重试）
      jobs: { none: { OR: [{ kind: "check", createdAt: { gte: cutoff } }, { status: { in: ["queued", "running", "waiting"] } }] } },
    },
    orderBy: { checkedAt: { sort: "asc", nulls: "first" } },
    select: { id: true, tenantId: true, deviceId: true },
    take: 500,
  });
  const byTenant = new Map<string, string[]>();
  for (const a of await runnableAccounts(due)) {
    const list = byTenant.get(a.tenantId) ?? [];
    if (list.length < CHECKS_PER_TENANT) list.push(a.id);
    byTenant.set(a.tenantId, list);
  }
  let n = 0;
  for (const [tenantId, ids] of byTenant) {
    for (const accountId of ids) {
      await enqueueMatrixJob({ tenantId, accountId, kind: "check", userId: null, payload: { auto: true } });
      n++;
    }
    await kickCloud(tenantId);
  }
  return n;
}

export async function runMatrixMaintenance() {
  const expired = await expireMatrixJobs();
  if (expired) log(`${expired} 个任务超时 / 运行器掉线，已标成失败`);
  const checks = await scheduleMatrixChecks();
  if (checks) log(`排了 ${checks} 个定时检查登录任务`);
  const inbox = await scheduleInboxSync();
  if (inbox) log(`排了 ${inbox} 个同步私信任务`);
}

const g = globalThis as unknown as { __matrixScheduler?: ReturnType<typeof setInterval> };

/** web 进程启动时调用一次：每 2 分钟跑一轮（私信 10 分钟内要进来） */
export function startMatrixScheduler() {
  if (g.__matrixScheduler) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runMatrixMaintenance();
    } catch (e) {
      log("定时任务出错", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  g.__matrixScheduler = setInterval(tick, 2 * 60_000);
  setTimeout(tick, 60_000);
}
