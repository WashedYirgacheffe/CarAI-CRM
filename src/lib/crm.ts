// CRM 共用常量与工具（前后端通用，不依赖服务端模块）

export const CUSTOMER_SOURCES = [
  "阿里巴巴国际站",
  "中国制造网",
  "环球资源",
  "独立站",
  "Google 搜索",
  "Google 广告",
  "Facebook / Instagram",
  "LinkedIn",
  "展会",
  "邮件开发",
  "WhatsApp",
  "海关数据",
  "老客户转介绍",
  "其他",
] as const;

export const CUSTOMER_TYPES = [
  "进口商 / 批发商",
  "品牌商",
  "零售商 / 连锁",
  "代理商 / 经销商",
  "工厂 / 制造商",
  "贸易公司",
  "电商卖家",
  "其他",
] as const;

export const FOLLOW_METHODS = [
  { value: "EMAIL", label: "邮件" },
  { value: "PHONE", label: "电话" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "WECHAT", label: "微信" },
  { value: "MEETING", label: "视频会议" },
  { value: "VISIT", label: "拜访 / 展会" },
  { value: "OTHER", label: "其他" },
] as const;

export type FollowMethodValue = (typeof FOLLOW_METHODS)[number]["value"];

export function followMethodLabel(v: string | null | undefined) {
  return FOLLOW_METHODS.find((m) => m.value === v)?.label ?? "";
}

export const CURRENCIES = ["USD", "EUR", "CNY", "GBP", "JPY", "AUD", "CAD", "HKD"] as const;

export const LEAD_STATUSES = [
  { value: "NEW", label: "新线索" },
  { value: "QUALIFYING", label: "完善信息" },
  { value: "CONTACTED", label: "联系互动" },
  { value: "CONVERTED", label: "已转客户" },
  { value: "INVALID", label: "无效" },
] as const;

/** 还在跟进中的线索状态 */
export const LEAD_OPEN_STATUSES = ["NEW", "QUALIFYING", "CONTACTED"] as const;

export const LEAD_INVALID_REASONS = ["垃圾询盘 / 广告", "同行套价", "联系方式无效", "需求不匹配", "重复线索", "长期无回复", "其他"] as const;

export const STATUS_COLORS: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
};
export const STATUS_COLOR_NAMES = Object.keys(STATUS_COLORS);

// ── 国家 / 地区 ──

/** 常用国家 / 地区（固定表：服务端与浏览器的 Intl 数据可能不同，避免水合不一致），按拼音排序 */
const COUNTRY_TABLE: [string, string][] = Object.entries({
  AL:"阿尔巴尼亚", DZ:"阿尔及利亚", AF:"阿富汗", AR:"阿根廷", AE:"阿拉伯联合酋长国", OM:"阿曼", AZ:"阿塞拜疆", EG:"埃及", ET:"埃塞俄比亚",
  IE:"爱尔兰", EE:"爱沙尼亚", AO:"安哥拉", AT:"奥地利", AU:"澳大利亚", PG:"巴布亚新几内亚", BS:"巴哈马", PK:"巴基斯坦", PY:"巴拉圭",
  PS:"巴勒斯坦领土", BH:"巴林", PA:"巴拿马", BR:"巴西", BY:"白俄罗斯", BG:"保加利亚", MK:"北马其顿", BJ:"贝宁", BE:"比利时",
  IS:"冰岛", PR:"波多黎各", PL:"波兰", BA:"波斯尼亚和黑塞哥维那", BO:"玻利维亚", BZ:"伯利兹", BW:"博茨瓦纳", BT:"不丹", BF:"布基纳法索",
  BI:"布隆迪", GQ:"赤道几内亚", DK:"丹麦", DE:"德国", TL:"东帝汶", TG:"多哥", DO:"多米尼加共和国", RU:"俄罗斯", EC:"厄瓜多尔",
  ER:"厄立特里亚", FR:"法国", PH:"菲律宾", FJ:"斐济", FI:"芬兰", GM:"冈比亚", CG:"刚果（布）", CD:"刚果（金）", CO:"哥伦比亚",
  CR:"哥斯达黎加", GE:"格鲁吉亚", CU:"古巴", GY:"圭亚那", KZ:"哈萨克斯坦", HT:"海地", KR:"韩国", NL:"荷兰", ME:"黑山",
  HN:"洪都拉斯", DJ:"吉布提", KG:"吉尔吉斯斯坦", GN:"几内亚", GW:"几内亚比绍", CA:"加拿大", GH:"加纳", GA:"加蓬", KH:"柬埔寨",
  CZ:"捷克", ZW:"津巴布韦", CM:"喀麦隆", QA:"卡塔尔", CI:"科特迪瓦", KW:"科威特", HR:"克罗地亚", KE:"肯尼亚", LV:"拉脱维亚",
  LS:"莱索托", LA:"老挝", LB:"黎巴嫩", LT:"立陶宛", LR:"利比里亚", LY:"利比亚", LU:"卢森堡", RW:"卢旺达", RO:"罗马尼亚",
  MG:"马达加斯加", MV:"马尔代夫", MT:"马耳他", MW:"马拉维", MY:"马来西亚", ML:"马里", MU:"毛里求斯", MR:"毛里塔尼亚", US:"美国",
  MN:"蒙古", BD:"孟加拉国", PE:"秘鲁", MM:"缅甸", MD:"摩尔多瓦", MA:"摩洛哥", MZ:"莫桑比克", MX:"墨西哥", NA:"纳米比亚", ZA:"南非",
  SS:"南苏丹", NI:"尼加拉瓜", NP:"尼泊尔", NE:"尼日尔", NG:"尼日利亚", NO:"挪威", PT:"葡萄牙", JP:"日本", SE:"瑞典", CH:"瑞士",
  SV:"萨尔瓦多", RS:"塞尔维亚", SL:"塞拉利昂", SN:"塞内加尔", CY:"塞浦路斯", SC:"塞舌尔", SA:"沙特阿拉伯", LK:"斯里兰卡", SK:"斯洛伐克",
  SI:"斯洛文尼亚", SZ:"斯威士兰", SD:"苏丹", SR:"苏里南", SO:"索马里", TJ:"塔吉克斯坦", TH:"泰国", TZ:"坦桑尼亚", TT:"特立尼达和多巴哥",
  TN:"突尼斯", TR:"土耳其", TM:"土库曼斯坦", GT:"危地马拉", VE:"委内瑞拉", BN:"文莱", UG:"乌干达", UA:"乌克兰", UY:"乌拉圭",
  UZ:"乌兹别克斯坦", ES:"西班牙", GR:"希腊", SG:"新加坡", NZ:"新西兰", HU:"匈牙利", SY:"叙利亚", JM:"牙买加", AM:"亚美尼亚",
  YE:"也门", IQ:"伊拉克", IR:"伊朗", IL:"以色列", IT:"意大利", IN:"印度", ID:"印度尼西亚", GB:"英国", JO:"约旦", VN:"越南",
  ZM:"赞比亚", TD:"乍得", CL:"智利", CF:"中非共和国", CN:"中国", MO:"中国澳门", TW:"中国台湾", HK:"中国香港",
});

