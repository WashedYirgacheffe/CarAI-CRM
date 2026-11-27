import { authWechatRequest, getWechatSyncConfig } from "@/server/wechat";

/** 桌面端拉取当前业务员的微信白名单与同步策略 */
export async function GET(req: Request) {
  const auth = await authWechatRequest(req);
  if (!auth) return Response.json({ error: "未登录或设备令牌无效" }, { status: 401 });
  const config = await getWechatSyncConfig(auth.tenantId, auth.userId);
  return Response.json(config);
}
