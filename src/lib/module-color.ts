import { gradientOf } from "@/lib/agentes/agent/engine.js";
import type { AgentPresetColor } from "@/lib/agentes/agent/engine.js";

/**
 * 每个模块一种 agentes 预设色：导航图标、页头的像素天空、选中态、空状态都用它，
 * 一眼分得清自己在哪个板块，整站也不再只有一种蓝。
 */
export const MODULE_COLORS: Record<string, AgentPresetColor> = {
  dashboard: "sky",
  todo: "amber",
  mail: "indigo",
  whatsapp: "green",
  marketing: "rose",
  leads: "amber",
  customers: "sky",
  opportunities: "violet",
  trade: "teal",
  reports: "indigo",
  settings: "sky",
};

export const moduleColor = (key?: string | null): AgentPresetColor => (key && MODULE_COLORS[key]) || "sky";

/** 模块色的 CSS 变量：--mod-top / --mod-bottom 是渐变两端，--mod 是正文里用的深一点的那端 */
export function moduleVars(color: AgentPresetColor): React.CSSProperties {
  const [top, bottom] = gradientOf(color);
  return { "--mod-top": top, "--mod-bottom": bottom } as React.CSSProperties;
}

/** 彩色图块（.ac-tile）的渐变两端 */
export function tileVars(color: AgentPresetColor): React.CSSProperties {
  const [top, bottom] = gradientOf(color);
  return { "--t-top": top, "--t-bottom": bottom } as React.CSSProperties;
}
