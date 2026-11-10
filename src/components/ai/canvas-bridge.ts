"use client";

import type { CanvasLayout } from "@/lib/canvas";

/** 全局 AI 浮窗和工作台画布之间的桥：画布在页面上时直接改；不在时先记下来，回到工作台再摆 */

export type WorkspaceEvent =
  | { t: "workspace"; op: "open"; id: string; layout: CanvasLayout }
  | { t: "workspace"; op: "saved"; id: string; name: string; layout: CanvasLayout; home: boolean };

export type CanvasHandle = {
  layout: () => CanvasLayout;
  active: () => string;
  onLayout: (l: CanvasLayout) => void;
  /** 返回切换后的画布 */
  onWorkspace: (e: WorkspaceEvent) => CanvasLayout;
};

type Pending = { layout?: CanvasLayout; workspace?: WorkspaceEvent };

let handle: CanvasHandle | null = null;
let last: { layout: CanvasLayout; active: string } | null = null;
let pending: Pending | null = null;

export function registerCanvas(h: CanvasHandle) {
  handle = h;
  // 不在工作台时 AI 摆好的东西：回来先切情景再摆组件
  const p = pending;
  pending = null;
  if (p?.workspace) h.onWorkspace(p.workspace);
  if (p?.layout) h.onLayout(p.layout);
  return () => {
    if (handle !== h) return;
    last = { layout: h.layout(), active: h.active() };
    handle = null;
  };
}

export const canvasOnPage = () => !!handle;

/** 发给 AI 的画布：在工作台就是当前画布，不在就是上次离开时的样子 */
export const canvasSnapshot = () => (handle ? { layout: handle.layout(), active: handle.active() } : (last ?? { layout: null, active: undefined }));

export function applyLayout(l: CanvasLayout) {
  if (handle) return handle.onLayout(l);
  pending = { ...pending, layout: l };
  last = { layout: l, active: last?.active ?? "" };
}

export function applyWorkspace(e: WorkspaceEvent): CanvasLayout {
  if (handle) return handle.onWorkspace(e);
  // 切情景后之前摆的组件作废
  pending = { workspace: e };
  last = { layout: e.layout, active: e.id };
  return e.layout;
}
