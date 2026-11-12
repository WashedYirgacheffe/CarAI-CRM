"use client";

import { useImperativeHandle, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/*
 * 带「变量标注块」的输入框：{{first_name}} 这类变量显示成浅橙色小块（不可拆开编辑，退格整块删除），
 * 对外的 value 仍然是带 {{变量}} 的纯文本，后端和发送逻辑不用改。
 * 用 contentEditable 实现：外部 value 变化（套模板、插变量）时重绘，用户输入时只回传、不重绘，光标不跳。
 */

export type TokenVar = { key: string; label: string; sample?: string };
export type TokenEditorHandle = { insert: (key: string) => void; focus: () => void };

const TOKEN = /\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g;
const CHIP =
  "mx-0.5 inline-flex items-center rounded-md bg-brand-soft px-1.5 align-baseline text-[0.86em] leading-[1.6] font-medium text-brand-ink whitespace-nowrap select-all cursor-default";

function chip(doc: Document, key: string, vars: TokenVar[]) {
  const v = vars.find((x) => x.key === key);
  const el = doc.createElement("span");
  el.contentEditable = "false";
  el.dataset.var = key;
  el.className = CHIP;
  el.textContent = v?.label ?? key;
  if (v?.sample) el.title = `示例：${v.sample}`;
  return el;
}

function paint(root: HTMLElement, value: string, vars: TokenVar[]) {
  const doc = root.ownerDocument;
  root.replaceChildren();
  let last = 0;
  for (const m of value.matchAll(TOKEN)) {
    if (m.index! > last) root.appendChild(doc.createTextNode(value.slice(last, m.index)));
    root.appendChild(chip(doc, m[1], vars));
    last = m.index! + m[0].length;
  }
  if (last < value.length) root.appendChild(doc.createTextNode(value.slice(last)));
  // 结尾的换行要多一个占位，否则光标显示不到新的一行
  if (value.endsWith("\n")) {
    const br = doc.createElement("br");
    br.dataset.sentinel = "";
    root.appendChild(br);
  }
}

function serialize(root: Node): string {
  let out = "";
  root.childNodes.forEach((n, i) => {
    if (n.nodeType === Node.TEXT_NODE) out += (n.textContent ?? "").replace(/\u00a0/g, " ");
    else if (n instanceof HTMLElement) {
      if (n.dataset.var) out += `{{${n.dataset.var}}}`;
      else if (n.tagName === "BR") out += n.dataset.sentinel !== undefined ? "" : "\n";
      else if (n.tagName === "DIV" || n.tagName === "P") out += (i > 0 && !out.endsWith("\n") ? "\n" : "") + serialize(n);
      else out += serialize(n);
    }
  });
  return out;
}

export function TokenEditor({
  ref,
  value,
  onChange,
  vars,
  multiline = false,
  placeholder,
  className,
  onFocus,
  "aria-label": ariaLabel,
}: {
  ref?: React.Ref<TokenEditorHandle>;
  value: string;
  onChange: (v: string) => void;
  vars: TokenVar[];
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  onFocus?: () => void;
  "aria-label"?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const saved = useRef<Range | null>(null);

  // 外部改了值（不是自己刚回传的）才重绘；DOM 被换掉 / 清空（如水合、开发模式重挂载）时也补画
  useLayoutEffect(() => {
    if (!el.current) return;
    const shown = serialize(el.current);
    if (value === emitted.current && (multiline ? shown : shown.replace(/\n/g, " ")) === value) return;
    paint(el.current, value, vars);
    emitted.current = value;
  }, [value, vars, multiline]);

  const emit = () => {
    if (!el.current) return;
    let v = serialize(el.current);
    if (!multiline) v = v.replace(/\n/g, " ");
    emitted.current = v;
    onChange(v);
  };

  const remember = () => {
    const s = window.getSelection();
    if (s?.rangeCount && el.current?.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange();
  };

  const insertNode = (node: Node) => {
    const root = el.current;
    if (!root) return;
    const s = window.getSelection();
    let r = s?.rangeCount && root.contains(s.anchorNode) ? s.getRangeAt(0) : saved.current;
    if (!r || !root.contains(r.startContainer)) {
      r = document.createRange();
      r.selectNodeContents(root);
      r.collapse(false);
      const sentinel = root.querySelector("br[data-sentinel]");
      if (sentinel) r.setStartBefore(sentinel);
    }
    r.deleteContents();
    r.insertNode(node);
    r.setStartAfter(node);
    r.collapse(true);
    s?.removeAllRanges();
    s?.addRange(r);
    saved.current = r.cloneRange();
  };

  useImperativeHandle(ref, () => ({
    focus: () => el.current?.focus(),
    insert: (key) => {
      el.current?.focus();
      insertNode(chip(document, key, vars));
      emit();
    },
  }));

  return (
    <div
      ref={el}
      role="textbox"
      aria-multiline={multiline}
      aria-label={ariaLabel}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      onInput={emit}
      onFocus={onFocus}
      onKeyUp={remember}
      onMouseUp={remember}
      onBlur={() => {
        remember();
        // 手打的 {{变量}} 失焦后变成标注块
        if (el.current && TOKEN.test(el.current.textContent ?? "")) {
          TOKEN.lastIndex = 0;
          const v = serialize(el.current);
          paint(el.current, v, vars);
          emitted.current = v;
        }
        TOKEN.lastIndex = 0;
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        e.preventDefault();
        if (!multiline) return;
        insertNode(document.createTextNode("\n"));
        const root = el.current!;
        if (!root.querySelector("br[data-sentinel]") && serialize(root).endsWith("\n")) {
          const br = document.createElement("br");
          br.dataset.sentinel = "";
          root.appendChild(br);
        }
        emit();
      }}
      onPaste={(e) => {
        e.preventDefault();
        let text = e.clipboardData.getData("text/plain");
        if (!multiline) text = text.replace(/\s*\n\s*/g, " ");
        insertNode(document.createTextNode(text));
        emit();
      }}
      className={cn(
        "w-full rounded-xl border border-input bg-card px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap outline-none transition-colors",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
        multiline ? "min-h-40 max-md:text-base" : "overflow-x-auto whitespace-pre [scrollbar-width:none] max-md:text-base",
        className,
      )}
    />
  );
}
