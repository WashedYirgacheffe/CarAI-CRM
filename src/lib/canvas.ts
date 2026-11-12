// 工作台画布：组件注册表、尺寸、布局（前后端共用）。
// 第 2 期 AI 也读这张表来决定能调出哪些组件。
import { DASHBOARD_CARDS, resolveDashboard, type DashboardCardKey } from "@/lib/dashboard";

/** s 小（4 列长条）· m 中（6 列）· l 大（8 列）· xl 全宽（12 列） */
export const SIZES = ["s", "m", "l", "xl"] as const;
export type CanvasSize = (typeof SIZES)[number];
export const SIZE_LABEL: Record<CanvasSize, string> = { s: "小", m: "中", l: "大", xl: "全宽" };
export const SIZE_SPAN: Record<CanvasSize, string> = {
  s: "@xl/canvas:col-span-1 @5xl/canvas:col-span-4",
  m: "@xl/canvas:col-span-1 @5xl/canvas:col-span-6",
  l: "@xl/canvas:col-span-2 @5xl/canvas:col-span-8",
  xl: "@xl/canvas:col-span-2 @5xl/canvas:col-span-12",
};

export type WidgetDef = {
  type: string;
  label: string;
  desc: string;
  sizes: CanvasSize[];
  size: CanvasSize;
  /** 需要的参数（业务组件）；概览卡片没有参数 */
  params?: { key: string; desc: string; optional?: boolean }[];
  /** 可以放多个（业务组件按对象区分） */
  multi?: boolean;
};

const SIZE_RULES: Record<DashboardCardKey, Pick<WidgetDef, "sizes" | "size">> = {
  hero: { sizes: ["m", "l", "xl"], size: "xl" },
  overview: { sizes: ["m", "l", "xl"], size: "xl" },
  today: { sizes: ["s", "m", "l", "xl"], size: "m" },
  trend: { sizes: ["s", "m", "l", "xl"], size: "m" },
  funnel: { sizes: ["s", "m", "l", "xl"], size: "m" },
  heatmap: { sizes: ["m", "l", "xl"], size: "m" },
  comms: { sizes: ["s", "m", "l", "xl"], size: "m" },
  recent: { sizes: ["s", "m", "l", "xl"], size: "m" },
  health: { sizes: ["s", "m", "l"], size: "s" },
  pipeline: { sizes: ["s", "m", "l"], size: "s" },
  distribution: { sizes: ["s", "m", "l"], size: "s" },
  clock: { sizes: ["s", "m", "l", "xl"], size: "s" },
  fx: { sizes: ["s", "m", "l"], size: "s" },
};

/** 业务组件：绑定某个客户 / 会话，或带查询条件 */
export const BUSINESS_WIDGETS: WidgetDef[] = [
  {
    type: "customer",
    label: "客户资料",
    desc: "某个客户的关键信息：国家、状态、负责人、联系人、最近联系、下次跟进",
    sizes: ["s", "m", "l"],
    size: "s",
    params: [{ key: "customerId", desc: "客户 id" }],
    multi: true,
  },
  {
    type: "followups",
    label: "跟进记录",
    desc: "某个客户的跟进时间线（跟进、邮件、WhatsApp、报价等动态），可直接写跟进",
    sizes: ["s", "m", "l"],
    size: "s",
    params: [{ key: "customerId", desc: "客户 id" }],
    multi: true,
  },
  {
    type: "whatsapp",
    label: "WhatsApp 聊天",
    desc: "和某个 WhatsApp 会话直接聊天（完整聊天窗口，含右侧客户面板）",
    sizes: ["m", "l", "xl"],
    size: "l",
    params: [{ key: "chatId", desc: "WhatsApp 会话 id" }],
    multi: true,
  },
  {
    type: "team",
    label: "团队业绩",
    desc: "团队每个成员的成交额、订单、报价、跟进、新客户、新询盘",
    sizes: ["m", "l", "xl"],
    size: "xl",
    params: [{ key: "range", desc: "时间范围", optional: true }],
    multi: true,
  },
  {
    type: "chart",
    label: "数据图表",
    desc: "任选指标、维度、时间范围生成的图表",
    sizes: ["s", "m", "l", "xl"],
    size: "m",
    params: [
      { key: "metric", desc: "指标" },
      { key: "by", desc: "维度" },
      { key: "range", desc: "时间范围" },
      { key: "chart", desc: "图表类型", optional: true },
    ],
    multi: true,
  },
];

