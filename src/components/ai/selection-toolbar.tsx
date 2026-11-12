"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Languages, LoaderCircle, Mail, MessageCircle, PenLine, Replace, Sparkles, WandSparkles, X } from "lucide-react";
import { toast } from "sonner";
import { translateTextsAction } from "@/app/(app)/translate-actions";
import { cn } from "@/lib/utils";

/*
 * 全局划词 AI 工具条：在任何页面框选一段文字（≥2 个字），选区上方浮出一排快捷操作——
 * 翻译（就地出结果，可复制 / 替换原文）、润色 / 仿写 / 裂变（唤起 AI 助手，先问想要的效果）、
 * 发邮件、发 WhatsApp、复制。手机上放在选区下方，避开系统自带的复制菜单。
 * 不想出现工具条的区域加 data-no-ai。
 */

export type ComposeKind = "polish" | "rewrite" | "variants";
export const AI_COMPOSE_EVENT = "crm:ai-compose";

type Sel = {
  text: string;
  rect: { top: number; bottom: number; left: number; right: number };
  /** 可编辑的选区：替换时用 */
  input: HTMLInputElement | HTMLTextAreaElement | null;
  start: number;
  end: number;
  range: Range | null;
  editable: boolean;
};

const TEXT_INPUT = new Set(["text", "search", "url", "email", ""]);

function readSelection(): Sel | null {
  const active = document.activeElement;
  // 输入框里的选区（getSelection 拿不到）
  if (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && TEXT_INPUT.has(active.type))) {
    if (active.closest("[data-no-ai]")) return null;
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    const text = active.value.slice(start, end);
    if (text.trim().length < 2) return null;
    const r = active.getBoundingClientRect();
    return {
      text,
      rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      input: active,
      start,
      end,
      range: null,
      editable: !active.readOnly && !active.disabled,
    };
  }
  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return null;
  const text = s.toString();
  if (text.trim().length < 2) return null;
  const node = s.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el || el.closest("[data-no-ai]")) return null;
  const range = s.getRangeAt(0);
  const r = range.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return {
    text,
    rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
    input: null,
    start: 0,
    end: 0,
    range: range.cloneRange(),
    editable: !!el.closest("[contenteditable=''],[contenteditable='true']"),
  };
}

