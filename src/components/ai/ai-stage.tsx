"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/*
 * 工作台的「AI 舞台」：电脑端（≥1024px）工作台上，AI 对话框不再是右下角的浮窗，而是页面主角。
 * - hero：还没对话时，AI 形象 + 问候 + 输入框居中放在页面上三分之一处，下面是原来的卡片画布
 * - split：开始对话后，左半边是对话（输入框在最下方），右半边是卡片画布
 * AiDock 把对话界面 portal 到这里的插槽；两种布局之间用 View Transitions 过渡。
 */

export type StageMode = "hero" | "split";
type Stage = { slot: HTMLElement | null; mode: StageMode; greeting: string; sub: string };

let stage: Stage = { slot: null, mode: "hero", greeting: "", sub: "" };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const SERVER: Stage = { slot: null, mode: "hero", greeting: "", sub: "" };

export function useStage() {
  return useSyncExternalStore(
    subscribe,
    () => stage,
    () => SERVER,
  );
}

export function setStageMode(mode: StageMode) {
  if (stage.mode === mode) return;
  stage = { ...stage, mode };
  emit();
}

/** 切换布局时的过渡动画；浏览器不支持或用户减少动态效果时直接切 */
export function withStageTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return update();
  doc.startViewTransition(update);
}

export function AiStage({ greeting, sub, children }: { greeting: string; sub: string; children: React.ReactNode }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const { mode, slot } = useStage();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      stage = { ...stage, slot: mq.matches ? slotRef.current : null, greeting, sub };
      emit();
    };
    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      stage = { ...stage, slot: null };
      emit();
    };
  }, [greeting, sub]);

  const split = !!slot && mode === "split";
  return (
    <div
      data-stage={slot ? mode : "off"}
      className={cn(
        split && "grid h-[calc(100svh-3.5rem-3rem)] grid-cols-[minmax(22rem,5fr)_minmax(0,7fr)] gap-5 xl:grid-cols-[minmax(24rem,1fr)_minmax(0,1fr)]",
      )}
    >
      <div ref={slotRef} className={cn(!slot && "hidden", split ? "min-h-0" : "")} />
      <div
        className={cn(
          "min-w-0",
          !!slot && "[view-transition-name:ai-canvas]",
          split && "-mr-2 min-h-0 overflow-y-auto pr-2 pb-6",
          !!slot && !split && "pb-20",
        )}
      >
        {children}
      </div>
    </div>
  );
}
