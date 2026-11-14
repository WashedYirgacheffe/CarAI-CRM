"use client";

import { useEffect, useState } from "react";

/**
 * 手机上「真正看得见」的那块区域（键盘弹出后会变矮、iOS 还会把页面往上推）。
 * 全屏的聊天页、AI 面板按它定位，输入框就始终贴在键盘上方，不会被盖住。
 * 不支持或没开启时返回 null，按 CSS 的 inset-0 走。
 */
export function useVisualViewport(enabled = true) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) return;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setBox({ top: vv.offsetTop, height: vv.height }));
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      setBox(null);
    };
  }, [enabled]);
  return box;
}
