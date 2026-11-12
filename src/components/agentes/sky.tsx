"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { gradientOf, type AgentColorName } from "@/lib/agentes/agent/engine.js";
import { drawSprite, redrawSkies, startSky, type SkyOptions } from "@/lib/agentes/sky/engine";
import { pixelBurst, pixelConfetti } from "@/lib/agentes/sky/burst";
import { glowTones, mix, pixelOf, softTones, spriteTone } from "@/lib/agentes/sky/math";
import { cn } from "@/lib/utils";

/*
 * agentes 的像素天空：Bayer 抖动的天色 + 慢慢升起、会眨眼的像素小人。
 * 全站一个动画循环，离屏不画，减少动态效果时只画一帧。
 * - PixelSky：铺满父元素的画布（父元素要 relative + overflow-hidden）
 * - SkyGlow：空状态里一团天光，中间漂着一个小人
 * - HeaderSky：页头右侧升起的一片天，按模块换颜色
 * - RailHorizon：侧栏底部的地平线
 * - CardSky：等你确认的卡片顶上一层淡淡的天
 * - burstFrom / confettiFrom：确认、完成时的像素迸发和彩纸
 */

/** 当前模块的颜色：AppShell 按导航设置，页头、空状态跟着变 */
export const ModuleColorContext = createContext<AgentColorName>("sky");
export const useModuleColor = () => useContext(ModuleColorContext);

export function PixelSky({ options, className }: { options: SkyOptions; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
    // 减少动态效果时天空只在被要求时重画：换了参数就是一次
    redrawSkies();
  });
  useEffect(() => {
    const canvas = ref.current;
    return canvas ? startSky(canvas, () => opts.current) : undefined;
  }, []);
  return <canvas ref={ref} aria-hidden className={cn("ac-sky", className)} />;
}

const WHITE = pixelOf("#ffffff");

/** 空状态：从底色里升起的一团天光，中间一个上下浮动、偶尔眨眼的小人 */
export function SkyGlow({ color, surface = "--bg", className }: { color?: AgentColorName; surface?: string; className?: string }) {
  const ctx = useModuleColor();
  const c = color ?? ctx;
  const body = pixelOf(spriteTone(c));
  return (
    <span className={cn("ac-sky-glow", className)} aria-hidden>
      <PixelSky
        options={{
          pixel: 4,
          surface,
          palette: (bg) => glowTones(c, bg),
          light: 0,
          base: (u, v, t) => {
            const dx = (u - 0.5) * 2.1;
            const dy = (v - 0.58) * 1.4;
            const edge = Math.min(1, u * 5, (1 - u) * 5, v * 5, (1 - v) * 5);
            return edge * Math.exp(-(dx * dx + dy * dy) / 0.18) * (0.9 + 0.06 * Math.sin(t * 0.8));
          },
          after: (f) => {
            const y = Math.round(f.h * 0.5 - 9 + Math.sin(f.t * 1.6) * 2);
            drawSprite(f, Math.round(f.w / 2 - 9), y, 2, body, WHITE, f.t % 4.2 > 4.04);
          },
        }}
      />
    </span>
  );
}

/** 工作台首屏：助手身后一团天光，几个像素小人从它身边慢慢飘上去（不挡脸） */
export function HeroSky({ color = "sky", face }: { color?: AgentColorName; face?: React.RefObject<HTMLElement | null> }) {
  const [top, bottom] = gradientOf(color);
  return (
    <PixelSky
      options={{
        pixel: 4,
        surface: "--bg",
        // 只用浅色那一半：助手本身是深色渐变，站在浅天光里才显眼
        palette: (bg) => [bg, mix(bg, top, 0.18), mix(bg, top, 0.36), mix(bg, top, 0.56), mix(bg, top, 0.8), top, mix(top, bottom, 0.3)],
        body: mix(top, bottom, 0.45),
        sprites: { area: 900, max: 6 },
        near: 0.15,
        faint: 0.6,
        rise: 0.7,
        light: 0.1,
        clear: () => [face?.current],
        base: (u, v, t) => {
          const dx = (u - 0.5) * 2;
          const dy = (v - 0.5) * 1.5;
          const edge = Math.min(1, u * 4, (1 - u) * 4, v * 4, (1 - v) * 4);
          return edge * Math.exp(-(dx * dx + dy * dy) / 0.36) * (0.95 + 0.05 * Math.sin(t * 0.7 + u * 3));
        },
        blobs: (t) => [
          [0.3 + 0.05 * Math.cos(t * 0.2), 0.6, 0.04, 0.1],
          [0.7 + 0.05 * Math.sin(t * 0.17), 0.55, 0.04, 0.1],
        ],
      }}
    />
  );
}

