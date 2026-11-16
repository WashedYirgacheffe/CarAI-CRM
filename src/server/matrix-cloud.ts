import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db";
import { appUrl } from "@/server/share";
import { RUNNER_STALE_MS } from "@/lib/matrix";

/*
 * 云端运行器：每个企业一台 Vercel Sandbox（名字 crm-matrix-<企业ID>，持久化文件系统，
 * 浏览器数据目录停机后自动快照、下次启动恢复）。有任务时 CRM 自动拉起，
 * 运行器空闲几分钟后自己退出、CRM 把 Sandbox 停掉，只按实际运行时间计费。
 *
 * 环境变量：VERCEL_TOKEN、VERCEL_TEAM_ID、VERCEL_PROJECT_ID、
 * MATRIX_SANDBOX_SNAPSHOT（scripts/matrix-sandbox-image.mts 生成的基础镜像）、
 * MATRIX_SANDBOX_REGION（默认 hkg1）、MATRIX_SANDBOX_VCPUS（默认 2）。
 */

const HOME = "/vercel";
const DIR = `${HOME}/runner`;

export function cloudConfigured() {
  const e = process.env;
  return Boolean(e.VERCEL_TOKEN && e.VERCEL_TEAM_ID && e.VERCEL_PROJECT_ID && e.MATRIX_SANDBOX_SNAPSHOT);
}

/** 服务器配好了 Vercel，并且企业在「设置 → 社媒运行」里打开了云端 */
export async function cloudEnabledFor(tenantId: string) {
  if (!cloudConfigured()) return false;
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { matrixCloudEnabled: true } });
  return !!t?.matrixCloudEnabled;
}

/** 旧式的命令行运行器（企业令牌 mr_，不是桌面软件也不是云端）在线：没有归属设备的账号由它跑 */
export async function legacyRunnerOnline(tenantId: string) {
  const r = await prisma.matrixRunner.findFirst({
    where: {
      tenantId,
      lastSeenAt: { gte: new Date(Date.now() - RUNNER_STALE_MS) },
      NOT: [{ id: { startsWith: "cloud-" } }, { id: { startsWith: "dev-" } }],
    },
    select: { id: true },
  });
  return !!r;
}

/**
 * 有没有归属设备的账号在排队，并且该交给云端 → 拉起云端运行器（在 after() 里跑，不挡请求）。
 * 传 accountId 时只看这个账号。返回 true = 这个任务会在云端执行（界面据此显示实时画面）。
 */
export async function kickCloud(tenantId: string, accountId?: string, schedule: (fn: () => Promise<void>) => void = (fn) => void fn()) {
  if (!(await cloudEnabledFor(tenantId))) return false;
  if (await legacyRunnerOnline(tenantId)) return false;
  const pending = await prisma.matrixJob.count({
    where: { tenantId, status: "queued", ...(accountId ? { accountId } : {}), account: { deviceId: null } },
  });
  if (!pending) return false;
  schedule(() => ensureCloudRunner(tenantId));
  return true;
}

export const cloudRunnerId = (tenantId: string) => `cloud-${tenantId}`;
const sandboxName = (tenantId: string) => `crm-matrix-${tenantId}`.toLowerCase();

function secret() {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error("未配置 APP_SECRET");
  return s;
}

const sign = (tenantId: string) => createHmac("sha256", secret()).update(`matrix-cloud:${tenantId}`).digest("base64url");

/** 云端运行器的令牌：mrc_<企业ID>_<签名>，不入库 */
export const cloudRunnerToken = (tenantId: string) => `mrc_${tenantId}_${sign(tenantId)}`;

