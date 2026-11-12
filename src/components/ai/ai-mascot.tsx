"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 车车 AI 的小角色：一张深色圆脸，只有两只胶囊形的白眼睛。
 * 平时自己眨眼、四处张望；有鼠标时眼睛跟着指针看；思考时眯眼左右看。
 */
export function AiMascot({ thinking, className }: { thinking?: boolean; className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const look = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) return;
    let raf = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = svg.current?.getBoundingClientRect();
        if (!r || !look.current) return;
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 260);
        look.current.style.transform = `translate(${((dx / d) * 4.5 * k).toFixed(2)}px, ${((dy / d) * 3.5 * k).toFixed(2)}px)`;
      });
      // 指针停下一会儿，眼睛回正，交给自己的张望动画
      clearTimeout(idle);
      idle = setTimeout(() => look.current && (look.current.style.transform = ""), 2500);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
      clearTimeout(idle);
    };
  }, []);

  return (
    <svg ref={svg} viewBox="0 0 64 64" aria-hidden className={cn("ai-mascot", thinking && "is-thinking", className)}>
      <circle cx="32" cy="32" r="32" fill="oklch(0.2 0 0)" />
      <g ref={look} className="ai-mascot-look">
        <g className="ai-mascot-eyes">
          <rect className="ai-mascot-eye" x="21.5" y="22" width="7" height="17" rx="3.5" fill="white" />
          <rect className="ai-mascot-eye" x="35.5" y="22" width="7" height="17" rx="3.5" fill="white" />
        </g>
      </g>
    </svg>
  );
}
