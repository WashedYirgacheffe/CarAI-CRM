import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db";
import { appUrl } from "@/server/share";

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

const locks = new Map<string, Promise<void>>();

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
    args: ["-lc", `cd ${DIR} && exec node runner.mjs >> ${DIR}/runner.log 2>&1`],
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
