// 工作台画布：组件注册表、尺寸、布局（前后端共用）。
// 第 2 期 AI 也读这张表来决定能调出哪些组件。
import { DASHBOARD_CARDS, resolveDashboard, type DashboardCardKey } from "@/lib/dashboard";

/** s 小（4 列长条）· m 中（6 列）· l 大（8 列）· xl 全宽（12 列） */
export const SIZES = ["s", "m", "l", "xl"] as const;
export type CanvasSize = (typeof SIZES)[number];
export const SIZE_LABEL: Record<CanvasSize, string> = { s: "小", m: "中", l: "大", xl: "全宽" };
export const SIZE_SPAN: Record<CanvasSize, string> = {
  s: "md:col-span-1 xl:col-span-4",
  m: "md:col-span-1 xl:col-span-6",
  l: "md:col-span-2 xl:col-span-8",
  xl: "md:col-span-2 xl:col-span-12",
};

export type WidgetDef = {
  type: string;
  label: string;
  desc: string;
  sizes: CanvasSize[];
  size: CanvasSize;
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

export const WIDGETS: WidgetDef[] = DASHBOARD_CARDS.map((c) => ({ type: c.key, label: c.label, desc: c.desc, ...SIZE_RULES[c.key] }));
const BY_TYPE = new Map(WIDGETS.map((w) => [w.type, w]));
export const widgetDef = (type: string) => BY_TYPE.get(type);

export type CanvasItem = { id: string; type: string; size: CanvasSize; params?: Record<string, string> };
export type CanvasLayout = CanvasItem[];

export const OVERVIEW_ID = "overview";
export const MAX_ITEMS = 30;
export const MAX_WORKSPACES = 20;

let seq = 0;
export const newItemId = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`;

export const makeItem = (type: string, size?: CanvasSize): CanvasItem => {
  const def = widgetDef(type)!;
  return { id: newItemId(), type, size: size && def.sizes.includes(size) ? size : def.size };
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
    if (out.some((o) => o.type === def.type)) continue;
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
    out.push(item);
  }
  return out;
}

export const sameLayout = (a: CanvasLayout, b: CanvasLayout) => JSON.stringify(a) === JSON.stringify(b);
