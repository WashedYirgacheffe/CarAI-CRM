"use client";

import { useSyncExternalStore } from "react";
import { AgentAvatar } from "@/components/agentes/agent-avatar";
import { DEFAULT_PREFS, type Prefs } from "./agent-bits";

/*
 * 助手当前的名字和形象（用户在 AI 面板里可以改）。AiDock 读到 / 改了就发布到这里，
 * 页面别处的 AI 入口（手机顶栏、WhatsApp 输入框）直接用这个小角色当按钮图标。
 */
let current: Prefs | null = null;
const subs = new Set<() => void>();

export function publishAiLook(p: Prefs) {
  current = p;
  subs.forEach((f) => f());
}

function useAiLook() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
    () => null,
  );
}

/** 助手的小角色，当图标用（不带天空方块） */
export function AiMascot({ size = "sm", className }: { size?: "xs" | "sm"; className?: string }) {
  const p = useAiLook() ?? DEFAULT_PREFS;
  return <AgentAvatar name={p.name} size={size} appearance={p.look} framed={false} className={className} />;
}
