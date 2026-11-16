import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { pairDevice } from "@/server/matrix";
import { DEVICE_COOKIE } from "@/server/matrix-device";

const Body = z.object({
  /** 这台电脑之前配对过的设备 id（重装或重新登录时沿用，账号归属不丢） */
  deviceId: z.string().max(40).nullish(),
  name: z.string().trim().min(1).max(80),
  os: z.string().max(80).optional(),
  appVersion: z.string().max(40).optional(),
});

/**
 * 桌面软件配对：用当前登录会话换一个设备令牌（只返回这一次），运行器拿它领归属这台电脑的账号的任务。
 * 只接受桌面软件发来的请求（自定义请求头，网页跨站发不出来）。
 */
export async function POST(req: Request) {
  if (req.headers.get("x-cheche-desktop") !== "1") return Response.json({ error: "只能从桌面软件配对" }, { status: 400 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "参数不对" }, { status: 400 });
  const { deviceId, token } = await pairDevice({ tenantId: user.tenantId, userId: user.id, ...parsed.data });
  const res = Response.json({ deviceId, token, user: { id: user.id, name: user.name, tenantName: user.tenantName } });
  res.headers.append(
    "set-cookie",
    `${DEVICE_COOKIE}=${deviceId}; Path=/; Max-Age=${60 * 60 * 24 * 400}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
  return res;
}
