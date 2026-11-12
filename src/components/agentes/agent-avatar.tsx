"use client";

import { useLayoutEffect, useRef, type CSSProperties, type HTMLAttributes } from "react";
import { gradientOf } from "@/lib/agentes/agent/engine.js";
import { addLiveAgent, drawLive, type LiveAgent } from "@/lib/agentes/agent/live";
import type { AgentAppearance } from "@/lib/agentes/tokens/look";
import { cn } from "@/lib/utils";

export type { AgentAppearance } from "@/lib/agentes/tokens/look";

/**
 * 助手的状态：idle 偶尔眨眼；thinking 四处张望（带光环）；writing 眯眼写字（带光环）；
 * waiting 抬头看你，等你拍板；sleeping 闭眼打瞌睡。
 */
export type AgentState = "idle" | "thinking" | "writing" | "waiting" | "sleeping";
type Size = "xs" | "sm" | "md" | "lg" | "xl";

/** 同一个名字得到同一个数，几个助手并排时动作错开 */
const seedOf = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 100;
};

function appearanceStyle(a: AgentAppearance | undefined): CSSProperties | undefined {
  if (!a?.color || a.color === "sky") return undefined;
  const [top, bottom] = gradientOf(a.color);
  return { "--av-top": top, "--av-bottom": bottom } as CSSProperties;
}

/**
 * 活的助手形象（agentes 的 agent engine）：像素抖动的身体、切角、白眼睛和小配饰，
 * 在共享的绘制循环里转头、眨眼、偶尔做个表情；不在屏幕里的不画，减少动态效果时静止。
 * 默认站在自己的像素天空小方块里（framed）；xs / xl 不带方块，直接站在页面上。
 */
export function AgentAvatar({
  name,
  size = "md",
  state = "idle",
  appearance,
  reactionKey,
  framed,
  labelled,
  className,
  style,
  ...rest
}: {
  name: string;
  size?: Size;
  state?: AgentState;
  appearance?: AgentAppearance;
  /** 配合 playAgentReaction(reactionKey, "up" | "down") 播放一次表情 */
  reactionKey?: string;
  framed?: boolean;
  labelled?: boolean;
} & HTMLAttributes<HTMLSpanElement>) {
  const tile = framed ?? (size !== "xs" && size !== "xl");
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<LiveAgent | null>(null);
  const look = useRef<ReturnType<LiveAgent["look"]>>({ state, seed: 0 });
  const accessory = appearance?.accessory && appearance.accessory !== "none" ? appearance.accessory : undefined;

  useLayoutEffect(() => {
    look.current = { color: appearance?.color, eyes: appearance?.eyes, accessory, state, seed: seedOf(name), reactionKey, framed: tile };
    // 减少动态效果时循环不走：外观变了立刻重画一帧
    if (live.current) drawLive(live.current, performance.now() / 1000);
  }, [appearance?.color, appearance?.eyes, accessory, state, name, reactionKey, tile]);

  useLayoutEffect(() => {
    const el = canvas.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    live.current = { canvas: el, box: host, look: () => look.current };
    const stop = addLiveAgent(live.current);
    return () => {
      live.current = null;
      stop();
    };
  }, []);

  const running = state === "thinking" || state === "writing";
  return (
    <span
      className={cn(
        "ac-avatar ac-avatar--agent",
        size !== "md" && `ac-avatar--${size}`,
        tile && "ac-avatar--framed",
        running && "ac-avatar--running",
        className,
      )}
      {...(labelled ? { role: "img", "aria-label": name } : { "aria-hidden": true })}
      data-state={state}
      style={{ ...appearanceStyle(appearance), ...style }}
      {...rest}
    >
      <canvas className="ac-avatar__canvas" ref={canvas} />
    </span>
  );
}
