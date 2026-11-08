"use server";

import { prisma } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import { AiError, aiConfigured, aiWrite, WRITE_MODES, type WriteMode } from "@/server/ai";

export type AiResult = { ok: true; text: string } | { ok: false; message: string };

/** 写作助手：写信 / 回复 / 润色 / 翻译，邮件和 WhatsApp 共用 */
export async function aiWriteAction(input: {
  mode: WriteMode;
  draft: string;
  original?: string;
  language?: string;
  tone?: string;
  channel: "email" | "whatsapp";
}): Promise<AiResult> {
  const user = await requireUser();
  if (!can(user, "ai.use")) return { ok: false, message: "没有使用 AI 的权限" };
  if (!aiConfigured()) return { ok: false, message: "管理员还没有配置 AI 服务" };
  if (!(input.mode in WRITE_MODES)) return { ok: false, message: "不支持的操作" };
  if (!input.draft.trim() && !input.original?.trim()) {
    return { ok: false, message: input.mode === "compose" ? "先写几句要点，AI 帮你扩写成完整的信" : "没有可处理的内容" };
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true, docCompanyName: true } });
  try {
    const text = await aiWrite({
      ...input,
      draft: input.draft.slice(0, 8000),
      original: input.original?.slice(0, 12000),
      language: input.language?.slice(0, 40),
      tone: input.tone?.slice(0, 20),
      senderName: user.name,
      companyName: tenant?.docCompanyName || tenant?.name,
    });
    return { ok: true, text };
  } catch (e) {
    return { ok: false, message: e instanceof AiError ? e.message : "AI 处理失败，请稍后重试" };
  }
}
