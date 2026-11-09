// 工作台卡片目录（前后端共用）。顺序即默认顺序；side 的卡片放在右侧窄栏。

export const DASHBOARD_CARDS = [
  { key: "hero", label: "本月业绩", desc: "本月成交额与上月同期对比，回款、询盘、跟进的 30 天走势", wide: true },
  { key: "overview", label: "数据概览", desc: "客户、待跟进、商机、本月订单、新线索、未读消息", wide: true },
  { key: "today", label: "今天要做", desc: "今天到期和已逾期的日程" },
  { key: "trend", label: "成交趋势", desc: "近 6 个月订单金额（折合人民币）" },
  { key: "funnel", label: "本月转化漏斗", desc: "询盘 → 客户 → 商机 → 报价 → 订单，每一步的转化" },
  { key: "heatmap", label: "我的活跃度", desc: "近半年每天的跟进、发邮件、发 WhatsApp 次数" },
  { key: "comms", label: "沟通量", desc: "近 14 天邮件和 WhatsApp 的收发条数" },
  { key: "recent", label: "最近跟进", desc: "团队最近写的跟进记录" },
  { key: "health", label: "客户健康度", desc: "我的客户按最近联系时间分段，以及将进公海的客户", side: true },
  { key: "pipeline", label: "商机阶段", desc: "进行中的商机在各阶段的数量", side: true },
  { key: "distribution", label: "客户分布", desc: "我的客户按状态、国家、分组的分布", side: true },
  { key: "clock", label: "世界时钟", desc: "客户所在国家的当地时间，是否在工作时间", side: true },
  { key: "fx", label: "汇率换算", desc: "按企业汇率表换算报价金额", side: true },
] as const;

export const LAYOUT_V2 = "~v2";
const V2_CARDS = ["funnel", "heatmap", "comms", "health"];

export type DashboardCardKey = (typeof DASHBOARD_CARDS)[number]["key"];

export const DEFAULT_DASHBOARD: DashboardCardKey[] = DASHBOARD_CARDS.map((c) => c.key);

/** 用户保存的布局 → 合法的卡片 key（去重、去掉已下线的卡片）；空表示默认布局 */
export function resolveDashboard(saved: string[] | null | undefined): DashboardCardKey[] {
  if (!saved?.length) return DEFAULT_DASHBOARD;
  const valid = new Set<string>(DEFAULT_DASHBOARD);
  // 新版卡片上线前保存的布局：把新卡片补进去（之后保存会带上 LAYOUT_V2 标记，用户再隐藏就不会补回）
  const list = saved.includes(LAYOUT_V2) ? saved : ["hero", ...saved, ...V2_CARDS];
  return [...new Set(list)].filter((k): k is DashboardCardKey => valid.has(k));
}

// ── 世界时钟 ──

/** 国家 → 代表时区（多时区国家取商业中心） */
export const COUNTRY_TZ: Record<string, string> = {
  CN: "Asia/Shanghai", HK: "Asia/Hong_Kong", TW: "Asia/Taipei", JP: "Asia/Tokyo", KR: "Asia/Seoul", SG: "Asia/Singapore",
  MY: "Asia/Kuala_Lumpur", TH: "Asia/Bangkok", VN: "Asia/Ho_Chi_Minh", ID: "Asia/Jakarta", PH: "Asia/Manila", IN: "Asia/Kolkata",
  PK: "Asia/Karachi", BD: "Asia/Dhaka", LK: "Asia/Colombo", NP: "Asia/Kathmandu", MM: "Asia/Yangon", KH: "Asia/Phnom_Penh",
  AE: "Asia/Dubai", SA: "Asia/Riyadh", QA: "Asia/Qatar", KW: "Asia/Kuwait", OM: "Asia/Muscat", BH: "Asia/Bahrain",
  IL: "Asia/Jerusalem", JO: "Asia/Amman", LB: "Asia/Beirut", IQ: "Asia/Baghdad", IR: "Asia/Tehran", TR: "Europe/Istanbul",
  KZ: "Asia/Almaty", UZ: "Asia/Tashkent", RU: "Europe/Moscow", UA: "Europe/Kyiv", BY: "Europe/Minsk",
  GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris", DE: "Europe/Berlin", IT: "Europe/Rome", ES: "Europe/Madrid",
  PT: "Europe/Lisbon", NL: "Europe/Amsterdam", BE: "Europe/Brussels", CH: "Europe/Zurich", AT: "Europe/Vienna", PL: "Europe/Warsaw",
  CZ: "Europe/Prague", HU: "Europe/Budapest", RO: "Europe/Bucharest", BG: "Europe/Sofia", GR: "Europe/Athens", SE: "Europe/Stockholm",
  NO: "Europe/Oslo", DK: "Europe/Copenhagen", FI: "Europe/Helsinki", EE: "Europe/Tallinn", LV: "Europe/Riga", LT: "Europe/Vilnius",
  HR: "Europe/Zagreb", RS: "Europe/Belgrade", SK: "Europe/Bratislava", SI: "Europe/Ljubljana",
  US: "America/New_York", CA: "America/Toronto", MX: "America/Mexico_City", BR: "America/Sao_Paulo", AR: "America/Argentina/Buenos_Aires",
  CL: "America/Santiago", CO: "America/Bogota", PE: "America/Lima", EC: "America/Guayaquil", VE: "America/Caracas",
  PA: "America/Panama", CR: "America/Costa_Rica", GT: "America/Guatemala", DO: "America/Santo_Domingo", UY: "America/Montevideo",
  PY: "America/Asuncion", BO: "America/La_Paz", PR: "America/Puerto_Rico",
  AU: "Australia/Sydney", NZ: "Pacific/Auckland", PG: "Pacific/Port_Moresby", FJ: "Pacific/Fiji",
  EG: "Africa/Cairo", ZA: "Africa/Johannesburg", NG: "Africa/Lagos", KE: "Africa/Nairobi", ET: "Africa/Addis_Ababa", GH: "Africa/Accra",
  MA: "Africa/Casablanca", DZ: "Africa/Algiers", TN: "Africa/Tunis", TZ: "Africa/Dar_es_Salaam", UG: "Africa/Kampala",
  AO: "Africa/Luanda", CI: "Africa/Abidjan", SN: "Africa/Dakar", CM: "Africa/Douala", ZM: "Africa/Lusaka", ZW: "Africa/Harare",
};

/** 没有客户数据时默认显示的时钟 */
export const DEFAULT_CLOCK_COUNTRIES = ["US", "GB", "DE", "AE", "BR"];

const SIDE = new Set<string>(DASHBOARD_CARDS.filter((c) => "side" in c && c.side).map((c) => c.key));
export const isSideCard = (k: DashboardCardKey) => SIDE.has(k);
