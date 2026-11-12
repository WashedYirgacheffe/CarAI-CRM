import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** 环上的 8 格，从左上角顺时针；中间那格不亮 */
const RING = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
] as const;

/**
 * 像素轨道（agentes 的「工作中」标记）：3×3 的格子里一格亮着沿环走，身后拖两格渐暗的尾巴。
 * 用 SVG + CSS 实现，服务端也能渲染；颜色跟随文字色，减少动态效果时静止。
 */
export function PixelSpinner({ size = 16, label, className, style }: { size?: number; label?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 30 30"
      width={size}
      height={size}
      className={cn("ac-pixspin", className)}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      shapeRendering="crispEdges"
    >
      {RING.map(([x, y], i) => (
        <rect
          key={i}
          x={x * 10 + 1}
          y={y * 10 + 1}
          width={8}
          height={8}
          fill="currentColor"
          style={{ animationDelay: `${(i - RING.length) * 110}ms` }}
        />
      ))}
    </svg>
  );
}
