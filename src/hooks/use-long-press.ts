"use client";

import { useRef } from "react";

/**
 * 触屏长按（手机上的「右键」）：按住 ms 毫秒不动就触发，手指移动超过 10px（在滚动）就取消。
 * 鼠标不响应（电脑用右键）。触发后吞掉紧跟着的那次点击和浏览器自带的长按菜单。
 * 一个组件里只需要一个：`const press = useLongPress(); <div {...press(() => open(m))} />`
 */
export function useLongPress(ms = 420) {
  const s = useRef<{ t?: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false });
  const cancel = () => clearTimeout(s.current.t);
  return (onLong: (el: HTMLElement) => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" || e.button !== 0) return;
      cancel();
      const el = e.currentTarget;
      s.current = {
        x: e.clientX,
        y: e.clientY,
        fired: false,
        t: setTimeout(() => {
          s.current.fired = true;
          window.getSelection()?.removeAllRanges();
          navigator.vibrate?.(8);
          onLong(el);
        }, ms),
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (Math.hypot(e.clientX - s.current.x, e.clientY - s.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      // 安卓长按会再发一次 contextmenu；触屏上一律不出浏览器菜单
      if (s.current.fired || (e.nativeEvent as PointerEvent).pointerType === "touch") e.preventDefault();
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (!s.current.fired) return;
      s.current.fired = false;
      e.preventDefault();
      e.stopPropagation();
    },
  });
}
