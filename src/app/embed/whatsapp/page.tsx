import type { Metadata } from "next";
import { MessageCircle } from "@/components/icons";
import { can, requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { aiConfigured } from "@/server/ai";
import { ChatView } from "@/app/(app)/whatsapp/chat-view";
import { loadChatView } from "@/app/(app)/whatsapp/chat-data";
import { EmbedLinks } from "../embed-links";

export const metadata: Metadata = { title: "WhatsApp" };

/** 工作台画布里的 WhatsApp 组件：只有聊天窗口，自己定时刷新，不牵动整个工作台 */
export default async function EmbedWhatsappPage({ searchParams }: PageProps<"/embed/whatsapp">) {
  const user = await requirePermission("whatsapp.use");
  const sp = await searchParams;
  const chatId = typeof sp.chat === "string" ? sp.chat : "";
  const account = await prisma.waAccount.findUnique({ where: { userId: user.id } });
  const view = account && chatId ? await loadChatView(user, account.id, chatId) : null;

  return (
    <div className="flex h-dvh overflow-hidden bg-card">
      <EmbedLinks />
      {view ? (
        <ChatView
          key={view.chat.id}
          tz={user.timezone}
          backHref={`/embed/whatsapp?chat=${view.chat.id}`}
          connected={account!.status === "CONNECTED"}
          canAi={can(user, "ai.use") && aiConfigured()}
          {...view}
        />
      ) : (
        <div className="m-auto max-w-xs px-6 text-center">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <MessageCircle className="size-6" />
          </span>
          <p className="font-medium">{account ? "这个会话不存在或已删除" : "还没有绑定 WhatsApp"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{account ? "可以从画布上移除这个组件。" : "先到 设置 → WhatsApp 关联手机。"}</p>
        </div>
      )}
    </div>
  );
}
