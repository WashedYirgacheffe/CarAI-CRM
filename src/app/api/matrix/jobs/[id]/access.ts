import "server-only";
import { tenantDb } from "@/server/db";
import { can, getCurrentUser } from "@/server/auth";

/** 看画面 / 操作：管理员，或者账号负责人 */
export async function liveJobFor(id: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const job = await tenantDb(user.tenantId).matrixJob.findFirst({
    where: { id },
    select: { id: true, status: true, kind: true, error: true, account: { select: { ownerId: true, status: true } } },
  });
  if (!job) return null;
  if (!can(user, "matrix.manage") && !(can(user, "matrix.use") && job.account.ownerId === user.id)) return null;
  return job;
}
