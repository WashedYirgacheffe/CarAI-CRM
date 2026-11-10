import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { getSeller } from "@/server/documents";
import { readShareToken } from "@/server/share";
import { SHARE_FORMS } from "../../forms";
import { ShareForm } from "../../public-bits";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: SHARE_FORMS.inquiry.title }, robots: { index: false } };

/** 客户填写的询价表单（WhatsApp 里发出去的链接） */
export default async function Page({ params }: PageProps<"/s/i/[token]">) {
  const { token } = await params;
  const chatId = readShareToken("inquiry", token);
  const chat = chatId ? await prisma.waChat.findUnique({ where: { id: chatId }, select: { tenantId: true } }) : null;
  if (!chat) notFound();
  const seller = await getSeller(chat.tenantId);
  return (
    <div className="px-4">
      <ShareForm kind="inquiry" token={token} seller={seller.name} />
    </div>
  );
}
