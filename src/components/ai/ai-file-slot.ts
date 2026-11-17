"use client";

import { useSyncExternalStore } from "react";

/*
 * 文件预览窗右侧的 AI 栏：预览窗放一个插槽，AiDock 把对话界面 portal 进去（跟工作台的 ai-stage 一个思路）。
 * viewing = 正在看的文件，发消息时带给服务端，AI 直接拿到文件内容。
 * ask：预览窗上「AI 总结」之类的按钮，让 AiDock 替用户发一句话。
 */

export type Viewing = { name: string; fileId?: string; waMessageId?: string; mailId?: string; attId?: string };
type FileSlot = {
  /** AiDock 挂上了（用户能用 AI） */
  ready: boolean;
  slot: HTMLElement | null;
  viewing: Viewing | null;
  ask: { text: string; n: number } | null;
  close: (() => void) | null;
};

const SERVER: FileSlot = { ready: false, slot: null, viewing: null, ask: null, close: null };
let state: FileSlot = SERVER;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const patch = (p: Partial<FileSlot>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

export const useFileSlot = () =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  );
export const getFileSlot = () => state;

export const setFileAiReady = (ready: boolean) => state.ready !== ready && patch({ ready });

/** 预览窗打开 AI 栏：slot = 插槽元素；close = 用户在对话头上点关闭 */
export function attachFileSlot(slot: HTMLElement, viewing: Viewing, close: () => void) {
  patch({ slot, viewing, close });
  return () => {
    if (state.slot === slot) patch({ slot: null, viewing: null, close: null, ask: null });
  };
}

let n = 0;
export const askAboutFile = (text: string) => patch({ ask: { text, n: ++n } });
export const takeFileAsk = () => {
  const a = state.ask;
  if (a) state = { ...state, ask: null };
  return a;
};
