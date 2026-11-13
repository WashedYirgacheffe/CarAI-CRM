/*
 * AI 穿透报告的结构（服务端生成、客户页展示共用）。
 * 每一条都带来源：网址、internal（我们自己的往来）、rdap（域名注册）、dns、gleif（全球法人识别码库）、comtrade（联合国贸易统计）。
 */

export type Confidence = "high" | "medium" | "low";

export type ResearchFact = {
  /** identity 公司身份 / business 业务和品类 / capacity 采购能力 / signal 动态和风险 */
  section: "identity" | "business" | "capacity" | "signal";
  label: string;
  value: string;
  source: string;
  confidence: Confidence;
};

export type ResearchPerson = { name: string; title?: string; email?: string; source: string; confidence: Confidence };

export type ResearchSignal = { level: "risk" | "note" | "good"; text: string; source: string };

export type TradeYear = { year: number; china: number | null; world: number | null; chinaKg: number | null };
export type TradeStat = { hs: string; product: string; country: string; years: TradeYear[] };

export const SUGGEST_FIELDS = {
  country: "国家",
  website: "官网",
  customerType: "客户类型",
  mainProducts: "主营产品",
  annualVolume: "年采购额",
  address: "地址",
} as const;
export type SuggestField = keyof typeof SUGGEST_FIELDS;

export type ResearchReport = {
  company: string;
  domain: string | null;
  website: string | null;
  facts: ResearchFact[];
  people: ResearchPerson[];
  signals: ResearchSignal[];
  trade: TradeStat[];
  summary: string;
  judgment: { score: number; potential: "high" | "medium" | "low"; contact: string; angle: string; next: string };
  suggestions: Partial<Record<SuggestField, { value: string; source: string }>>;
  /** 已经采用的建议字段 / 已经加成联系人的人名 */
  applied: string[];
  /** 这次用到的全部来源网址 */
  sources: { url: string; title: string }[];
};

export type ResearchStep = { key: string; label: string; state: "wait" | "run" | "done" | "skip" | "fail"; note?: string };

export const RESEARCH_STEPS: { key: string; label: string }[] = [
  { key: "identify", label: "确认是哪家公司" },
  { key: "site", label: "读官网" },
  { key: "search", label: "联网搜索" },
  { key: "registry", label: "查域名和注册信息" },
  { key: "trade", label: "查进口统计" },
  { key: "analyze", label: "整理和判断" },
];

export const SECTION_LABELS: Record<ResearchFact["section"], string> = {
  identity: "公司身份",
  business: "业务和品类",
  capacity: "采购能力",
  signal: "动态",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = { high: "可信", medium: "较可信", low: "待核实" };

/** 超过 90 天的报告提示可能过时 */
export const RESEARCH_STALE_DAYS = 90;

export function sourceLabel(source: string) {
  if (source === "internal") return "我们的往来";
  if (source === "rdap") return "域名注册信息";
  if (source === "dns") return "域名解析";
  if (source === "gleif") return "GLEIF 法人库";
  if (source === "comtrade") return "联合国贸易统计";
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch {
    return source;
  }
}

/** 外部查询入口：只给链接，不抓取 */
export function researchLinks(company: string, domain: string | null) {
  const q = encodeURIComponent(company);
  return [
    { label: "ImportYeti 看看", href: `https://www.importyeti.com/search?q=${q}` },
    { label: "LinkedIn", href: `https://www.linkedin.com/search/results/companies/?keywords=${q}` },
    { label: "谷歌", href: `https://www.google.com/search?q=${encodeURIComponent(domain ? `"${company}" OR site:${domain}` : `"${company}"`)}` },
  ];
}
