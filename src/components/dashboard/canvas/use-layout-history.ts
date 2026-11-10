"use client";

import { useCallback, useReducer } from "react";
import type { CanvasLayout } from "@/lib/canvas";

type State = { past: CanvasLayout[]; present: CanvasLayout; future: CanvasLayout[] };
type Act = { t: "set"; layout: CanvasLayout } | { t: "reset"; layout: CanvasLayout } | { t: "undo" } | { t: "redo" };

const LIMIT = 50;

function reducer(s: State, a: Act): State {
  switch (a.t) {
    case "set":
      return { past: [...s.past, s.present].slice(-LIMIT), present: a.layout, future: [] };
    case "reset":
      return { past: [], present: a.layout, future: [] };
    case "undo":
      if (!s.past.length) return s;
      return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] };
    case "redo":
      if (!s.future.length) return s;
      return { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) };
  }
}

/** 画布布局 + 撤销 / 重做 */
export function useLayoutHistory(initial: CanvasLayout) {
  const [s, dispatch] = useReducer(reducer, { past: [], present: initial, future: [] });
  return {
    layout: s.present,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    set: useCallback((layout: CanvasLayout) => dispatch({ t: "set", layout }), []),
    reset: useCallback((layout: CanvasLayout) => dispatch({ t: "reset", layout }), []),
    undo: useCallback(() => dispatch({ t: "undo" }), []),
    redo: useCallback(() => dispatch({ t: "redo" }), []),
  };
}
