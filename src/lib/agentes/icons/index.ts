import { extraIcons } from "./extra";
import { sourceIcons } from "./source";
import type { IconShape } from "./types";

export const icons = { ...sourceIcons, ...extraIcons } as Record<keyof typeof sourceIcons | keyof typeof extraIcons, IconShape[]>;
export type IconName = keyof typeof icons;
export type { IconShape };