export function verifyCloudToken(token: string): string | null {
  const m = /^mrc_([A-Za-z0-9-]+)_([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return null;
  const a = Buffer.from(m[2]);
  const b = Buffer.from(sign(m[1]));
  return a.length === b.length && timingSafeEqual(a, b) ? m[1] : null;
}

function creds() {
  return {
    token: process.env.VERCEL_TOKEN!,
    teamId: process.env.VERCEL_TEAM_ID!,
    projectId: process.env.VERCEL_PROJECT_ID!,
  };
}

// @vercel/sandbox 要 Node 22.19+，只在用到时才加载
const sdk = () => import("@vercel/sandbox");

// 放 globalThis：Server Action 和 Route Handler 是不同的打包产物，模块级变量各有一份
const g = globalThis as unknown as { __matrixCloudLocks?: Map<string, Promise<void>> };
const locks = (g.__matrixCloudLocks ??= new Map());

/** 有任务时调用：云端运行器没在跑就拉起来（同一企业同时只拉一次） */
export function ensureCloudRunner(tenantId: string): Promise<void> {
  if (!cloudConfigured()) return Promise.resolve();
  const running = locks.get(tenantId);
  if (running) return running;
  const p = start(tenantId)
    .catch((e) => console.error("[matrix-cloud] 启动失败", tenantId, e instanceof Error ? e.message : e))
    .finally(() => locks.delete(tenantId));
  locks.set(tenantId, p);
  return p;
}

async function start(tenantId: string) {
  if (!(await cloudEnabledFor(tenantId))) return;
  // 10 秒内报过心跳的就不用管
  const seen = await prisma.matrixRunner.findUnique({ where: { id: cloudRunnerId(tenantId) }, select: { lastSeenAt: true } });
  if (seen && Date.now() - seen.lastSeenAt.getTime() < 10_000) return;

  const { Sandbox } = await sdk();
  const sbx = await Sandbox.getOrCreate({
    ...creds(),
    name: sandboxName(tenantId),
    source: { type: "snapshot", snapshotId: process.env.MATRIX_SANDBOX_SNAPSHOT! },
    region: (process.env.MATRIX_SANDBOX_REGION || "hkg1") as "hkg1",
    resources: { vcpus: Number(process.env.MATRIX_SANDBOX_VCPUS || 2) },
    timeout: Number(process.env.MATRIX_SANDBOX_TIMEOUT_MIN || 240) * 60_000,
    persistent: true,
    keepLastSnapshots: { count: 1, expiration: 0 },
    resume: true,
  });

  const sh = async (cmd: string) => {
    const r = await sbx.runCommand({ cmd: "bash", args: ["-lc", cmd] });
    return { code: r.exitCode, out: (await r.stdout()).trim() };
  };

  if ((await sh("pgrep -f '[n]ode runner.mjs' >/dev/null")).code === 0) return;

  // 运行器脚本随 CRM 一起发版；内容变了才重新写
  const bundle = (await import("@/generated/matrix-runner-bundle")).default;
  const hash = createHash("sha256").update(bundle).digest("hex").slice(0, 16);
  const current = await sh(`cat ${DIR}/runner.hash 2>/dev/null`);
  if (current.out !== hash) {
    await sbx.writeFiles([
      { path: `${DIR}/runner.mjs`, content: Buffer.from(bundle) },
      { path: `${DIR}/runner.hash`, content: Buffer.from(hash) },
    ]);
  }

  await sbx.runCommand({
    cmd: "bash",
    // flock：两次启动请求撞在一起时，第二个运行器直接退出（同一 ID 两个运行器会互相把对方的任务判成中断）。
    // 运行器崩溃（退出码不是 0）3 秒后自动重启，连续 5 次就放弃；空闲退出是 0，不重启
    args: [
      "-lc",
      `cd ${DIR} && exec flock -n ${DIR}/runner.lock bash -c 'n=0; until node runner.mjs; do n=$((n+1)); [ $n -ge 5 ] && break; echo "运行器异常退出，3 秒后重启（第 $n 次）"; sleep 3; done' >> ${DIR}/runner.log 2>&1`,
    ],
    env: {
      CRM_URL: appUrl(),
      MATRIX_RUNNER_TOKEN: cloudRunnerToken(tenantId),
      MATRIX_RUNNER_ID: cloudRunnerId(tenantId),
      MATRIX_RUNNER_HOST: "云端",
      MATRIX_HEADLESS: "1",
      MATRIX_IDLE_EXIT_MIN: process.env.MATRIX_IDLE_EXIT_MIN || "5",
    },
    detached: true,
  });
}

/** 运行器空闲退出后调用：停机（持久化 Sandbox 停机时自动快照文件系统） */
export async function stopCloudRunner(tenantId: string) {
  if (!cloudConfigured()) return;
  try {
    const { Sandbox } = await sdk();
    const sbx = await Sandbox.get({ ...creds(), name: sandboxName(tenantId) });
    if (sbx.status === "running" || sbx.status === "pending") await sbx.stop();
  } catch (e) {
    console.error("[matrix-cloud] 停机失败", tenantId, e instanceof Error ? e.message : e);
  }
}
