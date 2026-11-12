import { can, getCurrentUser } from "@/server/auth";
import { aiConfigured } from "@/server/ai";
import { validThreadId } from "@/server/ai-threads";
import { runCanvasTurn, type Attachment, type CanvasEvent, type CanvasTurn, type PageSnippet } from "@/server/canvas-ai";

const fail = (message: string, status = 400) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** 工作台 AI：一行一个 JSON 事件（状态、文字、布局、选项、跳转链接） */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("请先登录", 401);
  if (!can(user, "ai.use")) return fail("没有使用 AI 的权限", 403);
  if (!aiConfigured()) return fail("AI 还没有配置", 503);
  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    history?: unknown;
    layout?: unknown;
    active?: unknown;
    page?: unknown;
    onCanvas?: unknown;
    name?: unknown;
    narrow?: unknown;
    attachments?: unknown;
    snippet?: unknown;
    threadId?: unknown;
  } | null;
  const attachments: Attachment[] = (Array.isArray(body?.attachments) ? body.attachments : [])
    .filter((a): a is Attachment => !!a && (a.kind === "image" || a.kind === "video") && Array.isArray(a.frames))
    .slice(0, 6)
    .map((a) => ({
      kind: a.kind,
      name: String(a.name ?? ""),
      frames: a.frames.filter((f) => typeof f === "string"),
      times: Array.isArray(a.times) ? a.times.map(Number) : undefined,
      duration: Number(a.duration) || undefined,
    }));
  const sn = body?.snippet as Partial<PageSnippet> | undefined;
  const snippet: PageSnippet | undefined =
    sn && typeof sn.text === "string" && sn.text.trim()
      ? { label: String(sn.label ?? ""), text: sn.text, href: typeof sn.href === "string" ? sn.href : undefined }
      : undefined;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message && !attachments.length && !snippet) return fail("请输入内容");
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
      await runCanvasTurn(
        user,
        {
          message: message || (attachments.length ? "帮我看看这个" : "帮我看看这是什么"),
          history,
          attachments,
          snippet,
          layout: body?.layout,
          active: typeof body?.active === "string" ? body.active : undefined,
          page: typeof body?.page === "string" ? body.page : undefined,
          onCanvas: body?.onCanvas !== false,
          name: typeof body?.name === "string" ? body.name : undefined,
          narrow: body?.narrow === true,
          threadId: validThreadId(body?.threadId) ? body.threadId : undefined,
        },
        emit,
        abort.signal,
      );
      if (!abort.signal.aborted) c.close();
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
