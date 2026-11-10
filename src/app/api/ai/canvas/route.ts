import { can, getCurrentUser } from "@/server/auth";
import { aiConfigured } from "@/server/ai";
import { runCanvasTurn, type CanvasEvent, type CanvasTurn } from "@/server/canvas-ai";

const fail = (message: string, status = 400) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** 工作台 AI：一行一个 JSON 事件（状态、文字、布局、选项、跳转链接） */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("请先登录", 401);
  if (!can(user, "ai.use")) return fail("没有使用 AI 的权限", 403);
  if (!aiConfigured()) return fail("AI 还没有配置", 503);
  const body = (await request.json().catch(() => null)) as { message?: unknown; history?: unknown; layout?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return fail("请输入内容");
  const history: CanvasTurn[] = (Array.isArray(body?.history) ? body.history : [])
    .filter((m): m is CanvasTurn => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && !!m.content)
    .slice(-12);

  const enc = new TextEncoder();
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const emit = (e: CanvasEvent) => {
        if (abort.signal.aborted) return;
        try {
          c.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          abort.abort();
        }
      };
      await runCanvasTurn(user, { message, history, layout: body?.layout }, emit, abort.signal);
      if (!abort.signal.aborted) c.close();
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
