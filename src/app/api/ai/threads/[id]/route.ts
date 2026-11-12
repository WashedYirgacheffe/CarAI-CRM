import { after } from "next/server";
import { can, getCurrentUser } from "@/server/auth";
import { compactThread, deleteThread, saveThread, validThreadId } from "@/server/ai-threads";

/** 保存一段对话；旧的部分攒够了就在后台压成摘要 */
export async function PUT(req: Request, ctx: RouteContext<"/api/ai/threads/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!can(user, "ai.use")) return Response.json({ error: "没有使用 AI 的权限" }, { status: 403 });
  const { id } = await ctx.params;
  if (!validThreadId(id)) return Response.json({ error: "参数错误" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { turns?: unknown } | null;
  if (!Array.isArray(body?.turns) || !body.turns.length) return Response.json({ error: "参数错误" }, { status: 400 });
  const r = await saveThread(user, id, body.turns);
  if ("error" in r) return Response.json(r, { status: 413 });
  if (r.needsCompact) after(() => compactThread(user, id));
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/ai/threads/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { id } = await ctx.params;
  if (validThreadId(id)) await deleteThread(user, id);
  return Response.json({ ok: true });
}
