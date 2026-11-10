import "server-only";
import { prisma } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { aiConfigured, WRITE_MODES, type WriteInput, type WriteMode } from "@/server/ai";
import { googleLang, MAIL_GOOGLE_MAX } from "@/server/translate";

export type WriteRequest = { mode: WriteMode; draft: string; original?: string; language?: string; tone?: string; channel: "email" | "whatsapp" };

/** 校验并补全写作请求；返回错误文案或可直接交给 AI 的输入 */
export async function prepareWrite(user: CurrentUser, input: WriteRequest): Promise<{ error: string } | { input: WriteInput }> {
  if (!can(user, "ai.use")) return { error: "没有使用 AI 的权限" };
  if (!(input.mode in WRITE_MODES)) return { error: "不支持的操作" };
  if (input.channel !== "email" && input.channel !== "whatsapp") return { error: "不支持的操作" };
  if (!String(input.draft ?? "").trim() && !input.original?.trim()) {
    return { error: input.mode === "compose" ? "先写几句要点，AI 帮你扩写成完整的信" : "没有可处理的内容" };
  }
  const wantsGoogle = !!googleTranslateText({ ...input, draft: String(input.draft ?? "") });
  if (!wantsGoogle && !aiConfigured()) return { error: "管理员还没有配置 AI 服务" };
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true, docCompanyName: true } });
  return {
    input: {
      mode: input.mode,
      channel: input.channel,
      draft: String(input.draft ?? "").slice(0, 8000),
      original: input.original?.slice(0, 12000),
      language: input.language?.slice(0, 40),
      tone: input.tone?.slice(0, 20),
      senderName: user.name,
      companyName: tenant?.docCompanyName || tenant?.name,
    },
  };
}

/**
 * 纯翻译走谷歌：WhatsApp 一律走谷歌；邮件不超过 MAIL_GOOGLE_MAX 字走谷歌，更长的用 AI。
 * 返回要翻译的文字，不该走谷歌时返回 null。
 */
export function googleTranslateText(input: { mode: string; draft: string; original?: string; language?: string; channel: string }) {
  if (input.mode !== "translate") return null;
  if (!googleLang(input.language)) return null;
  const text = (input.draft || input.original || "").trim();
  if (!text) return null;
  if (input.channel === "email" && text.length > MAIL_GOOGLE_MAX) return null;
  return text;
}
