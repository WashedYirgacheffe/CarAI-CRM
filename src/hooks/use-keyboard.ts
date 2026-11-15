"use client";

import { useEffect } from "react";

const TEXT = "textarea, [contenteditable=''], [contenteditable=true], input:not([type=checkbox],[type=radio],[type=button],[type=submit],[type=reset],[type=file],[type=range],[type=color])";

/**
 * 手机软键盘：输入框获得焦点时在 <html> 上标 data-kb，并把「看得见的那块」写成 CSS 变量
 * --vv-top / --vv-h（键盘弹起后 iOS 会把页面往上推、可视区变矮）。
 * 用焦点判断而不是窗口高度：iOS 有的版本 innerHeight 会跟着变，靠高度差判断不可靠。
 * CSS 里据此：藏底部标签栏、去掉底部安全区留白、把顶栏留在可视区里（见 globals.css）。
 */
export function useKeyboard() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const root = document.documentElement;
    const vv = window.visualViewport;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!vv) return;
        root.style.setProperty("--vv-top", `${vv.offsetTop}px`);
        root.style.setProperty("--vv-h", `${vv.height}px`);
      });
    };
    const on = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.matches(TEXT)) {
        root.dataset.kb = "";
        sync();
      }
    };
    const off = () => {
      // 焦点在两个输入框之间切换时不要闪一下
      setTimeout(() => {
        const a = document.activeElement;
        if (!(a instanceof Element && a.matches(TEXT))) delete root.dataset.kb;
        sync();
      }, 60);
    };
    sync();
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      delete root.dataset.kb;
    };
  }, []);
}
