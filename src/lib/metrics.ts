// 指标库（前后端共用）：AI 只能从这里挑指标、维度、时间范围、图表类型，不写 SQL，口径和报表一致。

export const METRICS = [
  { key: "deal_amount", label: "成交额", unit: "cny", desc: "订单金额（不含取消 / 草稿），按订单日期，折合人民币" },
  { key: "order_count", label: "订单数", unit: "count", desc: "订单数量，按订单日期" },
  { key: "payment_amount", label: "回款额", unit: "cny", desc: "已登记的回款，按到账日期，折合人民币" },
  { key: "quote_amount", label: "报价额", unit: "cny", desc: "报价单金额，按报价日期，折合人民币" },
  { key: "quote_count", label: "报价单数", unit: "count", desc: "报价单数量，按报价日期" },
  { key: "lead_count", label: "新询盘", unit: "count", desc: "新建的线索数" },
  { key: "customer_count", label: "新客户", unit: "count", desc: "新建的客户数" },
  { key: "followup_count", label: "跟进次数", unit: "count", desc: "写的跟进记录数" },
  { key: "mail_sent", label: "发出邮件", unit: "count", desc: "发出的邮件数" },
  { key: "wa_sent", label: "WhatsApp 发出", unit: "count", desc: "发出的 WhatsApp 消息数" },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];

/** time 按时间；member 按成员；country 按客户国家；source 按来源 */
export const DIMENSIONS = [
  { key: "time", label: "按时间" },
  { key: "member", label: "按成员" },
  { key: "country", label: "按国家" },
  { key: "source", label: "按来源" },
] as const;
export type DimensionKey = (typeof DIMENSIONS)[number]["key"];

/** 每个指标支持哪些维度（不支持的维度数据里没有） */
export const METRIC_DIMS: Record<MetricKey, DimensionKey[]> = {
  deal_amount: ["time", "member", "country"],
  order_count: ["time", "member", "country"],
  payment_amount: ["time", "member"],
  quote_amount: ["time", "member", "country"],
  quote_count: ["time", "member", "country"],
  lead_count: ["time", "member", "country", "source"],
  customer_count: ["time", "member", "country", "source"],
  followup_count: ["time", "member"],
  mail_sent: ["time", "member"],
  wa_sent: ["time", "member"],
};

export const RANGES = [
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "month", label: "本月" },
  { key: "last-month", label: "上月" },
  { key: "quarter", label: "本季度" },
  { key: "6m", label: "近 6 个月" },
  { key: "year", label: "今年" },
  { key: "12m", label: "近 12 个月" },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

export const CHARTS = [
  { key: "bar", label: "柱状图" },
  { key: "hbar", label: "排行条" },
  { key: "donut", label: "环形图" },
] as const;
export type ChartKey = (typeof CHARTS)[number]["key"];

export const metricDef = (k: string) => METRICS.find((m) => m.key === k);
export const rangeLabel = (k: string) => RANGES.find((r) => r.key === k)?.label ?? "本月";
export const isMetric = (k: unknown): k is MetricKey => typeof k === "string" && METRICS.some((m) => m.key === k);
export const isDim = (k: unknown): k is DimensionKey => typeof k === "string" && DIMENSIONS.some((d) => d.key === k);
export const isRange = (k: unknown): k is RangeKey => typeof k === "string" && RANGES.some((r) => r.key === k);
export const isChart = (k: unknown): k is ChartKey => typeof k === "string" && CHARTS.some((c) => c.key === k);

export type MetricPoint = { label: string; value: number };
export type MetricResult = {
  metric: MetricKey;
  by: DimensionKey;
  range: RangeKey;
  title: string;
  unit: "cny" | "count";
  total: number;
  points: MetricPoint[];
  /** 时间维度的分桶：day / month */
  bucket?: "day" | "month";
};

export type TeamRow = {
  id: string;
  name: string;
  deal: number;
  orders: number;
  quotes: number;
  followups: number;
  customers: number;
  leads: number;
};
