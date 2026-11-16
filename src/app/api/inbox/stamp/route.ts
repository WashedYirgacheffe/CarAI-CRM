import { getCurrentUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { canUseInbox, threadScope } from "@/server/inbox";

/** 收件箱轮询：会话列表和当前会话有没有变化（变了前端才刷新） */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !canUseInbox(user)) return Response.json({}, { status: 401 });
  const t = new URL(req.url).searchParams.get("t");
  const [list, msgs] = await Promise.all([
    prisma.socialThread.aggregate({ where: threadScope(user), _max: { updatedAt: true }, _count: true }),
    t
      ? prisma.socialMessage.groupBy({ by: ["status"], where: { threadId: t, thread: threadScope(user) }, _count: true })
      : Promise.resolve([] as { status: string; _count: number }[]),
  ]);
  const s = [list._max.updatedAt?.getTime() ?? 0, list._count, ...msgs.map((m) => `${m.status}:${m._count}`).sort()].join("|");
  return Response.json({ s }, { headers: { "Cache-Control": "no-store" } });
}
