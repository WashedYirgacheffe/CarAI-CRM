/** 跟进提醒：场景预设 + 快捷时间。前后端共用 */
import { parseLocalInput, toLocalInput } from "@/lib/crm";

export type TimePreset = "h1" | "h2" | "eod" | "tomorrow" | "d2" | "d3" | "mon" | "w1" | "w2" | "m1";

export const TIME_PRESETS: { key: TimePreset; label: string }[] = [
  { key: "h1", label: "1 小时后" },
  { key: "h2", label: "2 小时后" },
  { key: "eod", label: "今天下班前" },
  { key: "tomorrow", label: "明天上午" },
  { key: "d2", label: "2 天后" },
  { key: "d3", label: "3 天后" },
  { key: "mon", label: "下周一" },
  { key: "w1", label: "1 周后" },
  { key: "w2", label: "2 周后" },
  { key: "m1", label: "1 个月后" },
];

/** 推迟提醒时给的选项 */
export const SNOOZE_PRESETS: TimePreset[] = ["h2", "tomorrow", "d3", "mon"];

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/**
 * 快捷时间 → datetime-local 的值（企业时区的墙上时间）。
 * 按天算的落在周末顺延到周一；「今天下班前」已过 17:00 时改为明天上午。
 */
export function presetLocal(p: TimePreset, tz: string, now = new Date()) {
  const [d, t] = toLocalInput(now, tz).split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const wall = new Date(Date.UTC(y, mo - 1, da, h, mi));
  const at = (days: number, hour = 9, min = 0, skipWeekend = true) => {
    const x = new Date(Date.UTC(y, mo - 1, da + days, hour, min));
    if (skipWeekend) while (x.getUTCDay() === 0 || x.getUTCDay() === 6) x.setUTCDate(x.getUTCDate() + 1);
    return x;
  };
  const roundUp = (ms: number) => {
    const x = new Date(wall.getTime() + ms);
    x.setUTCMinutes(Math.ceil(x.getUTCMinutes() / 5) * 5, 0, 0);
    return x;
  };
  switch (p) {
    case "h1":
      return fmt(roundUp(3_600_000));
    case "h2":
      return fmt(roundUp(7_200_000));
    case "eod":
      return fmt(h < 17 ? at(0, 17, 30, false) : at(1));
    case "tomorrow":
      return fmt(at(1));
    case "d2":
      return fmt(at(2));
    case "d3":
      return fmt(at(3));
    case "mon":
      return fmt(at((8 - wall.getUTCDay()) % 7 || 7));
    case "w1":
      return fmt(at(7));
    case "w2":
      return fmt(at(14));
    case "m1":
      return fmt(at(30));
  }
}

export function presetDate(p: TimePreset, tz: string, now = new Date()) {
  return parseLocalInput(presetLocal(p, tz, now), tz)!;
}

export type ReminderKind = {
  key: string;
  label: string;
  /** 默认提醒内容 */
  title: string;
  /** 默认多久后提醒 */
  when: TimePreset;
  /** 备注占位提示 */
  hint?: string;
};

