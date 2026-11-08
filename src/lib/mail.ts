// 邮件 / AI 前后端共用常量

export const MAIL_INTENT_LABELS: Record<string, { label: string; cls: string }> = {
  inquiry: { label: "询盘", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  quotation: { label: "询价议价", cls: "border-violet-200 bg-violet-50 text-violet-700" },
  order: { label: "下单", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  sample: { label: "样品", cls: "border-cyan-200 bg-cyan-50 text-cyan-700" },
  complaint: { label: "投诉售后", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  logistics: { label: "物流", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  payment: { label: "付款", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  marketing: { label: "推广营销", cls: "text-muted-foreground" },
  other: { label: "其他", cls: "text-muted-foreground" },
};

export const MAIL_PRIORITY_LABELS: Record<string, { label: string; cls: string }> = {
  high: { label: "高优先", cls: "bg-rose-500" },
  medium: { label: "中", cls: "bg-amber-400" },
  low: { label: "低", cls: "bg-slate-300" },
};

export const AI_LANGUAGES = ["English", "Español", "Français", "Deutsch", "Português", "Italiano", "Русский", "العربية", "Türkçe", "日本語", "한국어", "Tiếng Việt", "Bahasa Indonesia", "简体中文"];

export const AI_TONES = ["正式", "友好", "简洁", "热情"];
