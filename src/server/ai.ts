import "server-only";

/**
 * AI 调用：OpenAI Chat Completions 兼容接口（默认 moonup.dev 上的 DeepSeek），换模型只改环境变量。
 *   AI_BASE_URL  接口地址，默认 https://moonup.dev
 *   AI_API_KEY   密钥（只放服务器 .env，不进仓库）
 *   AI_MODEL     模型名，默认 deepseek-v4.1-flash-1017
 *
 * 一律关闭「思考」：这些都是摘要、写信、分类之类的活，不需要推理；开着思考时模型先想几百上千字，
 * 既慢（多 3～5 秒），又会把 max_tokens 用光导致「没有返回内容」。
 */
const BASE_URL = (process.env.AI_BASE_URL || "https://moonup.dev").replace(/\/+$/, "");
const MODEL = process.env.AI_MODEL || "deepseek-v4.1-flash-1017";

export function aiConfigured() {
  return !!process.env.AI_API_KEY;
}

export class AiError extends Error {}

type Msg = { role: "user" | "assistant"; content: string };
export type AiOptions = { system?: string; messages: Msg[]; maxTokens?: number; temperature?: number; timeoutMs?: number };

/** 带工具调用的对话消息（OpenAI 格式） */
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "user" | "system"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
type RawOptions = Omit<AiOptions, "messages"> & { messages: ChatMessage[]; tools?: ToolSpec[]; toolChoice?: "auto" | "none" };

/**
 * 这个网关会丢掉 system / developer 角色的消息（实测模型完全看不到），
 * 所以把系统指令包进第一条用户消息里，模型才会遵守。
 */
function withInstructions(system: string | undefined, messages: ChatMessage[]): ChatMessage[] {
  if (!system) return messages;
  const i = messages.findIndex((m) => m.role === "user");
  const wrap = (body: string) => `<instructions>\n${system}\n</instructions>\n\n${body}`;
  if (i < 0) return [{ role: "user", content: wrap("") }, ...messages];
  return messages.map((m, j) => (j === i ? { ...m, content: wrap(m.content as string) } : m)) as ChatMessage[];
}

/** 网关偶尔抽风（Cloudflare 502 / 限流），这些状态自动重试 */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 520, 522, 524]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 给用户看的错误：不把网关返回的整页 HTML 甩出去 */
function friendlyError(status: number, body: string) {
  if (status === 401 || status === 403) return "AI 服务的密钥无效或没有权限，请管理员检查 AI 配置";
  if (status === 429) return "AI 服务现在请求太多，请稍后再试";
  if (status >= 500) return "AI 服务暂时不可用（上游网关出错），请稍后重试";
  const text = /^\s*</.test(body) ? "" : body.replace(/\s+/g, " ").slice(0, 160);
  return `AI 服务返回错误 ${status}${text ? `：${text}` : ""}`;
}

async function request(opts: RawOptions, stream: boolean): Promise<Response> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new AiError("还没有配置 AI（服务器 .env 中的 AI_API_KEY）");
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 2000,
    thinking: { type: "disabled" },
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(stream ? { stream: true } : {}),
    ...(opts.tools?.length ? { tools: opts.tools, ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}) } : {}),
    messages: withInstructions(opts.system, opts.messages),
  });
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= 2;
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(Math.max(5_000, deadline - Date.now())),
      });
    } catch (e) {
      const timeout = (e as Error).name === "TimeoutError";
      if (!timeout && !last) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw new AiError(timeout ? "AI 响应超时，请重试" : "AI 服务连接失败，请检查网络后重试");
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    if (RETRY_STATUS.has(res.status) && !last && deadline - Date.now() > 8_000) {
      console.warn(`[ai] ${res.status}，第 ${attempt + 1} 次重试`);
      await sleep(800 * (attempt + 1));
      continue;
    }
    console.error(`[ai] ${res.status}`, text.replace(/\s+/g, " ").slice(0, 200));
    throw new AiError(friendlyError(res.status, text));
  }
}

