import "server-only";

/*
 * 向量检索（可选）：配置了 EMBED_API_KEY 才启用，接口兼容 OpenAI 的 /v1/embeddings。
 * 例：阿里云百炼 EMBED_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode EMBED_MODEL=text-embedding-v4
 * 没配置时记忆检索只用中英文关键词，照样能跨语言匹配，只是没那么准。
 */

const BASE_URL = (process.env.EMBED_BASE_URL || "").replace(/\/+$/, "");
const MODEL = process.env.EMBED_MODEL || "text-embedding-v4";

export const embedModel = () => (process.env.EMBED_API_KEY && BASE_URL ? MODEL : null);

/** 一批文字的向量；没配置或失败返回 null（调用方退回关键词检索） */
export async function embed(texts: string[]): Promise<number[][] | null> {
  const model = embedModel();
  if (!model || !texts.length) return null;
  try {
    const res = await fetch(`${BASE_URL}/v1/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.EMBED_API_KEY}` },
      body: JSON.stringify({ model, input: texts.map((t) => t.slice(0, 2000)) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    const out: number[][] = [];
    for (const d of data.data ?? []) out[d.index] = d.embedding;
    return out.length === texts.length && out.every(Array.isArray) ? out : null;
  } catch (e) {
    console.error("[embed]", e instanceof Error ? e.message : e);
    return null;
  }
}

export function cosine(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
