// 收款计划和应收账龄：前后端通用

export type PlanLike = { id: string; label: string; amount: number; dueDate: Date | string };

export type PlanState = {
  id: string;
  label: string;
  amount: number;
  dueDate: Date;
  /** 这一期已经冲抵的金额 */
  paid: number;
  /** 这一期还欠多少 */
  due: number;
  /** 逾期天数（未逾期为 0） */
  overdueDays: number;
  state: "paid" | "partial" | "overdue" | "upcoming";
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 已收金额按到期日先后依次冲抵各期（today = 企业时区今天 0 点） */
export function allocatePlans(plans: PlanLike[], paidTotal: number, today: Date): PlanState[] {
  let left = paidTotal;
  return [...plans]
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .map((p) => {
      const amount = r2(p.amount);
      const paid = r2(Math.max(0, Math.min(amount, left)));
      left = r2(left - paid);
      const due = r2(amount - paid);
      const dueDate = new Date(p.dueDate);
      const overdueDays = due > 0 && dueDate < today ? Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000) : 0;
      const state: PlanState["state"] = due <= 0 ? "paid" : overdueDays > 0 ? "overdue" : paid > 0 ? "partial" : "upcoming";
      return { id: p.id, label: p.label, amount, dueDate, paid, due, overdueDays, state };
    });
}

export const AGING_BUCKETS = [
  { key: "current", label: "未到期", max: 0 },
  { key: "d30", label: "逾期 1–30 天", max: 30 },
  { key: "d60", label: "逾期 31–60 天", max: 60 },
  { key: "d90", label: "逾期 61–90 天", max: 90 },
  { key: "d90p", label: "逾期 90 天以上", max: Infinity },
] as const;

export const agingBucket = (overdueDays: number) => AGING_BUCKETS.findIndex((b) => overdueDays <= b.max);

/** 收款计划快捷模板：比例 + 到期日相对下单日 / 交货日的天数 */
export const PLAN_TEMPLATES = [
  {
    key: "30-70",
    label: "30% 定金 + 70% 发货前",
    parts: [
      { label: "定金 30%", pct: 30, from: "order" as const, days: 0 },
      { label: "尾款 70%（发货前）", pct: 70, from: "delivery" as const, days: -3 },
    ],
  },
  {
    key: "30-70-bl",
    label: "30% 定金 + 70% 见提单副本",
    parts: [
      { label: "定金 30%", pct: 30, from: "order" as const, days: 0 },
      { label: "尾款 70%（见提单副本）", pct: 70, from: "delivery" as const, days: 10 },
    ],
  },
  {
    key: "50-50",
    label: "50% 定金 + 50% 发货前",
    parts: [
      { label: "定金 50%", pct: 50, from: "order" as const, days: 0 },
      { label: "尾款 50%（发货前）", pct: 50, from: "delivery" as const, days: -3 },
    ],
  },
  { key: "100", label: "100% 预付", parts: [{ label: "全款", pct: 100, from: "order" as const, days: 0 }] },
  { key: "net30", label: "发货后 30 天付清", parts: [{ label: "全款（Net 30）", pct: 100, from: "delivery" as const, days: 30 }] },
] as const;

/** YYYY-MM-DD 加减天数 */
export function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