export const WIDGETS: WidgetDef[] = [
  ...DASHBOARD_CARDS.map((c) => ({ type: c.key, label: c.label, desc: c.desc, ...SIZE_RULES[c.key] })),
  ...BUSINESS_WIDGETS,
];
export const isBusiness = (type: string) => BUSINESS_WIDGETS.some((w) => w.type === type);
const BY_TYPE = new Map(WIDGETS.map((w) => [w.type, w]));
export const widgetDef = (type: string) => BY_TYPE.get(type);

export type CanvasItem = { id: string; type: string; size: CanvasSize; params?: Record<string, string> };
export type CanvasLayout = CanvasItem[];

export const OVERVIEW_ID = "overview";
export const MAX_ITEMS = 30;
export const MAX_WORKSPACES = 20;

let seq = 0;
export const newItemId = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`;

export const makeItem = (type: string, size?: CanvasSize, params?: Record<string, string>): CanvasItem => {
  const def = widgetDef(type)!;
  return {
    id: newItemId(),
    type,
    size: size && def.sizes.includes(size) ? size : def.size,
    ...(params && Object.keys(params).length ? { params } : {}),
  };
};

/** 组件标题：业务组件带上对象名（params.title） */
export const itemTitle = (it: CanvasItem) => {
  const def = widgetDef(it.type);
  const t = it.params?.title;
  if (!def) return it.type;
  if (!t) return def.label;
  return it.type === "chart" ? t : `${def.label} · ${t}`;
};

/** 系统「概览」情景：沿用用户以前在旧版工作台勾选的卡片 */
export function overviewLayout(savedCards: string[] | null | undefined): CanvasLayout {
  return resolveDashboard(savedCards).map((k) => ({ id: `o-${k}`, type: k, size: SIZE_RULES[k].size }));
}

/** 校验并清洗布局（来自客户端或数据库） */
export function sanitizeLayout(raw: unknown): CanvasLayout {
  if (!Array.isArray(raw)) return [];
  const out: CanvasLayout = [];
  const seen = new Set<string>();
  for (const x of raw.slice(0, MAX_ITEMS)) {
    if (!x || typeof x !== "object") continue;
    const { id, type, size, params } = x as Record<string, unknown>;
    const def = typeof type === "string" ? widgetDef(type) : undefined;
    if (!def || typeof id !== "string" || !id || id.length > 40 || seen.has(id)) continue;
    // 概览卡片每种只放一张
    if (!def.multi && out.some((o) => o.type === def.type)) continue;
    seen.add(id);
    const sz = def.sizes.includes(size as CanvasSize) ? (size as CanvasSize) : def.size;
    const item: CanvasItem = { id, type: def.type, size: sz };
    if (params && typeof params === "object" && !Array.isArray(params)) {
      const p = Object.fromEntries(
        Object.entries(params as Record<string, unknown>)
          .filter(([k, v]) => typeof v === "string" && k.length <= 30 && v.length <= 200)
          .slice(0, 10),
      ) as Record<string, string>;
      if (Object.keys(p).length) item.params = p;
    }
    // 业务组件缺必填参数就丢掉
    if (def.params?.some((x) => !x.optional && !item.params?.[x.key])) continue;
    out.push(item);
  }
  return out;
}

export const sameLayout = (a: CanvasLayout, b: CanvasLayout) => JSON.stringify(a) === JSON.stringify(b);
