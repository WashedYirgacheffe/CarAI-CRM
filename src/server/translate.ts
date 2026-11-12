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

/** 多段一起翻：每段一个 q，返回与输入等长的译文数组（邮件嵌入式翻译用） */
export async function googleTranslateMany(texts: string[], language: string | undefined): Promise<string[]> {
  // 谷歌会吞掉段内换行：按行拆开翻译，再按原来的行拼回去
  const lines = texts.map((t) => t.split("\n"));
  const flat = lines.flat();
  const nonEmpty = flat.map((l, i) => [l, i] as const).filter(([l]) => l.trim());
  const tr = await googleTranslateLines(
    nonEmpty.map(([l]) => l),
    language,
  );
  const outFlat = flat.map(() => "");
  nonEmpty.forEach(([, i], k) => (outFlat[i] = tr[k]));
  let p = 0;
  return lines.map((ls) => outFlat.slice(p, (p += ls.length)).join("\n"));
}

async function googleTranslateLines(texts: string[], language: string | undefined): Promise<string[]> {
  const tl = googleLang(language);
  if (!tl) throw new Error("unsupported language");
  // 按总长分批，每批不超过约 4500 字符
  const batches: number[][] = [];
  let cur: number[] = [];
  let len = 0;
  texts.forEach((t, i) => {
    if (cur.length && (len + t.length > 4500 || cur.length >= 120)) {
      batches.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(i);
    len += t.length;
  });
  if (cur.length) batches.push(cur);
  const out: string[] = new Array(texts.length).fill("");
  await Promise.all(
    batches.map(async (idx) => {
      const body = new URLSearchParams();
      for (const i of idx) body.append("q", texts[i].slice(0, 4800));
      const res = await fetch(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${tl}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`google ${res.status}`);
      const json = (await res.json()) as unknown;
      if (!Array.isArray(json) || json.length !== idx.length) throw new Error("google bad response");
      json.forEach((x, k) => (out[idx[k]] = Array.isArray(x) ? String(x[0] ?? "") : String(x ?? "")));
    }),
  );
  if (!out.some((t) => t.trim())) throw new Error("google empty");
  return out;
}
