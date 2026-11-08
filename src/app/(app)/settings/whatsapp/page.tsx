import type { Metadata } from "next";
import QRCode from "qrcode";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { WhatsappBinding } from "./whatsapp-binding";

export const metadata: Metadata = { title: "WhatsApp 绑定" };

export default async function Page() {
  const user = await requirePermission("whatsapp.use");
  const a = await prisma.waAccount.findUnique({ where: { userId: user.id } });
  const qr = a?.status === "CONNECTING" && a.qr ? await QRCode.toDataURL(a.qr, { margin: 1, width: 264 }) : null;
  return (
    <>
      <PageHeader title="WhatsApp 绑定" description="用手机 WhatsApp 扫码登录（与 WhatsApp Web 相同的方式），之后就能在系统里和客户聊天，聊天记录自动关联到客户。" />
      <WhatsappBinding
        account={
          a
            ? {
                status: a.status,
                enabled: a.enabled,
                phone: a.phone,
                name: a.name,
                lastError: a.lastError,
                connectedAt: a.connectedAt?.toISOString() ?? null,
              }
            : null
        }
        qr={qr}
        tz={user.timezone}
      />
    </>
  );
}
