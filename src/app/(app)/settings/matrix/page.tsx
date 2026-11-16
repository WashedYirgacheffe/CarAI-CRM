import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { cloudConfigured } from "@/server/matrix-cloud";
import { deviceRunnerId } from "@/server/matrix";
import { RUNNER_STALE_MS } from "@/lib/matrix";
import { MatrixRunSettings } from "./matrix-run-settings";

/** 最近 90 秒报过心跳 */
const fresh = (d: Date | null) => !!d && Date.now() - d.getTime() < RUNNER_STALE_MS;

export const metadata: Metadata = { title: "社媒运行" };

export default async function MatrixSettingsPage() {
  const user = await requirePermission("matrix.manage");
  const [tenant, devices] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { matrixCloudEnabled: true } }),
    prisma.matrixDevice.findMany({
      where: { tenantId: user.tenantId, revokedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        os: true,
        appVersion: true,
        lastSeenAt: true,
        statusNote: true,
        user: { select: { name: true } },
        _count: { select: { accounts: true } },
      },
    }),
  ]);
  const beats = await prisma.matrixRunner.findMany({
    where: { id: { in: devices.map((d) => deviceRunnerId(d.id)) } },
    select: { id: true, lastSeenAt: true },
  });
  return (
    <>
      <PageHeader
        title="社媒运行"
        description="社媒账号的浏览器环境默认跑在负责人电脑上的车车 CRM 桌面版里。需要电脑关机时也能执行，可以打开云端运行器。"
      />
      <MatrixRunSettings
        cloudConfigured={cloudConfigured()}
        cloudEnabled={tenant.matrixCloudEnabled}
        devices={devices.map((d) => {
          const beat = beats.find((b) => b.id === deviceRunnerId(d.id))?.lastSeenAt ?? d.lastSeenAt;
          return {
            id: d.id,
            name: d.name,
            os: d.os,
            appVersion: d.appVersion,
            owner: d.user.name,
            accounts: d._count.accounts,
            lastSeenAt: beat?.toISOString() ?? null,
            online: fresh(beat),
            note: d.statusNote,
          };
        })}
      />
    </>
  );
}
