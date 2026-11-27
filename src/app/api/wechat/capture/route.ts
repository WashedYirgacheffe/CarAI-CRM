import { z } from "zod";
import { parsePastedWechatLog } from "@/lib/wechat";
import { authWechatRequest, ensureWxAccount, ingestWechatSync } from "@/server/wechat";
import { prisma } from "@/server/db";

const Body = z.object({
  chatId: z.string().optional(),
  peerName: z.string().trim().max(120).optional(),
  wechatNo: z.string().trim().max(120).optional(),
  rawText: z.string().trim().min(1).max(50_000),
  defaultFromMe: z.boolean().optional(),
});

/** 桌面端全局热键快速归档 / 页面粘贴聊天记录导入 */
export async function POST(req: Request) {
  const auth = await authWechatRequest(req);
  if (!auth) return Response.json({ error: "未登录或设备令牌无效" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "参数不对" }, { status: 400 });

  const account = await ensureWxAccount(auth.tenantId, auth.userId);
  let wxKey = "";
  let remark: string | undefined;
  let name: string | undefined;
  let wechatNo = parsed.data.wechatNo;

  if (parsed.data.chatId) {
    const existing = await prisma.wxChat.findFirst({
      where: { id: parsed.data.chatId, accountId: account.id, tenantId: auth.tenantId },
    });
    if (!existing) return Response.json({ error: "会话不存在" }, { status: 404 });
    wxKey = existing.wxKey;
    remark = existing.remark ?? undefined;
    name = existing.name ?? undefined;
    wechatNo = existing.wechatNo ?? wechatNo;
  } else {
    const label = parsed.data.wechatNo || parsed.data.peerName || "快捷归档会话";
    wxKey = `manual:${label}`;
    name = parsed.data.peerName || label;
  }

  const lines = parsePastedWechatLog(parsed.data.rawText, {
    myName: account.name,
    defaultFromMe: parsed.data.defaultFromMe ?? false,
  });

  const res = await ingestWechatSync(
    auth.tenantId,
    auth.userId,
    {
      threads: [
        {
          wxKey,
          wechatNo,
          remark,
          name,
          messages: lines.map((l) => ({
            fromMe: l.fromMe,
            senderName: l.senderName,
            text: l.text,
            type: "text",
            at: l.at,
          })),
        },
      ],
    },
    auth.deviceId,
  );

  return Response.json({ ok: true, count: lines.length, ...res });
}