export function SelectionToolbar() {
  const router = useRouter();
  const [sel, setSel] = useState<Sel | null>(null);
  const [tr, setTr] = useState<{ busy: boolean; text?: string; error?: string } | null>(null);
  const [touch, setTouch] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const down = useRef(false);
  const selRef = useRef(sel);
  useEffect(() => {
    selRef.current = sel;
  }, [sel]);

  useEffect(() => {
    let timer = 0;
    const evaluate = () => {
      const next = readSelection();
      const prev = selRef.current;
      if (!next) {
        setSel(null);
        setTr(null);
        return;
      }
      // 同一段文字只更新位置，不清掉翻译结果
      if (prev && prev.text === next.text) setSel(next);
      else {
        setSel(next);
        setTr(null);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      down.current = true;
      setTouch(e.pointerType === "touch");
    };
    const onUp = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      down.current = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, 10);
    };
    const onSelChange = () => {
      if (down.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, 350);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selRef.current) {
        setSel(null);
        setTr(null);
        return;
      }
      if (e.shiftKey || e.key === "Shift" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a")) {
        window.clearTimeout(timer);
        timer = window.setTimeout(evaluate, 150);
      }
    };
    // 滚动时跟着选区走
    const onScroll = () => {
      const s = selRef.current;
      if (!s) return;
      const r = s.input?.getBoundingClientRect() ?? s.range?.getBoundingClientRect();
      if (r) setSel({ ...s, rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("selectionchange", onSelChange);
    document.addEventListener("keyup", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("selectionchange", onSelChange);
      document.removeEventListener("keyup", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  if (!sel) return null;

  const close = () => {
    setSel(null);
    setTr(null);
  };

  const copy = async (text: string, tip = "已复制") => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(tip);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const translate = async () => {
    setTr({ busy: true });
    const r = await translateTextsAction([sel.text]).catch(() => null);
    if (r?.ok && r.t?.[0]) setTr({ busy: false, text: r.t[0] });
    else setTr({ busy: false, error: r?.message || "翻译失败，请稍后再试" });
  };

  // 把选中的原文替换成译文（只在可编辑区域）
  const replace = (text: string) => {
    if (sel.input) {
      sel.input.focus();
      sel.input.setSelectionRange(sel.start, sel.end);
    } else if (sel.range) {
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(sel.range);
    }
    // execCommand 会走浏览器的输入流程，React 受控输入框和撤销栈都正常
    if (!document.execCommand("insertText", false, text)) toast.error("这里不能直接替换，已复制译文");
    close();
  };

  const compose = (kind: ComposeKind) => {
    window.dispatchEvent(new CustomEvent(AI_COMPOSE_EVENT, { detail: { text: sel.text.trim(), kind } }));
    close();
  };

  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  // 手机上「邮件」「WA」只显示图标
  const W = Math.min(400, vw - 16);
  const left = Math.min(Math.max(8, (sel.rect.left + sel.rect.right) / 2 - W / 2), vw - W - 8);
  const below = touch || sel.rect.top < 64;
  const style: React.CSSProperties = below ? { top: sel.rect.bottom + 10, left } : { top: sel.rect.top - 10, left, transform: "translateY(-100%)" };

  const btn =
    "flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] font-medium whitespace-nowrap text-foreground/80 transition-colors hover:bg-muted hover:text-foreground max-md:h-9";

  return (
    <div
      ref={box}
      data-no-ai
      role="toolbar"
      aria-label="选中文字的快捷操作"
      onMouseDown={(e) => e.preventDefault()}
      style={{ ...style, width: W }}
      className={cn(
        "fixed z-[60] flex animate-in flex-col gap-1 duration-150 fade-in-0",
        below ? "slide-in-from-top-1" : "flex-col-reverse slide-in-from-bottom-1",
      )}
    >
      <div className="flex items-center gap-0.5 overflow-x-auto rounded-xl border bg-popover p-1 shadow-lg ring-1 ring-black/[0.04] [scrollbar-width:none]">
        <button type="button" className={cn(btn, "text-brand-ink")} onClick={translate}>
          {tr?.busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
          翻译
        </button>
        <button type="button" className={btn} onClick={() => compose("polish")}>
          <WandSparkles className="size-3.5" />
          润色
        </button>
        <button type="button" className={btn} onClick={() => compose("rewrite")}>
          <PenLine className="size-3.5" />
          仿写
        </button>
        <button type="button" className={btn} onClick={() => compose("variants")}>
          <Sparkles className="size-3.5" />
          裂变
        </button>
        <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />
        <button
          type="button"
          className={btn}
          title="用这段文字写邮件"
          onClick={() => {
            router.push(`/mail/compose?body=${encodeURIComponent(sel.text.trim().slice(0, 20000))}`);
            close();
          }}
        >
          <Mail className="size-3.5" />
          <span className="max-sm:hidden">邮件</span>
        </button>
        <button
          type="button"
          className={btn}
          title="复制后去 WhatsApp 粘贴发送"
          onClick={async () => {
            await copy(sel.text.trim(), "已复制，选好聊天后粘贴发送");
            router.push("/whatsapp");
            close();
          }}
        >
          <MessageCircle className="size-3.5" />
          <span className="max-sm:hidden">WA</span>
        </button>
        <button type="button" className={btn} title="复制" aria-label="复制" onClick={() => void copy(sel.text).then(close)}>
          <Copy className="size-3.5" />
        </button>
      </div>

      {tr && !tr.busy && (
        <div className="rounded-xl border bg-popover p-3 text-sm shadow-lg ring-1 ring-black/[0.04]">
          {tr.error ? (
            <p className="text-destructive">{tr.error}</p>
          ) : (
            <>
              <p className="max-h-48 overflow-y-auto leading-relaxed break-words whitespace-pre-wrap">{tr.text}</p>
              <div className="mt-2 flex items-center gap-1 border-t border-border/70 pt-2">
                <button type="button" className={btn} onClick={() => void copy(tr.text!)}>
                  <Copy className="size-3.5" />
                  复制译文
                </button>
                {sel.editable && (
                  <button type="button" className={btn} onClick={() => replace(tr.text!)}>
                    <Replace className="size-3.5" />
                    替换原文
                  </button>
                )}
                <button type="button" className={cn(btn, "ml-auto")} aria-label="关闭" onClick={close}>
                  <X className="size-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
