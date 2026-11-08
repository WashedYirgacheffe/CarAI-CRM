import "server-only";

/**
 * AI 调用：Anthropic Messages 兼容接口（默认 moonup.dev 上的 DeepSeek），换模型只改环境变量。
 *   AI_BASE_URL  接口地址，默认 https://moonup.dev
 *   AI_API_KEY   密钥（只放服务器 .env，不进仓库）
 *   AI_MODEL     模型名，默认 deepseek-v4.1-flash-1017
 */
const BASE_URL = (process.env.AI_BASE_URL || "https://moonup.dev").replace(/\/+$/, "");
const MODEL = process.env.AI_MODEL || "deepseek-v4.1-flash-1017";

export function aiConfigured() {
  return !!process.env.AI_API_KEY;
}

export class AiError extends Error {}

type Msg = { role: "user" | "assistant"; content: string };

export async function aiComplete({
  system,
  messages,
  maxTokens = 2000,
  temperature,
  timeoutMs = 90_000,
}: {
  system?: string;
  messages: Msg[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new AiError("还没有配置 AI（服务器 .env 中的 AI_API_KEY）");
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new AiError(`AI 服务连接失败：${(e as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiError(`AI 服务返回错误 ${res.status}：${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (json.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new AiError("AI 没有返回内容，请重试");
  return text;
}

/** 让模型只输出 JSON，并解析出第一个 JSON 对象 */
export async function aiJson<T>(opts: Parameters<typeof aiComplete>[0]): Promise<T> {
  const text = await aiComplete(opts);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("AI 返回的格式不正确，请重试");
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    throw new AiError("AI 返回的格式不正确，请重试");
  }
}

/** 截断长文本，控制 token 用量 */
export function clip(text: string | null | undefined, max = 6000) {
  if (!text) return "";
  const t = text.replace(/\n{3,}/g, "\n\n").trim();
  return t.length > max ? `${t.slice(0, max)}\n…（已截断）` : t;
}

// ── 邮件意图 ──

export const MAIL_INTENTS: Record<string, string> = {
  inquiry: "询盘",
  quotation: "询价议价",
  order: "下单",
  sample: "样品",
  complaint: "投诉售后",
  logistics: "物流",
  payment: "付款",
  marketing: "推广营销",
  other: "其他",
};

export const MAIL_PRIORITIES: Record<string, string> = { high: "高", medium: "中", low: "低" };

export type MailAnalysis = { summary: string; intent: string; priority: string };

export async function analyzeMail(input: { from: string; subject: string; text: string }): Promise<MailAnalysis> {
  const r = await aiJson<Partial<MailAnalysis>>({
    system:
      "你是外贸业务助理，负责给业务员分拣来信。只输出一个 JSON 对象，不要输出其他内容。",
    messages: [
      {
        role: "user",
        content: `分析这封邮件，输出 JSON：
{"summary": "用简体中文一到两句话概括对方说了什么、要什么（不超过 80 字）",
 "intent": "${Object.keys(MAIL_INTENTS).join(" | ")} 之一",
 "priority": "high | medium | low（询盘、下单、投诉、付款问题为 high；一般往来 medium；推广营销、通知类 low）"}

发件人：${input.from}
主题：${input.subject}
正文：
${clip(input.text, 4000)}`,
      },
    ],
    maxTokens: 1500,
  });
  return {
    summary: String(r.summary ?? "").slice(0, 300),
    intent: r.intent && r.intent in MAIL_INTENTS ? r.intent : "other",
    priority: r.priority && r.priority in MAIL_PRIORITIES ? r.priority : "medium",
  };
}

// ── 写作助手 ──

export const WRITE_MODES = {
  compose: "根据要点写信",
  reply: "生成回复",
  polish: "润色",
  translate: "翻译",
} as const;

export type WriteMode = keyof typeof WRITE_MODES;

export async function aiWrite(input: {
  mode: WriteMode;
  /** 当前草稿或要点 */
  draft: string;
  /** 回复时的原文 */
  original?: string;
  /** 目标语言，如 English、Español；润色 / 回复时默认与原文一致 */
  language?: string;
  /** 语气：正式 / 友好 / 简洁 */
  tone?: string;
  channel: "email" | "whatsapp";
  senderName?: string;
  companyName?: string;
}) {
  const channel = input.channel === "email" ? "商务邮件" : "WhatsApp 消息（简短口语化，不要邮件格式，不要签名）";
  const lang = input.language || "";
  const tone = input.tone ? `语气：${input.tone}。` : "";
  const who = [input.senderName, input.companyName].filter(Boolean).join("，");
  let task: string;
  switch (input.mode) {
    case "compose":
      task = `按下面的要点写一封外贸${channel}。${lang ? `用 ${lang} 写。` : "用英文写。"}${tone}只输出正文${input.channel === "email" ? "（不要主题行）" : ""}。\n\n要点：\n${clip(input.draft, 3000)}`;
      break;
    case "reply":
      task = `替我回复下面这条来信，写一封外贸${channel}。${lang ? `用 ${lang} 写。` : "用与来信相同的语言写。"}${tone}${
        input.draft.trim() ? `我想表达的要点：\n${clip(input.draft, 2000)}\n\n` : "没有要点时，礼貌回应对方的问题，需要我方确认的信息用 [方括号] 标出。\n\n"
      }只输出回复正文。\n\n来信：\n${clip(input.original, 4000)}`;
      break;
    case "polish":
      task = `润色下面这段外贸${channel}，修正语法和措辞，更地道专业，意思不变。${lang ? `用 ${lang} 输出。` : "保持原语言。"}${tone}只输出润色后的正文。\n\n${clip(input.draft, 5000)}`;
      break;
    case "translate":
      task = `把下面的内容翻译成${lang || "简体中文"}，保留格式，只输出译文。\n\n${clip(input.draft || input.original, 6000)}`;
      break;
  }
  return aiComplete({
    system: `你是资深外贸业务员的写作助手${who ? `，我是 ${who}` : ""}。行文专业、礼貌、简洁，不夸大，不编造价格、交期等具体数字。`,
    messages: [{ role: "user", content: task }],
    maxTokens: 3000,
  });
}
