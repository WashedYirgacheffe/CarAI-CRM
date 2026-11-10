import { getCurrentUser } from "@/server/auth";
import { AiError, aiStream, writePrompt } from "@/server/ai";
import { googleTranslateText, prepareWrite, type WriteRequest } from "@/server/ai-write";
import { googleTranslate } from "@/server/translate";

const fail = (message: string, status = 400) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * 写信助手（流式）：返回纯文本流，前端边收边显示。
 * 纯翻译先走谷歌翻译（半秒出结果），谷歌失败再退回 AI。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("请先登录", 401);
  const body = (await request.json().catch(() => null)) as WriteRequest | null;
  if (!body) return fail("请求无效");
  const prepared = await prepareWrite(user, body);
  if ("error" in prepared) return fail(prepared.error);
  const { input } = prepared;

  const text = googleTranslateText(input);
  if (text) {
    try {
      return new Response(await googleTranslate(text, input.language), {
        headers: { "content-type": "text/plain; charset=utf-8", "x-engine": "google" },
      });
    } catch (e) {
      console.warn("google translate failed, fallback to AI:", (e as Error).message);
    }
  }

  // 先拿到第一段再开始响应：连接失败、鉴权失败等能作为错误返回，而不是一个空的流
  const gen = aiStream(writePrompt(input));
  let first: IteratorResult<string>;
  try {
    first = await gen.next();
  } catch (e) {
    return fail(e instanceof AiError ? e.message : "AI 处理失败，请稍后重试", 502);
  }
  if (first.done) return fail("AI 没有返回内容，请重试", 502);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(first.value));
    },
    async pull(c) {
      try {
        const { value, done } = await gen.next();
        if (done) c.close();
        else c.enqueue(enc.encode(value));
      } catch (e) {
        console.error("ai stream broke", e);
        c.close();
      }
    },
    cancel() {
      void gen.return(undefined);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-engine": "ai" } });
}
