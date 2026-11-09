// 工作台卡片目录（前后端共用）。顺序即默认顺序。

export const DASHBOARD_CARDS = [
  { key: "overview", label: "数据概览", desc: "客户、待跟进、商机、本月订单、新线索、未读消息", wide: true },
  { key: "today", label: "今天要做", desc: "今天到期和已逾期的日程" },
  { key: "recent", label: "最近跟进", desc: "团队最近写的跟进记录" },
  { key: "clock", label: "世界时钟", desc: "客户所在国家的当地时间，是否在工作时间" },
  { key: "fx", label: "汇率换算", desc: "按企业汇率表换算报价金额" },
] as const;

export type DashboardCardKey = (typeof DASHBOARD_CARDS)[number]["key"];

export const DEFAULT_DASHBOARD: DashboardCardKey[] = DASHBOARD_CARDS.map((c) => c.key);

/** 用户保存的布局 → 合法的卡片 key（去重、去掉已下线的卡片）；空表示默认布局 */
export function resolveDashboard(saved: string[] | null | undefined): DashboardCardKey[] {
  if (!saved?.length) return DEFAULT_DASHBOARD;
  const valid = new Set<string>(DEFAULT_DASHBOARD);
  return [...new Set(saved)].filter((k): k is DashboardCardKey => valid.has(k));
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
