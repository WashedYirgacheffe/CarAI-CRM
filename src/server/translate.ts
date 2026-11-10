import "server-only";

/**
 * 谷歌翻译（免密钥，Chrome 划词翻译用的接口）：半秒内出结果，比让大模型翻译快得多。
 * 只做「纯翻译」；失败时由调用方退回 AI 翻译。
 */
const LANG_CODES: Record<string, string> = {
  English: "en",
  Español: "es",
  Français: "fr",
  Deutsch: "de",
  Português: "pt",
  Italiano: "it",
  Русский: "ru",
  العربية: "ar",
  Türkçe: "tr",
  日本語: "ja",
  한국어: "ko",
  "Tiếng Việt": "vi",
  "Bahasa Indonesia": "id",
  简体中文: "zh-CN",
};

export const googleLang = (language: string | undefined) => LANG_CODES[language || "简体中文"] ?? null;

/** 邮件超过这个长度用 AI 翻译（长信上下文连贯、术语更准），短的走谷歌；WhatsApp 一律走谷歌 */
export const MAIL_GOOGLE_MAX = 1500;

/** 按段落切块，每块不超过 limit 个字符（接口单次上限约 5000） */
function chunks(text: string, limit = 4000) {
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/(?<=\n)/)) {
    if (cur.length + para.length > limit && cur) {
      out.push(cur);
      cur = "";
    }
    if (para.length > limit) {
      for (let i = 0; i < para.length; i += limit) out.push(para.slice(i, i + limit));
    } else cur += para;
  }
  if (cur) out.push(cur);
  return out;
}

export async function googleTranslate(text: string, language: string | undefined): Promise<string> {
  const tl = googleLang(language);
  if (!tl) throw new Error("unsupported language");
  const parts = chunks(text.trim());
  if (!parts.length) return "";
  const body = new URLSearchParams();
  for (const p of parts) body.append("q", p);
  const res = await fetch(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${tl}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`google ${res.status}`);
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) throw new Error("google bad response");
  // 每段返回 [译文, 源语言]，个别情况下直接是字符串
  const out = json.map((x) => (Array.isArray(x) ? String(x[0] ?? "") : String(x ?? ""))).join("");
  if (!out.trim()) throw new Error("google empty");
  return out;
}