/** 页头：右边升起一片模块色的天，往左淡进底色；几个像素小人慢慢往上飘 */
export function HeaderSky({ color, surface = "--bg" }: { color?: AgentColorName; surface?: string }) {
  const ctx = useModuleColor();
  const c = color ?? ctx;
  const [top, bottom] = gradientOf(c);
  return (
    <PixelSky
      className="ac-header-sky"
      options={{
        pixel: 3,
        surface,
        palette: (bg) => [bg, mix(bg, top, 0.14), mix(bg, top, 0.3), mix(bg, top, 0.5), mix(bg, top, 0.75), top, mix(top, bottom, 0.45)],
        body: mix(top, bottom, 0.55),
        sprites: { area: 2600, max: 4 },
        near: 0,
        faint: 0.55,
        rise: 0.6,
        light: 0.08,
        lightR: 0.6,
        base: (u, v, t) => {
          // 左边是底色（标题在那），往右越来越浓；底边淡回底色，不留硬边
          const s = Math.max(0, (u - 0.22) / 0.78);
          const e = s * s * (3 - 2 * s);
          const foot = Math.min(1, 1.6 * (1 - v));
          return e * foot * (0.92 + 0.06 * Math.sin(u * 6 + v * 3 + t * 0.5));
        },
        blobs: (t) => [
          [0.86 + 0.06 * Math.cos(t * 0.17), 0.25, 0.05, 0.12],
          [0.62 + 0.08 * Math.sin(t * 0.13), 0.1, 0.04, 0.08],
        ],
      }}
    />
  );
}

/** 侧栏底部的地平线：两团慢慢移动的亮处，没有小人 */
export function RailHorizon({ color, level = 0.6, surface = "--side" }: { color?: AgentColorName; level?: number; surface?: string }) {
  const ctx = useModuleColor();
  const c = color ?? ctx;
  return (
    <span className="ac-rail-horizon" aria-hidden>
      <PixelSky
        options={{
          pixel: 4,
          surface,
          palette: (bg) => softTones(c, bg),
          sprites: 0,
          light: 0,
          base: (u, v, t) => {
            const s = Math.max(0, (v - 0.1) / 0.9);
            const e = s * s * (3 - 2 * s);
            return level * e * 0.7 + 0.04 * Math.sin(u * 5 + t * 0.6) * e;
          },
          blobs: (t) => [
            [0.25 + 0.15 * Math.cos(t * 0.21), 0.95, 0.08, 0.1],
            [0.75 + 0.15 * Math.sin(t * 0.16), 0.9, 0.08, 0.1],
          ],
        }}
      />
    </span>
  );
}

/** 卡片顶部：一层从右上角洒下来的淡天色（等你拍板的卡片） */
export function CardSky({ color, surface = "--raised" }: { color?: AgentColorName; surface?: string }) {
  const ctx = useModuleColor();
  const c = color ?? ctx;
  return (
    <span className="ac-card-sky" aria-hidden>
      <PixelSky
        options={{
          pixel: 3,
          surface,
          palette: (bg) => softTones(c, bg),
          sprites: 0,
          light: 0,
          base: (u, v, t) => {
            const fade = 1 - v;
            return fade * fade * (0.18 + 0.42 * u * u + 0.06 * Math.sin(u * 7 + t * 0.5));
          },
        }}
      />
    </span>
  );
}

/** 从一个元素中心迸出一小团像素和几个小人（确认执行、赢单） */
export function burstFrom(el: Element | null | undefined, color: AgentColorName = "sky") {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const [top, bottom] = gradientOf(color);
  pixelBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, [bottom, mix(bottom, top, 0.5), top, mix(top, "#ffffff", 0.5), "#ffffff"], bottom);
}

/** 从一个元素撒一把像素彩纸（做完一件事） */
export function confettiFrom(el: Element | null | undefined) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  pixelConfetti({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
}
