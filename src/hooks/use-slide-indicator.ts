"use client";

import { useLayoutEffect, useRef } from "react";

/*
 * 导航的选中块从旧位置滑到新位置（UI 连续性 · 标签 / 侧栏）：
 * 选中项的那块底色（带 data-slide-on 的元素）切换时，用新选中块的底色做一个临时滑块，
 * 从旧块的位置移过去：前沿先走、后沿跟上，路上拉长、落地前压扁一点；落地后撤掉滑块，露出真实的选中块。
 * 静止时什么都不加，画面和原来一样。
 *
 * - 容器要能定位（relative / fixed）；滑块放在容器最底层（z-index -1 + isolate），文字和图标在它上面
 * - 中途再点：从滑块当前的位置转向新目标，不等上一段跑完
 * - 减少动态效果：不滑，直接换
 */

const PHONE_MS = 420;
const DESKTOP_MS = 280;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

type Box = { x: number; y: number; w: number; h: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 相对容器内容区（含滚动）的位置 */
function boxIn(el: Element, c: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  const cr = c.getBoundingClientRect();
  return { x: r.left - cr.left - c.clientLeft + c.scrollLeft, y: r.top - cr.top - c.clientTop + c.scrollTop, w: r.width, h: r.height };
}

/** 把选中块的底色暂时藏起来（滑块代替它），文字 / 图标用未选中时的颜色 */
const HIDE: Record<string, string> = { background: "transparent", boxShadow: "none", animation: "none" };

export function useSlideIndicator<T extends HTMLElement>(activeId: string | null | undefined) {
  const ref = useRef<T>(null);
  const prev = useRef<{ el: HTMLElement; id: string } | null>(null);
  const ghost = useRef<{ node: HTMLElement; anim: Animation; target: HTMLElement } | null>(null);

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const el = c.querySelector<HTMLElement>("[data-slide-on]");
    const from = prev.current;
    prev.current = el && activeId ? { el, id: activeId } : null;
    if (!el || !from || from.id === activeId) return;

    // 起点：上一段还在跑就从滑块现在的位置出发
    const running = ghost.current;
    let start: Box | null = null;
    if (running?.node.isConnected) start = boxIn(running.node, c);
    else if (from.el.isConnected && c.contains(from.el)) start = boxIn(from.el, c);
    finish(running);
    ghost.current = null;
    // 不滑的时候让它照原样弹出（上一次滑过来时留下的 animation: none 去掉）
    const plain = () => void (el.style.animation = "");
    if (!start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return plain();

    // 先停掉选中块自己的弹出动画（scale + 旋转），量到的才是它落定后的位置和大小
    el.style.animation = "none";
    const end = boxIn(el, c);
    if (!end.w || !end.h || !start.w || !start.h) return plain();
    const cs = getComputedStyle(el);
    const node = document.createElement("span");
    node.setAttribute("aria-hidden", "true");
    Object.assign(node.style, {
      position: "absolute",
      left: `${end.x}px`,
      top: `${end.y}px`,
      width: `${end.w}px`,
      height: `${end.h}px`,
      zIndex: "-1",
      pointerEvents: "none",
      transformOrigin: "0 0",
      borderRadius: cs.borderRadius,
      backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      backgroundPosition: cs.backgroundPosition,
      backgroundSize: cs.backgroundSize,
      backgroundRepeat: cs.backgroundRepeat,
      boxShadow: cs.boxShadow,
    });
    c.prepend(node);

    // 中途：前沿走到 75%、后沿才到 30%，两者之间拉成一条；横向走就压扁高度，竖向走就压扁宽度
    const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
    const lead = 0.75;
    const trail = 0.3;
    const mid = (() => {
      const a = { x: lerp(start.x, end.x, lead), y: lerp(start.y, end.y, lead), w: lerp(start.w, end.w, lead), h: lerp(start.h, end.h, lead) };
      const b = { x: lerp(start.x, end.x, trail), y: lerp(start.y, end.y, trail), w: lerp(start.w, end.w, trail), h: lerp(start.h, end.h, trail) };
      if (horizontal) {
        const x = Math.min(a.x, b.x);
        const w = Math.max(a.x + a.w, b.x + b.w) - x;
        const h = lerp(a.h, b.h, 0.5) * 0.85;
        return { x, w, h, y: lerp(a.y, b.y, 0.5) + (lerp(a.h, b.h, 0.5) - h) / 2 };
      }
      const y = Math.min(a.y, b.y);
      const h = Math.max(a.y + a.h, b.y + b.h) - y;
      const w = lerp(a.w, b.w, 0.5) * 0.85;
      return { y, h, w, x: lerp(a.x, b.x, 0.5) + (lerp(a.w, b.w, 0.5) - w) / 2 };
    })();
    const at = (b: Box) => `translate(${b.x - end.x}px, ${b.y - end.y}px) scale(${b.w / end.w}, ${b.h / end.h})`;

    Object.assign(el.style, HIDE);
    // 模块色图块是白图标：底色藏起来的这一会儿用未选中时的描边色，不然白图标在浅底上看不见
    if (el.classList.contains("ac-tile")) {
      el.style.color = document.documentElement.classList.contains("dark") ? "var(--t-top, var(--mod-top))" : "var(--t-bottom, var(--mod-bottom))";
    }
    const phone = !window.matchMedia("(min-width: 768px)").matches;
    const anim = node.animate(
      [
        { transform: at(start), offset: 0 },
        { transform: at(mid), offset: 0.5 },
        { transform: "none", offset: 1 },
      ],
      { duration: phone ? PHONE_MS : DESKTOP_MS, easing: EASE },
    );
    const g = { node, anim, target: el };
    ghost.current = g;
    anim.finished.then(
      () => {
        finish(g);
        if (ghost.current === g) ghost.current = null;
      },
      () => {},
    );
  }, [activeId]);

  // 卸载时收掉滑块
  useLayoutEffect(
    () => () => {
      finish(ghost.current);
      ghost.current = null;
    },
    [],
  );

  return ref;
}

function finish(g: { node: HTMLElement; anim: Animation; target: HTMLElement } | null) {
  if (!g) return;
  g.anim.cancel();
  g.node.remove();
  // 还原真实选中块的底色；animation 保持 none：落地后不再弹一下
  g.target.style.background = "";
  g.target.style.boxShadow = "";
  g.target.style.color = "";
}
