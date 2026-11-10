import { cn } from "@/lib/utils";

/**
 * 车车 AI 的小角色：圆滚滚的小车脸，车灯当眼睛，头顶一根天线。
 * idle 时偶尔眨眼；thinking 时眼睛左右看、天线闪。
 */
export function AiMascot({ thinking, className }: { thinking?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("ai-mascot", thinking && "is-thinking", className)}>
      <defs>
        <linearGradient id="ai-mascot-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.66 0.19 262)" />
          <stop offset="1" stopColor="oklch(0.5 0.21 280)" />
        </linearGradient>
      </defs>
      {/* 天线 */}
      <path d="M32 13 V6" stroke="oklch(0.42 0.16 275)" strokeWidth="2.5" strokeLinecap="round" />
      <circle className="ai-mascot-bulb" cx="32" cy="5.5" r="3.5" fill="oklch(0.86 0.17 85)" />
      {/* 身体 */}
      <rect x="6" y="12" width="52" height="46" rx="23" fill="url(#ai-mascot-body)" />
      {/* 后视镜一样的小耳朵 */}
      <rect x="2" y="30" width="7" height="12" rx="3.5" fill="oklch(0.45 0.17 278)" />
      <rect x="55" y="30" width="7" height="12" rx="3.5" fill="oklch(0.45 0.17 278)" />
      {/* 脸 */}
      <rect x="13" y="22" width="38" height="27" rx="13.5" fill="oklch(0.98 0.01 260)" />
      <g className="ai-mascot-eyes">
        <ellipse className="ai-mascot-eye" cx="25" cy="34" rx="3.6" ry="4.6" fill="oklch(0.25 0.05 270)" />
        <ellipse className="ai-mascot-eye" cx="39" cy="34" rx="3.6" ry="4.6" fill="oklch(0.25 0.05 270)" />
        <circle cx="26.2" cy="32.4" r="1.2" fill="white" />
        <circle cx="40.2" cy="32.4" r="1.2" fill="white" />
      </g>
      <circle cx="19.5" cy="41" r="2.6" fill="oklch(0.8 0.1 15)" opacity="0.7" />
      <circle cx="44.5" cy="41" r="2.6" fill="oklch(0.8 0.1 15)" opacity="0.7" />
      <path d="M28.5 42.5 Q32 45.5 35.5 42.5" stroke="oklch(0.25 0.05 270)" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
