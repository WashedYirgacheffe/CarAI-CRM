// 单据（报价单 / 订单）共用常量与计算，前后端通用

export const TRADE_TERMS = ["EXW", "FOB", "FCA", "CFR", "CIF", "CPT", "CIP", "DAP", "DDP"] as const;

export const PAYMENT_TERMS = [
  "T/T 30% deposit, 70% before shipment",
  "T/T 30% deposit, 70% against B/L copy",
  "T/T 100% in advance",
  "L/C at sight",
  "D/P at sight",
  "PayPal",
  "Western Union",
] as const;

export const PRODUCT_UNITS = ["pcs", "sets", "pairs", "boxes", "cartons", "kg", "tons", "meters", "rolls", "dozens"] as const;

export const PAYMENT_METHODS = ["T/T 电汇", "L/C 信用证", "PayPal", "西联", "支付宝 / 微信", "现金", "其他"] as const;

export const QUOTATION_STATUSES = [
  { value: "DRAFT", label: "草稿", color: "slate" },
  { value: "SENT", label: "已发送", color: "blue" },
  { value: "ACCEPTED", label: "已接受", color: "emerald" },
  { value: "REJECTED", label: "已拒绝", color: "rose" },
  { value: "EXPIRED", label: "已失效", color: "amber" },
] as const;

export const ORDER_STATUSES = [
  { value: "CONFIRMED", label: "已确认", color: "blue" },
  { value: "PRODUCING", label: "生产中", color: "violet" },
  { value: "SHIPPED", label: "已发货", color: "amber" },
  { value: "COMPLETED", label: "已完成", color: "emerald" },
  { value: "CANCELLED", label: "已取消", color: "slate" },
] as const;

export type QuotationStatusValue = (typeof QUOTATION_STATUSES)[number]["value"];
export type OrderStatusValue = (typeof ORDER_STATUSES)[number]["value"];

export function quotationStatus(v: string) {
  return QUOTATION_STATUSES.find((s) => s.value === v) ?? QUOTATION_STATUSES[0];
}
export function orderStatus(v: string) {
  return ORDER_STATUSES.find((s) => s.value === v) ?? ORDER_STATUSES[0];
}

// ── 金额计算 ──

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export type DocItemInput = {
  productId?: string | null;
  sku?: string | null;
  name: string;
  spec?: string | null;
  imageUrl?: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
};

export type DocFees = { discount: number; shippingFee: number; otherFee: number };

export function lineAmount(quantity: number, unitPrice: number) {
  return round2(quantity * unitPrice);
}

export function computeTotals(items: Pick<DocItemInput, "quantity" | "unitPrice">[], fees: DocFees) {
  const subtotal = round2(items.reduce((s, i) => s + lineAmount(i.quantity, i.unitPrice), 0));
  const total = round2(subtotal - fees.discount + fees.shippingFee + fees.otherFee);
  return { subtotal, total };
}

/** 按汇率把 from 币种的价格换成 to 币种（rates：1 外币 = x 人民币） */
export function convertPrice(price: number, from: string, to: string, rates: Record<string, number>) {
  if (from === to) return price;
  const a = rates[from];
  const b = rates[to];
  if (!a || !b) return price;
  return round4((price * a) / b);
}

/** 带两位小数的金额，单据上用 */
export function formatAmount(amount: number | string, currency?: string) {
  const n = typeof amount === "string" ? Number(amount) : amount;
  const s = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return currency ? `${currency} ${s}` : s;
}

/** 单价最多 4 位小数，去掉末尾的 0（至少保留 2 位） */
export function formatPrice(price: number | string) {
  const n = typeof price === "string" ? Number(price) : price;
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
}

export function formatQty(q: number | string) {
  const n = typeof q === "string" ? Number(q) : q;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
}

/** 英文日期，单据上用：Nov 07, 2026 */
export function formatDocDate(date: Date | string | null | undefined, tz: string) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "short", day: "2-digit" }).format(
    new Date(date),
  );
}

/** 今天（或 n 天后）在企业时区下的 yyyy-mm-dd，给 date 输入框做默认值 */
export function dateInput(tz: string, plusDays = 0, now = new Date()) {
  const d = new Date(now.getTime() + plusDays * 86_400_000);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

export function isPast(date: Date | string | null | undefined, now = new Date()) {
  return !!date && new Date(date).getTime() < now.getTime();
}

// ── 金额大写（英文），PI 上的 "SAY US DOLLARS ... ONLY" ──

const CURRENCY_WORDS: Record<string, string> = {
  USD: "US DOLLARS",
  EUR: "EUROS",
  CNY: "CHINESE YUAN",
  GBP: "POUNDS STERLING",
  JPY: "JAPANESE YEN",
  AUD: "AUSTRALIAN DOLLARS",
  CAD: "CANADIAN DOLLARS",
  HKD: "HONG KONG DOLLARS",
};

const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE",
  "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} HUNDRED`);
  if (r) {
    const words = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : "");
    parts.push(h ? `AND ${words}` : words);
  }
  return parts.join(" ");
}

export function integerToWords(n: number): string {
  if (n === 0) return "ZERO";
  const scales = ["", "THOUSAND", "MILLION", "BILLION"];
  const parts: string[] = [];
  for (let i = 0; n > 0 && i < scales.length; i++) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(below1000(chunk) + (scales[i] ? ` ${scales[i]}` : ""));
    n = Math.floor(n / 1000);
  }
  return parts.join(" ");
}

export function amountInWords(amount: number | string, currency: string) {
  const n = round2(Math.abs(Number(amount)));
  const whole = Math.floor(n);
  const cents = Math.round((n - whole) * 100);
  const cur = CURRENCY_WORDS[currency] ?? currency;
  return `SAY ${cur} ${integerToWords(whole)}${cents ? ` AND CENTS ${integerToWords(cents)}` : ""} ONLY`;
}
