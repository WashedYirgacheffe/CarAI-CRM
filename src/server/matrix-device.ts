import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import type { CurrentUser } from "@/server/auth";

/** 桌面软件配对后写进它自己浏览器里的 Cookie：当前是在哪台设备上用 CRM */
export const DEVICE_COOKIE = "cc_device";

/** 当前请求是不是从这个用户自己的桌面软件里发出的；是就返回设备 */
export async function currentDevice(user: CurrentUser) {
  const id = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!id) return null;
  return prisma.matrixDevice.findFirst({
    where: { id, tenantId: user.tenantId, userId: user.id, revokedAt: null },
    select: { id: true, name: true },
  });
}

/**
 * 账号还没有归属设备，又是在桌面软件里操作的 → 归到这台电脑（浏览器环境以后就放在这里）。
 * 返回操作后的归属设备 id。
 */
export async function bindAccountToCurrentDevice(user: CurrentUser, account: { id: string; deviceId: string | null }) {
  if (account.deviceId) return account.deviceId;
  const d = await currentDevice(user);
  if (!d) return null;
  await prisma.matrixAccount.update({ where: { id: account.id }, data: { deviceId: d.id, watchedAt: null } });
  return d.id;
}
