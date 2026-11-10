"use server";

import { requireUser } from "@/server/auth";
import { AiError, aiWrite } from "@/server/ai";
import { googleTranslateText, prepareWrite, type WriteRequest } from "@/server/ai-write";
import { googleTranslate } from "@/server/translate";

export type AiResult = { ok: true; text: string } | { ok: false; message: string };

/** 写作助手（非流式）：写信 / 回复 / 润色 / 翻译，邮件和 WhatsApp 共用。界面上优先用 /api/ai/write 流式接口 */
export async function aiWriteAction(req: WriteRequest): Promise<AiResult> {
  const user = await requireUser();
  const prepared = await prepareWrite(user, req);
  if ("error" in prepared) return { ok: false, message: prepared.error };
  const text = googleTranslateText(prepared.input);
  if (text) {
    try {
      return { ok: true, text: await googleTranslate(text, prepared.input.language) };
    } catch {
      // 谷歌不可用时用 AI 翻译
    }
  }
  try {
    return { ok: true, text: await aiWrite(prepared.input) };
  } catch (e) {
    return { ok: false, message: e instanceof AiError ? e.message : "AI 处理失败，请稍后重试" };
  }
}
