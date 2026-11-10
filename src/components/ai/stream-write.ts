/** 调用流式写信接口，边收边回调；返回最终文本或错误 */
export async function streamAiWrite(
  input: { mode: string; draft: string; original?: string; language?: string; tone?: string; channel: "email" | "whatsapp" },
  onText: (text: string) => void,
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch("/api/ai/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  } catch {
    return { ok: false, message: "网络错误，请重试" };
  }
  if (!res.ok || !res.body) return { ok: false, message: (await res.text().catch(() => "")) || "AI 处理失败，请稍后重试" };
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += value;
      onText(text);
    }
  } catch {
    if (!text) return { ok: false, message: "连接中断，请重试" };
  }
  text = text.trim();
  return text ? { ok: true, text } : { ok: false, message: "AI 没有返回内容，请重试" };
}
