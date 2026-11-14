/*
 * 分享链接访问记录（报价单、表单、产品卡）：服务端记录、客户页冒泡、产品页时间轴共用。
 */

export type ShareVisitKind = "quotation" | "inquiry" | "shipping" | "product";

export const SHARE_KIND_LABELS: Record<ShareVisitKind, string> = {
  quotation: "报价单",
  inquiry: "询价表单",
  shipping: "收货信息表单",
  product: "产品卡",
};

/** 时间轴事件：t 为距这次访问开始的毫秒 */
export type VisitEvent = { t: number; type: "open" | "section" | "click" | "hide" | "show"; name?: string };

/** 页面区块（data-track-section 的值）对应的中文名 */
export const SECTION_LABELS: Record<string, string> = {
  gallery: "产品图片",
  overview: "标题和卖点",
  specs: "规格参数",
  description: "详细介绍",
  packaging: "包装信息",
  video: "产品视频",
  contact: "联系我们",
  document: "报价单正文",
  items: "报价明细",
  terms: "条款",
  form: "表单",
};

/** 可点击元素（data-track-click 的值）对应的中文名 */
export const CLICK_LABELS: Record<string, string> = {
  whatsapp: "点了 WhatsApp 联系",
  email: "点了邮件联系",
  inquiry: "点了询价",
  print: "点了打印 / 另存 PDF",
  submit: "提交了表单",
  image: "放大看图片",
  video: "播放视频",
};

export const sectionLabel = (k: string) => SECTION_LABELS[k] ?? k;
export const clickLabel = (k: string) => CLICK_LABELS[k] ?? `点了 ${k}`;

export const DEVICE_LABELS: Record<string, string> = { mobile: "手机", tablet: "平板", desktop: "电脑" };

/** 前端拿到的一次访问 */
export type VisitView = {
  id: string;
  startedAt: string;
  lastSeenAt: string;
  activeMs: number;
  maxScroll: number;
  place: string | null;
  ip: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  referrer: string | null;
  sections: { name: string; ms: number }[];
  events: VisitEvent[];
};

/** 「12 秒」「3 分 20 秒」 */
export function durationText(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} 分 ${s % 60} 秒` : `${m} 分`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

export function placeText(v: { country?: string | null; region?: string | null; city?: string | null }) {
  const parts = [v.country, v.region, v.city].filter((x): x is string => !!x);
  // 直辖市 / 城市国家：省和市同名时只写一次
  return [...new Set(parts)].join(" · ") || null;
}

export function deviceText(v: { device?: string | null; os?: string | null; browser?: string | null }) {
  return [v.device ? (DEVICE_LABELS[v.device] ?? v.device) : null, v.os, v.browser].filter(Boolean).join(" · ") || null;
}
