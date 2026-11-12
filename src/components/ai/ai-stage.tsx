"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { LayoutGrid, MessageCircle } from "@/components/icons";
import { cn } from "@/lib/utils";

/*
 * 工作台的「AI 舞台」：工作台上 AI 对话不再是右下角浮窗，而是页面主角。
 * - hero：还没对话时，AI 形象 + 问候 + 输入框居中放在页面上三分之一处，下面是原来的卡片画布
 * - split：开始对话后
 *   - 电脑（≥1024px）：左边对话（输入框在最下方），右边卡片画布
 *   - 手机 / 平板：顶部切换「对话 / 工作台」，对话占满一屏，输入框贴在底部
 * AiDock 把对话界面 portal 到这里的插槽；布局切换用 View Transitions 过渡。
 */

export type StageMode = "hero" | "split";
export type StagePane = "chat" | "canvas";
type Stage = { slot: HTMLElement | null; mode: StageMode; pane: StagePane; wide: boolean; greeting: string; sub: string; fresh: boolean };

const SERVER: Stage = { slot: null, mode: "hero", pane: "chat", wide: true, greeting: "", sub: "", fresh: false };
let stage: Stage = SERVER;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const patch = (p: Partial<Stage>) => {
  stage = { ...stage, ...p };
  emit();
};

export function useStage() {
  return useSyncExternalStore(
    subscribe,
    () => stage,
    () => SERVER,
  );
}

export function setStageMode(mode: StageMode) {
  if (stage.mode !== mode) patch({ mode, pane: "chat" });
}

/** 手机上「对话 / 工作台」切换；fresh = 工作台有 AI 刚摆好的新内容 */
export function setStagePane(pane: StagePane, fresh = false) {
  if (stage.pane !== pane || stage.fresh !== fresh) patch({ pane, fresh: pane === "canvas" ? false : fresh });
}

/** 当前是不是手机上的分页模式（看不到画布） */
export const isStageTabs = () => !!stage.slot && !stage.wide && stage.mode === "split";

/** 切换布局时的过渡动画；浏览器不支持或用户减少动态效果时直接切 */
export function withStageTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return update();
  doc.startViewTransition(update);
}

export function AiStage({ greeting, sub, children }: { greeting: string; sub: string; children: React.ReactNode }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const { mode, slot, pane, wide, fresh } = useStage();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => patch({ slot: slotRef.current, wide: mq.matches, greeting, sub });
    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      patch({ slot: null, pane: "chat", fresh: false });
    };
  }, [greeting, sub]);

  const split = !!slot && mode === "split";
  const side = split && wide;
  const tabs = split && !wide;
  const go = (p: StagePane) => withStageTransition(() => setStagePane(p));

  return (
    <div
      data-stage={slot ? mode : "off"}
      className={cn(
        side && "grid h-[calc(100svh-3.5rem-3rem)] grid-cols-[minmax(22rem,5fr)_minmax(0,7fr)] gap-5 xl:grid-cols-[minmax(24rem,1fr)_minmax(0,1fr)]",
        tabs && "flex h-[calc(100svh-8.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col gap-2.5 md:h-[calc(100svh-3.5rem-3rem)]",
      )}
    >
      {tabs && (
        <div role="tablist" aria-label="切换视图" className="mx-auto inline-flex shrink-0 rounded-[12px] bg-muted p-1">
          {(
            [
              { key: "chat", label: "对话", icon: MessageCircle },
              { key: "canvas", label: "工作台", icon: LayoutGrid },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={pane === t.key}
              onClick={() => go(t.key)}
              className={cn(
                "relative inline-flex h-8 items-center gap-1.5 rounded-[9px] px-4 text-[13px] font-medium transition-colors",
                pane === t.key ? "bg-card text-foreground shadow-e1" : "text-foreground/65",
              )}
            >
              <t.icon className="size-4" />
              {t.label}
              {t.key === "canvas" && fresh && pane !== "canvas" && (
                <span className="absolute top-1 right-1.5 size-2 rounded-full bg-brand ring-2 ring-muted" aria-label="有新内容" />
              )}
            </button>
          ))}
        </div>
      )}
      <div ref={slotRef} className={cn(!slot && "hidden", split && "min-h-0", tabs && (pane === "chat" ? "flex-1" : "hidden"))} />
      <div
        className={cn(
          "min-w-0",
          !!slot && "[view-transition-name:ai-canvas]",
          side && "-mr-2 min-h-0 overflow-y-auto pr-2 pb-6",
          tabs && (pane === "canvas" ? "-mx-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4 md:mx-0 md:px-0" : "hidden"),
          !!slot && !split && "pb-20",
        )}
      >
        {children}
      </div>
    </div>
  );
}
