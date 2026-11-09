/** 客户列表 / 客群共用的筛选字段（与 URL 参数同名） */
export const CUSTOMER_FILTER_KEYS = ["q", "status", "group", "star", "country", "tag", "owner", "follow", "idle"] as const;

export type CustomerFilterKey = (typeof CUSTOMER_FILTER_KEYS)[number];
export type SegmentFilters = Partial<Record<CustomerFilterKey, string>>;

export const FOLLOW_OPTIONS: { value: string; label: string }[] = [
  { value: "due", label: "今天及逾期待跟进" },
  { value: "stale", label: "超过 14 天未联系" },
  { value: "never", label: "从未跟进" },
  { value: "soon", label: "7 天内进公海" },
];

/** 从任意对象里挑出合法的筛选字段 */
export function pickSegmentFilters(src: Record<string, unknown>): SegmentFilters {
  const out: SegmentFilters = {};
  for (const k of CUSTOMER_FILTER_KEYS) {
    const v = src[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return out;
}

export function segmentQuery(f: SegmentFilters) {
  const sp = new URLSearchParams();
  for (const k of CUSTOMER_FILTER_KEYS) if (f[k]) sp.set(k, f[k]!);
  return sp.toString();
}
