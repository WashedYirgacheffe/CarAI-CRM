"use server";

import { can, requireUser } from "@/server/auth";
import { googleTranslateMany } from "@/server/translate";
import { looksChinese } from "@/lib/lang";
import type { ActionState } from "@/lib/action";

/**
 * 通用快速翻译（营销预览对照、划词翻译共用）：
 * target 为 "auto" 时，中文译成英文，其他语言译成简体中文。
 */
export async function translateTextsAction(
  texts: string[],
  target: "auto" | "简体中文" | "English" = "auto",
): Promise<ActionState & { t?: string[]; to?: string }> {
  const user = await requireUser();
  if (!can(user, "ai.use")) return { ok: false, message: "没有使用翻译的权限" };
  const segs = texts.slice(0, 120).map((x) => String(x).slice(0, 4800));
  const nonEmpty = segs.filter((s) => s.trim());
  if (!nonEmpty.length) return { ok: true, t: segs.map(() => "") };
  const to = target === "auto" ? (looksChinese(nonEmpty.join("\n")) ? "English" : "简体中文") : target;
  try {
    return { ok: true, t: await googleTranslateMany(segs, to), to };
  } catch (e) {
    console.warn("quick translate failed:", (e as Error).message);
    return { ok: false, message: "翻译服务暂时不可用，请稍后再试" };
  }
}
