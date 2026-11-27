import { authWechatRequest, ingestWechatSync, WechatIngestPayload } from "@/server/wechat";

/** 桌面端上报本地只读同步的增量微信会话、消息与状态心跳 */
export async function POST(req: Request) {
  const auth = await authWechatRequest(req);
  if (!auth) return Response.json({ error: "未登录或设备令牌无效" }, { status: 401 });
  const parsed = WechatIngestPayload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "数据格式不正确", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  const result = await ingestWechatSync(auth.tenantId, auth.userId, parsed.data, auth.deviceId);
  return Response.json({ ok: true, ...result });
}
