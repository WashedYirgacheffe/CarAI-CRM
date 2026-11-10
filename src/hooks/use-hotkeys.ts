"use client";

import { useEffect, useRef } from "react";

/** 正在输入（输入框、富文本、下拉）或开着弹窗时不拦快捷键 */
function typing(e: KeyboardEvent) {
  const el = e.target;
  if (el instanceof Element && el.closest("input, textarea, select, [contenteditable=''], [contenteditable=true]")) return true;
  return !!document.querySelector("[role=dialog][data-state=open], [role=menu][data-state=open]");
}

/**
 * 单键快捷键（不带 ⌘ / Ctrl / Alt）。key 用 KeyboardEvent.key，如 "j"、"?"、"Enter"、"Escape"。
 * 回调总是用最新的，不用担心闭包过期
 */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.defaultPrevented) return;
      const fn = ref.current[e.key];
      if (!fn || typing(e)) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
