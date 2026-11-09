/** WhatsApp 风格的时间显示（都按企业时区） */

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function parts(d: Date | string, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(d))
    .reduce<Record<string, string>>((o, x) => ((o[x.type] = x.value), o), {});
  return { y: +p.year, m: +p.month, d: +p.day, hm: `${p.hour}:${p.minute}`, ymd: `${p.year}-${p.month}-${p.day}` };
}

/** 两个本地日期相差几天（a - b） */
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

/** 消息气泡里的时间：14:05 */
export const waClock = (d: Date | string, tz: string) => parts(d, tz).hm;

/** 本地日期 yyyy-mm-dd，用来给消息按天分组 */
export const waDayKey = (d: Date | string, tz: string) => parts(d, tz).ymd;

/** 会话列表右上角：今天 14:05 / 昨天 / 周三 / 3月5日 / 2025/3/5 */
export function waListTime(d: Date | string, tz: string, now = new Date()) {
  const a = parts(d, tz);
  const n = parts(now, tz);
  const diff = dayDiff(n.ymd, a.ymd);
  if (diff <= 0) return a.hm;
  if (diff === 1) return "昨天";
  if (diff < 7) return WEEK[new Date(`${a.ymd}T00:00:00Z`).getUTCDay()];
  return a.y === n.y ? `${a.m}月${a.d}日` : `${a.y}/${a.m}/${a.d}`;
}

/** 聊天里的日期分隔：今天 / 昨天 / 周三 / 3月5日 / 2025年3月5日 */
export function waDayLabel(dayKey: string, tz: string, now = new Date()) {
  const n = parts(now, tz);
  const diff = dayDiff(n.ymd, dayKey);
  const [y, m, d] = dayKey.split("-").map(Number);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff < 7) return WEEK[new Date(`${dayKey}T00:00:00Z`).getUTCDay()];
  return y === n.y ? `${m}月${d}日` : `${y}年${m}月${d}日`;
}
