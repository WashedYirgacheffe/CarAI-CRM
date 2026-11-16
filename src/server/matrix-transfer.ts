import "server-only";
import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { encryptSecret } from "@/server/crypto";
import { deleteObject } from "@/server/storage";
import { logMatrixEvent, onlineDeviceIds } from "@/server/matrix";
import { cloudConfigured, cloudEnabledFor, ensureCloudRunner, kickCloud, legacyRunnerOnline } from "@/server/matrix-cloud";
import { TRANSFER_MAX_PARTS } from "@/lib/matrix";
import type { MatrixJob } from "@/generated/prisma/client";

/*
 * 迁移浏览器环境（登录状态跟着走，不用重新登录）：
 *   1. 在原来的位置排「迁出」：运行器把环境目录打包、用一次性密钥加密、分块传到 OSS
 *   2. 迁出完成：账号归属换到新位置，排「迁入」（同一把密钥）
 *   3. 新位置的运行器下载、解密、解开，再打开浏览器确认还登录着
 * 迁移期间这个账号不排别的任务（enqueueMatrixJob 里拦着）。
 */

/**
 * 迁移压缩包第 n 块在存储里的位置。统一放在 matrix-env/ 下，方便在 OSS 上给这个前缀配生命周期规则
 * （例如 1 天后自动删除）；迁入结束时也会主动删（需要 AccessKey 有 DeleteObject 权限）。
 */
export const bundleKey = (tenantId: string, exportJobId: string, part: number) => `matrix-env/${tenantId}/${exportJobId}/${part}.bin`;

type TransferPayload = { to: string | null; keyEnc?: string; from?: string; parts?: number; size?: number; sha256?: string };

/** 原来的位置现在能不能执行迁出 */
async function sourceReachable(tenantId: string, deviceId: string | null) {
  if (deviceId) return (await onlineDeviceIds(tenantId)).has(deviceId);
  // 没有归属电脑：环境在云端（或旧式命令行运行器）
  return cloudConfigured() || (await legacyRunnerOnline(tenantId));
}

/**
 * 发起迁移。返回 null = 不能带着登录状态迁（没登录、原位置离线、目标是云端但没开），调用方按普通「换位置」处理。
 */
export async function startTransfer(input: { tenantId: string; accountId: string; userId: string; to: string | null; toName: string }) {
  const acc = await prisma.matrixAccount.findUnique({ where: { id: input.accountId }, select: { status: true, deviceId: true, proxyId: true } });
  if (!acc || acc.status !== "active" || !acc.proxyId) return null;
  if (input.to === null && !(await cloudEnabledFor(input.tenantId))) return null;
  if (!(await sourceReachable(input.tenantId, acc.deviceId))) return null;
  const payload: TransferPayload = { to: input.to, keyEnc: encryptSecret(randomBytes(32).toString("base64")) };
  const job = await prisma.$transaction(async (tx) => {
    await tx.matrixJob.updateMany({ where: { accountId: input.accountId, status: "queued" }, data: { status: "canceled", finishedAt: new Date() } });
    await tx.matrixAccount.update({ where: { id: input.accountId }, data: { statusNote: `正在把登录环境迁到「${input.toName}」…`, watchedAt: null } });
    return tx.matrixJob.create({ data: { tenantId: input.tenantId, accountId: input.accountId, kind: "export", payload, createdById: input.userId } });
  });
  await logMatrixEvent({ tenantId: input.tenantId, accountId: input.accountId, userId: input.userId, action: "transfer:start", detail: input.toName });
  // 环境在云端：即使企业关了云端，也拉起来做完这一次迁出
  if (!acc.deviceId && cloudConfigured() && !(await legacyRunnerOnline(input.tenantId))) after(() => ensureCloudRunner(input.tenantId));
  return job;
}

const ExportResult = z.object({
  parts: z.number().int().min(1).max(TRANSFER_MAX_PARTS),
  size: z.number().int().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** 迁出 / 迁入任务结束（运行器回报 done / failed 时调用） */
export async function finishTransfer(job: MatrixJob, ok: boolean, result: Record<string, unknown>, error: string | null) {
  const p = (job.payload ?? {}) as TransferPayload;
  const { keyEnc, ...rest } = p;
  if (job.kind === "import") {
    // 用过的密钥不留；登录状态由运行器在 account 里回报
    await prisma.matrixJob.update({ where: { id: job.id }, data: { payload: rest } });
    // 密文也删掉（密钥已经没了，留着也解不开）
    if (p.from) for (let i = 0; i < (p.parts ?? 0); i++) await deleteObject(bundleKey(job.tenantId, p.from, i)).catch(() => {});
    const why = (error ?? "未知原因").slice(0, 200);
    if (!ok && result.extracted) {
      // 环境已经解开放好了，只是最后打开检查时出错（例如代理不通）：登录状态还在，不用重新登录
      await prisma.matrixAccount.update({ where: { id: job.accountId }, data: { statusNote: `环境已迁入，检查登录时出错：${why}。可以点「检查登录状态」重试` } });
    } else if (!ok) {
      await prisma.matrixAccount.update({ where: { id: job.accountId }, data: { status: "new", statusNote: `迁入失败：${why}，需要重新登录` } });
    }
    await logMatrixEvent({ tenantId: job.tenantId, accountId: job.accountId, action: ok ? "transfer:done" : "transfer:failed", detail: error });
    return;
  }
  const r = ExportResult.safeParse(result);
  if (!ok || !r.success || !keyEnc) {
    await prisma.matrixJob.update({ where: { id: job.id }, data: { payload: rest } });
    // 迁出失败：账号留在原来的位置，照常使用
    await prisma.matrixAccount.update({
      where: { id: job.accountId },
      data: { statusNote: `迁移没完成：${(error ?? "运行器回报的结果不完整").slice(0, 200)}` },
    });
    await logMatrixEvent({ tenantId: job.tenantId, accountId: job.accountId, action: "transfer:failed", detail: error });
    return;
  }
  const target = p.to ? await prisma.matrixDevice.findFirst({ where: { id: p.to, tenantId: job.tenantId }, select: { id: true, name: true } }) : null;
  if (p.to && !target) {
    await prisma.matrixJob.update({ where: { id: job.id }, data: { payload: rest } });
    await prisma.matrixAccount.update({ where: { id: job.accountId }, data: { statusNote: "迁移没完成：目标电脑已被移除" } });
    return;
  }
  await prisma.$transaction([
    prisma.matrixJob.update({ where: { id: job.id }, data: { payload: { ...rest, ...r.data } } }),
    prisma.matrixAccount.update({
      where: { id: job.accountId },
      data: { deviceId: target?.id ?? null, watchedAt: null, statusNote: `登录环境正在迁入「${target?.name ?? "云端"}」…` },
    }),
    prisma.matrixJob.create({
      data: {
        tenantId: job.tenantId,
        accountId: job.accountId,
        kind: "import",
        createdById: job.createdById,
        payload: { keyEnc, from: job.id, ...r.data },
      },
    }),
  ]);
  if (!target) await kickCloud(job.tenantId, job.accountId, (fn) => after(fn));
}