const COUNTRY_MAP = new Map(COUNTRY_TABLE);

export function countryName(code: string | null | undefined) {
  if (!code) return "";
  return COUNTRY_MAP.get(code) ?? code;
}

export const COUNTRIES = COUNTRY_TABLE.map(([code, name]) => ({ code, name }));

// ── 查重 ──

const COMPANY_SUFFIXES =
  /\b(co|company|corp|corporation|inc|incorporated|ltd|limited|llc|llp|plc|gmbh|ag|sa|sas|sarl|srl|spa|bv|nv|oy|ab|as|pty|pte|kk|sdn bhd|bhd|trading|international|intl|group|holdings?)\b/g;

/** 公司名规范化：小写、去公司后缀、去标点空格。"ABC Trading Co., Ltd." 和 "abc trading co ltd" 视为同一家。 */
export function normalizeCompanyName(name: string) {
  const lower = name.normalize("NFKC").toLowerCase();
  const stripped = lower.replace(/[.,()（）&'"\-_/]/g, " ").replace(COMPANY_SUFFIXES, " ");
  const key = stripped.replace(/\s+/g, "");
  // 全是后缀（比如 "Trading Co"）时退回到不去后缀的版本
  return key || lower.replace(/\s+/g, "");
}

const PUBLIC_MAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com",
  "mail.ru", "yandex.ru", "qq.com", "163.com", "126.com", "foxmail.com", "sina.com", "gmx.de", "gmx.net",
  "web.de", "protonmail.com", "proton.me", "yahoo.co.uk", "hotmail.co.uk", "naver.com", "rediffmail.com",
]);

/** 从网址或邮箱中取出公司域名；公共邮箱（gmail 等）返回 null */
export function extractDomain(input: string | null | undefined) {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  if (host.includes("@")) host = host.split("@").pop() ?? "";
  host = host.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0].replace(/^www\./, "");
  if (!host.includes(".") || PUBLIC_MAIL_DOMAINS.has(host)) return null;
  return host;
}

// ── 时区与日期 ──

function tzOffsetMs(tz: string, date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

/** 企业时区下「今天」的起止时间 */
export function dayRange(tz: string, now = new Date()) {
  const offset = tzOffsetMs(tz, now);
  const local = new Date(now.getTime() + offset);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset;
  return { start: new Date(start), end: new Date(start + 86_400_000) };
}

/** 把 datetime-local / date 输入框的值按企业时区解析成 Date */
export function parseLocalInput(value: string | null | undefined, tz: string) {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 9), +(m[5] ?? 0));
  return new Date(naive - tzOffsetMs(tz, new Date(naive)));
}

/** Date → datetime-local 输入框的值（企业时区） */
export function toLocalInput(date: Date | string | null | undefined, tz: string, withTime = true) {
  if (!date) return "";
  const d = new Date(new Date(date).getTime() + tzOffsetMs(tz, new Date(date)));
  const iso = d.toISOString();
  return withTime ? iso.slice(0, 16) : iso.slice(0, 10);
}

export function formatDate(date: Date | string | null | undefined, tz: string) {
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(date),
  );
}

export function formatDateTime(date: Date | string | null | undefined, tz: string) {
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: tz,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(date));
}

/** n 天前的此刻 */
export function daysAgo(n: number, now = new Date()) {
  return new Date(now.getTime() - n * 86_400_000);
}

/** "3 天前"、"今天" 这类相对时间 */
export function relativeDays(date: Date | string | null | undefined, now = new Date()) {
  if (!date) return "从未";
  const days = Math.floor((now.getTime() - new Date(date).getTime()) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

export function formatMoney(amount: number | string, currency: string) {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
