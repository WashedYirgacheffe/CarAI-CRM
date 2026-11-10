// 邮件 / AI 前后端共用常量

export const MAIL_INTENT_LABELS: Record<string, { label: string; cls: string }> = {
  inquiry: { label: "询盘", cls: "bg-brand-soft text-brand-ink" },
  quotation: { label: "询价议价", cls: "bg-foreground/[0.07] text-foreground" },
  order: { label: "下单", cls: "bg-emerald-50 text-emerald-700" },
  sample: { label: "样品", cls: "bg-foreground/[0.07] text-foreground" },
  complaint: { label: "投诉售后", cls: "bg-rose-50 text-rose-700" },
  logistics: { label: "物流", cls: "bg-amber-50 text-amber-800" },
  payment: { label: "付款", cls: "bg-emerald-50 text-emerald-700" },
  marketing: { label: "推广营销", cls: "text-muted-foreground" },
  other: { label: "其他", cls: "text-muted-foreground" },
};

export const MAIL_PRIORITY_LABELS: Record<string, { label: string; cls: string }> = {
  high: { label: "高优先", cls: "bg-rose-500" },
  medium: { label: "中", cls: "bg-amber-400" },
  low: { label: "低", cls: "bg-slate-300" },
};

export const AI_LANGUAGES = [
  "English",
  "Español",
  "Français",
  "Deutsch",
  "Português",
  "Italiano",
  "Русский",
  "العربية",
  "Türkçe",
  "日本語",
  "한국어",
  "Tiếng Việt",
  "Bahasa Indonesia",
  "简体中文",
];

export const AI_TONES = ["正式", "友好", "简洁", "热情"];
