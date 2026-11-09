// 图表共用的颜色与数字格式（前后端都能用）

/** 单色顺序色（浅 → 深），已校验：单色相、亮度单调、浅端对白底 ≥ 2:1 */
export const RAMP = ["oklch(0.78 0.1 266)", "oklch(0.67 0.15 266)", "oklch(0.56 0.19 266)", "oklch(0.44 0.18 266)"];

const compactFmt = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
export const compact = (n: number) => compactFmt.format(n);
export const yuan = (n: number) => `¥${compact(Math.round(n))}`;
