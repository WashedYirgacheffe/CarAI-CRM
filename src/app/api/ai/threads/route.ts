import { can, getCurrentUser } from "@/server/auth";
import { listThreads } from "@/server/ai-threads";

/** 我的 AI 对话（最近 30 段），换设备时读回 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!can(user, "ai.use")) return Response.json({ threads: [] });
  return Response.json({ threads: await listThreads(user) }, { headers: { "cache-control": "no-store" } });
}
