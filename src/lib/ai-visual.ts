/** AI 对话里内嵌的可视化卡片（数字卡、条形、趋势、占比、表格、列表、时间线） */

export type VisualItem = {
  label: string;
  value?: number;
  /** 数字卡用：已格式化的展示值，如「¥128,000」 */
  display?: string;
  hint?: string;
  tone?: "up" | "down";
  subtitle?: string;
  meta?: string;
  href?: string;
  time?: string;
};

export type Visual =
  | { kind: "stats"; title?: string; items: VisualItem[] }
  | { kind: "bars"; title?: string; unit?: string; items: VisualItem[] }
  | { kind: "trend"; title?: string; unit?: string; items: VisualItem[] }
  | { kind: "donut"; title?: string; unit?: string; items: VisualItem[] }
  | { kind: "table"; title?: string; columns: string[]; rows: string[][] }
  | { kind: "list"; title?: string; items: VisualItem[] }
  | { kind: "timeline"; title?: string; items: VisualItem[] };

export const VISUAL_KINDS = ["stats", "bars", "trend", "donut", "table", "list", "timeline"] as const;

const str = (v: unknown, n: number) => (v === undefined || v === null || v === "" ? undefined : String(v).slice(0, n));
const num = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : undefined;
};
const safeHref = (v: unknown) => {
  const s = str(v, 300);
  return s && s.startsWith("/") && !s.startsWith("//") ? s : undefined;
};

/** 把模型给的参数收拾成合法的 Visual；不合法返回错误文字 */
export function sanitizeVisual(raw: Record<string, unknown>): Visual | string {
  const kind = raw.kind as Visual["kind"];
  if (!VISUAL_KINDS.includes(kind)) return "kind 无效";
  const title = str(raw.title, 60);
  if (kind === "table") {
    const columns = (Array.isArray(raw.columns) ? raw.columns : []).slice(0, 6).map((c) => str(c, 30) ?? "");
    const rows = (Array.isArray(raw.rows) ? raw.rows : [])
      .slice(0, 20)
      .filter(Array.isArray)
      .map((r) => columns.map((_, i) => str((r as unknown[])[i], 80) ?? ""));
    if (!columns.length || !rows.length) return "table 需要 columns 和 rows";
    return { kind, title, columns, rows };
  }
  const items: VisualItem[] = (Array.isArray(raw.items) ? raw.items : [])
    .slice(0, kind === "trend" ? 40 : kind === "stats" ? 6 : 12)
    .map((o): VisualItem => {
      const it = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
      return {
        label: str(it.label ?? it.title, 60) ?? "",
        value: num(it.value),
        display: str(it.display, 30),
        hint: str(it.hint, 60),
        tone: it.tone === "up" || it.tone === "down" ? (it.tone as "up" | "down") : undefined,
        subtitle: str(it.subtitle, 80),
        meta: str(it.meta, 40),
        href: safeHref(it.href),
        time: str(it.time, 30),
      };
    })
    .filter((it) => it.label);
  if (!items.length) return "items 不能为空";
  if ((kind === "bars" || kind === "trend" || kind === "donut") && items.some((it) => it.value === undefined))
    return `${kind} 的每一项都要有数字 value`;
  if (kind === "stats" && items.some((it) => !it.display && it.value === undefined)) return "stats 的每一项要有 display 或 value";
  const unit = str(raw.unit, 10);
  if (kind === "bars" || kind === "trend" || kind === "donut") return { kind, title, unit, items };
  return { kind, title, items } as Visual;
}

/** 给模型看的历史里的一句话摘要 */
export function visualSummary(v: Visual) {
  const name = { stats: "数字卡", bars: "条形图", trend: "趋势图", donut: "占比图", table: "表格", list: "列表", timeline: "时间线" }[v.kind];
  const body =
    v.kind === "table"
      ? `${v.columns.join("/")} 共 ${v.rows.length} 行`
      : v.items
          .slice(0, 6)
          .map((i) => `${i.label}${i.display ? ` ${i.display}` : i.value !== undefined ? ` ${i.value}` : ""}`)
          .join("，");
  return `（展示了${name}${v.title ? `「${v.title}」` : ""}：${body}）`;
}