export const REMINDER_GROUPS: { key: string; label: string; color: string; kinds: ReminderKind[] }[] = [
  {
    key: "inquiry",
    label: "询盘",
    color: "blue",
    kinds: [
      { key: "inquiry_reply", label: "回复询盘", title: "回复客户询盘", when: "h2" },
      { key: "inquiry_need", label: "等客户确认需求", title: "跟进客户需求（规格 / 数量 / 目标价）", when: "d2" },
      { key: "inquiry_silent", label: "询盘未回复", title: "客户未回复，再跟进一次", when: "d3" },
    ],
  },
  {
    key: "quote",
    label: "报价",
    color: "violet",
    kinds: [
      {
        key: "factory_quote",
        label: "等工厂报价",
        title: "工厂报价回来后，整理报价发给客户",
        when: "tomorrow",
        hint: "如：已问工厂王经理，答应周三前给价",
      },
      { key: "quote_followup", label: "报价后跟进", title: "报价已发，跟进客户意见", when: "d3" },
      { key: "quote_expire", label: "报价快到期", title: "报价有效期快到了，提醒客户下单", when: "w1" },
      { key: "price_adjust", label: "等内部审批价格", title: "价格审批结果出来后回复客户", when: "tomorrow" },
    ],
  },
  {
    key: "sample",
    label: "样品",
    color: "amber",
    kinds: [
      { key: "sample_make", label: "等工厂打样", title: "样品做好后拍照 / 寄出，通知客户", when: "d3" },
      { key: "sample_ship", label: "样品已寄出", title: "跟进样品物流，确认客户签收", when: "d3", hint: "快递单号" },
      { key: "sample_feedback", label: "等样品反馈", title: "询问客户样品测试结果", when: "w1" },
    ],
  },
  {
    key: "production",
    label: "生产 / 交期",
    color: "emerald",
    kinds: [
      { key: "factory_reply", label: "等工厂回复", title: "工厂回复后，第一时间答复客户", when: "tomorrow", hint: "在等工厂确认什么？" },
      { key: "lead_time", label: "确认交期", title: "跟工厂确认交期，同步给客户", when: "tomorrow" },
      { key: "production_update", label: "生产进度", title: "跟进生产进度，给客户发进度照片", when: "w1" },
      { key: "inspection", label: "验货", title: "安排验货 / 发验货报告给客户", when: "d3" },
    ],
  },
  {
    key: "logistics",
    label: "物流 / 船期",
    color: "blue",
    kinds: [
      { key: "booking", label: "等订舱 / 船期", title: "船期确认后通知客户", when: "d2", hint: "货代、目的港" },
      { key: "shipped", label: "已出货", title: "发提单 / 跟踪号和装箱单给客户", when: "tomorrow" },
      { key: "docs", label: "单证", title: "准备并寄出产地证 / 正本单据", when: "d3" },
      { key: "arrival", label: "到港提醒", title: "货物快到港，提醒客户清关提货", when: "w2" },
    ],
  },
  {
    key: "payment",
    label: "付款",
    color: "rose",
    kinds: [
      { key: "deposit", label: "催定金", title: "跟进定金付款，到账后安排生产", when: "d3" },
      { key: "balance", label: "催尾款", title: "出货前催尾款 / 见提单副本付款", when: "d3" },
      { key: "payment_check", label: "确认到账", title: "查收客户付款，回复水单", when: "tomorrow", hint: "客户说已付款，水单金额" },
    ],
  },
  {
    key: "after",
    label: "售后",
    color: "slate",
    kinds: [
      { key: "receipt_feedback", label: "收货回访", title: "回访客户收货和使用情况", when: "w2" },
      { key: "complaint", label: "处理投诉", title: "跟进客户投诉 / 质量问题的处理结果", when: "tomorrow" },
      { key: "reorder", label: "复购提醒", title: "客户可能该补货了，推荐返单", when: "m1" },
    ],
  },
  {
    key: "care",
    label: "客户关怀",
    color: "violet",
    kinds: [
      { key: "reactivate", label: "久未联系", title: "很久没联系了，发新品 / 问候激活客户", when: "w1" },
      { key: "holiday", label: "节日问候", title: "给客户发节日问候", when: "w1" },
      { key: "exhibition", label: "展会邀约", title: "邀请客户来展会 / 工厂参观", when: "w2" },
    ],
  },
];

export const REMINDER_KINDS: Record<string, ReminderKind & { group: string; color: string }> = Object.fromEntries(
  REMINDER_GROUPS.flatMap((g) => g.kinds.map((k) => [k.key, { ...k, group: g.label, color: g.color }])),
);

/** 不同页面优先展示的场景 */
export const CONTEXT_KINDS: Record<string, string[]> = {
  customer: ["factory_reply", "quote_followup", "inquiry_silent", "sample_feedback", "reactivate"],
  mail: ["inquiry_reply", "factory_quote", "factory_reply", "inquiry_silent", "payment_check"],
  quotation: ["factory_quote", "quote_followup", "quote_expire", "price_adjust", "sample_make"],
  order: ["factory_reply", "production_update", "deposit", "balance", "booking", "shipped"],
  whatsapp: ["inquiry_reply", "factory_reply", "factory_quote", "payment_check", "inquiry_silent"],
  lead: ["inquiry_reply", "inquiry_need", "inquiry_silent", "factory_quote"],
};
