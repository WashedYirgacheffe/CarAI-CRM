/** 群发 / 跟进序列：前后端共用的常量和模板渲染 */

export const SEQUENCE_VARS = [
  { key: "first_name", label: "名", sample: "John" },
  { key: "name", label: "联系人", sample: "John Smith" },
  { key: "company", label: "公司", sample: "Acme Medical" },
  { key: "country", label: "国家", sample: "Germany" },
  { key: "sender", label: "发件人", sample: "Lily" },
] as const;

export type SequenceVars = Partial<Record<(typeof SEQUENCE_VARS)[number]["key"], string | null>>;

/** 没有值时的默认写法（英文开发信里最常见的兜底） */
const FALLBACK: Record<string, string> = { first_name: "there", name: "there", company: "your company", country: "your market" };

/** {{name}} 或 {{name|默认值}} */
export function renderTemplate(tpl: string, vars: SequenceVars) {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_m, key: string, def?: string) => {
    const v = vars[key.toLowerCase() as keyof SequenceVars]?.trim();
    return v || (def ?? FALLBACK[key.toLowerCase()] ?? "");
  });
}

export function firstName(name?: string | null) {
  const n = name?.trim();
  if (!n) return null;
  // 中文名不拆；英文名取第一个词
  return /[一-龥]/.test(n) ? n : n.split(/\s+/)[0];
}

export const ENROLLMENT_STATUS: Record<string, { label: string; tone: "primary" | "success" | "muted" | "warning" | "danger" }> = {
  ACTIVE: { label: "进行中", tone: "primary" },
  COMPLETED: { label: "已发完", tone: "muted" },
  REPLIED: { label: "已回复", tone: "success" },
  BOUNCED: { label: "退信", tone: "danger" },
  UNSUBSCRIBED: { label: "已退订", tone: "warning" },
  STOPPED: { label: "已停止", tone: "muted" },
  FAILED: { label: "发送失败", tone: "danger" },
};

/** 新建序列时可一键套用的模板 */
export const SEQUENCE_PRESETS: { key: string; name: string; steps: { delayDays: number; subject: string; body: string }[] }[] = [
  {
    key: "cold",
    name: "开发信 · 3 封跟进",
    steps: [
      {
        delayDays: 0,
        subject: "{{company}} x reliable medical device supplier",
        body: "Hi {{first_name}},\n\nThis is {{sender}}. We manufacture air compression therapy systems, nebulizers and anti-decubitus mattresses with CE / FDA certificates, OEM welcome.\n\nWould it be helpful if I send you our latest catalog and price list for {{country}}?\n\nBest regards,\n{{sender}}",
      },
      {
        delayDays: 3,
        subject: "Re: {{company}} x reliable medical device supplier",
        body: "Hi {{first_name}},\n\nJust following up on my last email. Many distributors in {{country}} are restocking for next season — happy to share best-selling models and MOQ.\n\nAny feedback is appreciated.\n\n{{sender}}",
      },
      {
        delayDays: 7,
        subject: "Free sample for {{company}}?",
        body: "Hi {{first_name}},\n\nI don't want to fill your inbox, so this is my last note. If you'd like to test quality first, we can arrange a sample this week.\n\nJust reply \"sample\" and I'll take care of the rest.\n\n{{sender}}",
      },
    ],
  },
  {
    key: "quote",
    name: "报价后跟进",
    steps: [
      {
        delayDays: 2,
        subject: "Any questions about our quotation?",
        body: "Hi {{first_name}},\n\nHope you've had a chance to review our quotation. Let me know if you need any adjustment on quantity, packaging or delivery terms.\n\n{{sender}}",
      },
      {
        delayDays: 5,
        subject: "Re: quotation for {{company}}",
        body: "Hi {{first_name}},\n\nOur factory schedule for next month is filling up. If you confirm this week we can still secure the current price and lead time.\n\n{{sender}}",
      },
    ],
  },
  {
    key: "promo",
    name: "新品 / 节日群发（单封）",
    steps: [
      {
        delayDays: 0,
        subject: "New arrivals for {{company}}",
        body: "Hi {{first_name}},\n\nWe've just launched new models this season. Reply to this email and I'll send the catalog with special pricing for existing partners.\n\n{{sender}}",
      },
    ],
  },
];