export async function aiComplete(opts: AiOptions): Promise<string> {
  // 偶发空回复（网关抖动）时自动再试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await request(opts, false);
    const json = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string | null } }[] };
    const text = (json.choices?.[0]?.message?.content ?? "").trim();
    if (text) return text;
  }
  throw new AiError("AI 没有返回内容，请重试");
}

/** 流式输出：边生成边返回文字片段，用于写信助手，让结果一两秒内就开始出现 */
export async function* aiStream(opts: AiOptions): AsyncGenerator<string> {
  const res = await request(opts, true);
  if (!res.body) throw new AiError("AI 没有返回内容，请重试");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const piece = (JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] }).choices?.[0]?.delta?.content;
        if (piece) yield piece;
      } catch {
        // 心跳或不完整的行，忽略
      }
    }
  }
}

export type ToolStreamEvent = { type: "text"; text: string } | { type: "tools"; calls: ToolCall[] };

/**
 * 流式 + 工具调用：文字片段边生成边吐出；结束时如果模型要调工具，最后吐一个 tools 事件。
 * 工具参数是分片到达的，按 index 拼起来。
 */
export async function* aiToolStream(opts: RawOptions): AsyncGenerator<ToolStreamEvent> {
  const res = await request(opts, true);
  if (!res.body) throw new AiError("AI 没有返回内容，请重试");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const calls: ToolCall[] = [];
  let buf = "";
  type Delta = { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] };
  outer: for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") break outer;
      let delta: Delta | undefined;
      try {
        delta = (JSON.parse(data) as { choices?: { delta?: Delta }[] }).choices?.[0]?.delta;
      } catch {
        continue;
      }
      if (delta?.content) yield { type: "text", text: delta.content };
      for (const tc of delta?.tool_calls ?? []) {
        const k = tc.index ?? calls.length;
        calls[k] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
        if (tc.id) calls[k].id = tc.id;
        if (tc.function?.name) calls[k].function.name += tc.function.name;
        if (tc.function?.arguments) calls[k].function.arguments += tc.function.arguments;
      }
    }
  }
  const done = calls.filter((c) => c && c.function.name);
  done.forEach((c, i) => (c.id ||= `call_${i}`));
  if (done.length) yield { type: "tools", calls: done };
}

/** 让模型只输出 JSON，并解析出第一个 JSON 对象 */
export async function aiJson<T>(opts: AiOptions): Promise<T> {
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
    system: "你是外贸业务助理，负责给业务员分拣来信。只输出一个 JSON 对象，不要输出其他内容。",
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

export type WriteInput = {
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
};

export function writePrompt(input: WriteInput): AiOptions {
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
        input.draft.trim()
          ? `我想表达的要点：\n${clip(input.draft, 2000)}\n\n`
          : "没有要点时，礼貌回应对方的问题，需要我方确认的信息用 [方括号] 标出。\n\n"
      }只输出回复正文。\n\n来信：\n${clip(input.original, 4000)}`;
      break;
    case "polish":
      task = `润色下面这段外贸${channel}，修正语法和措辞，更地道专业，意思不变。${lang ? `用 ${lang} 输出。` : "保持原语言。"}${tone}只输出润色后的正文。\n\n${clip(input.draft, 5000)}`;
      break;
    case "translate":
      task = `把下面的内容翻译成${lang || "简体中文"}，保留格式，只输出译文。\n\n${clip(input.draft || input.original, 6000)}`;
      break;
  }
  return {
    system: `你是资深外贸业务员的写作助手${who ? `，我是 ${who}` : ""}。行文专业、礼貌、简洁，不夸大，不编造价格、交期等具体数字。`,
    messages: [{ role: "user", content: task }],
    maxTokens: 3000,
  };
}

export async function aiWrite(input: WriteInput) {
  return aiComplete(writePrompt(input));
}
