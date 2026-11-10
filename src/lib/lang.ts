// 前后端共用的语言判断（只做粗判，决定要不要调 AI 翻译）

const letterCount = (s: string) => s.match(/[\p{L}]/gu)?.length ?? 0;
const cjkCount = (s: string) => s.match(/[㐀-鿿]/g)?.length ?? 0;

/** 外文：中文字符占比很低。minLetters 控制太短的不算（邮件 20，聊天消息 2） */
export function looksForeign(text: string, minLetters = 20) {
  const sample = text.slice(0, 1500);
  const letters = letterCount(sample);
  return letters >= minLetters && cjkCount(sample) / letters < 0.15;
}

/** 主要是中文写的 */
export function looksChinese(text: string) {
  const letters = letterCount(text);
  return letters > 0 && cjkCount(text) / letters >= 0.3;
}
