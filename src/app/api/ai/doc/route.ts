import { can, getCurrentUser } from "@/server/auth";
import { aiConfigured } from "@/server/ai";
import { runDocTurn, type DocEvent } from "@/server/doc-ai";
import { isDocType, normalizeDoc } from "@/lib/trade-docs/schema";

// 开了深度思考，一轮可能要一两分钟
export const maxDuration = 300;

const fail = (message: string, status = 400) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** AI 单据工作台：一行一个 JSON 事件（思考、文字、状态、单据补丁、填写卡片） */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("请先登录", 401);
  if (!can(user, "ai.use")) return fail("没有使用 AI 的权限", 403);
  if (!aiConfigured()) return fail("AI 还没有配置", 503);
  const body = (await request.json().catch(() => null)) as { type?: unknown; data?: unknown; message?: unknown; history?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 30_000) : "";
  if (!message) return fail("请输入内容");
  const history = (Array.isArray(body?.history) ? body.history : [])
    .filter(
      (m): m is { role: "user" | "assistant"; text: string } =>
        !!m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && !!m.text.trim(),
    )
    .map((m) => ({ role: m.role, text: m.text.slice(0, 20_000) }));

  const enc = new TextEncoder();
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const emit = (e: DocEvent) => {
        if (abort.signal.aborted) return;
        try {
          c.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          abort.abort();
        }
      };
      await runDocTurn(
        user,
        { type: isDocType(body?.type) ? body.type : null, data: normalizeDoc(body?.data), message, history },
        emit,
        abort.signal,
      ).catch(() => emit({ t: "error", message: "AI 出错了，请重试" }));
      if (!abort.signal.aborted) c.close();
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
