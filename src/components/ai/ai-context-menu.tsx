"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { CircleCheckIcon, Copy, ExternalLink, Eye, Languages, Link2, ListChecks, Sparkles } from "@/components/icons";
import { ActionSheet } from "@/components/crm/swipe-row";
import { imageFromElement, videoAttachment, type AiAttachment } from "./ai-media";
import { cn } from "@/lib/utils";

/*
 * 全局右键菜单：在任何页面右键，第一项就是「给 AI 看看」——
 * 把右键点到的那一块（一行客户、一封邮件、一条消息、一张卡片、一张图）连同所在页面交给 AI，
 * 对话框打开、输入框就绪，说一句想做什么就行；也可以直接「总结」「翻译」。
 * 输入框里、标了 data-no-ai 的区域、按住 Shift 右键时，仍然是浏览器自己的菜单。
 *
 * 手机上没有右键：长按任何一块（一行、一张卡片）就是右键，从底部弹出同样几项。
 * 自己处理长按的地方（WhatsApp 消息、会话）标 data-long-press，这里就不管。
 */

export const AI_LOOK_EVENT = "crm:ai-look";
/** 打开 AI 对话（手机顶栏的 AI 按钮） */
export const AI_OPEN_EVENT = "crm:ai-open";
export type PageSnippet = { label: string; text: string; href?: string };
export type AiLookDetail = { snippet?: PageSnippet; attachments?: AiAttachment[]; message?: string; pending?: Promise<AiAttachment[]> };

export const lookAtThis = (d: AiLookDetail) => window.dispatchEvent(new CustomEvent<AiLookDetail>(AI_LOOK_EVENT, { detail: d }));

const BLOCKS = "tr,li,article,section,form,dialog,[role=row],[role=listitem],[role=dialog],[role=article],[data-slot=card]";
const MAX_TEXT = 5000;

const textOf = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();

/** 长得像一张卡片：有圆角，并且有底色或阴影 */
function cardLike(el: Element) {
  const s = getComputedStyle(el);
  if (parseFloat(s.borderTopLeftRadius) < 8) return false;
  return s.boxShadow !== "none" || (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent");
}

/** 右键点到的「那一块」：标了 data-ai-context 的优先，否则往上找第一个像一行 / 一张卡片、字数合适的容器 */
function blockOf(target: Element): Element {
  const tagged = target.closest("[data-ai-context]");
  if (tagged) return tagged;
  const stop = target.closest("[data-page-root]") ?? document.body;
  let best: Element = target;
  for (let el: Element | null = target; el && el !== stop && el !== document.body; el = el.parentElement) {
    const len = textOf(el).length;
    if (len > MAX_TEXT) break;
    best = el;
    if (len >= 40 && (el.matches(BLOCKS) || cardLike(el))) return el;
  }
  return best;
}

/** 给那一块起个名字：它自己的标题，或第一行字 */
export function labelOf(block: Element) {
  const own = block.getAttribute("data-ai-label") || block.getAttribute("aria-label");
  const heading = block.querySelector("h1,h2,h3,h4,[data-slot=card-title]");
  const first = textOf(block).split("\n")[0];
  const title = (own || (heading ? textOf(heading) : "") || first || "").slice(0, 60);
  const page = document.querySelector("[data-page-root] h1")?.textContent?.trim() || document.title;
  return [page, title].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ");
}

/** 右键点到的东西：哪一块、选中的字、图片 / 视频、链接 */
export type AiTarget = {
  block: Element;
  selection: string;
  image: HTMLImageElement | null;
  video: HTMLVideoElement | null;
  link: string | null;
};

/** 页面自带右键菜单的地方用：从点到的元素读出 AiTarget；选中的文字只认落在这一块里的，图片 / 视频也找这一块里的 */
export function aiTargetOf(target: Element): AiTarget {
  const block = blockOf(target);
  const sel = window.getSelection();
  const inside = !!sel && !sel.isCollapsed && sel.rangeCount > 0 && block.contains(sel.getRangeAt(0).commonAncestorContainer);
  const a = target.closest("a[href]") as HTMLAnchorElement | null;
  return {
    block,
    selection: inside ? sel!.toString().trim().slice(0, MAX_TEXT) : "",
    image: [target.closest("img"), ...block.querySelectorAll("img")].find(big) ?? null,
    video: target.closest("video") ?? block.querySelector("video"),
    link: a?.href ?? null,
  };
}

/** 头像、图标这种小图不算「这张图」 */
const big = (el: Element | null): el is HTMLImageElement => {
  if (!(el instanceof HTMLImageElement) || el.getAttribute("aria-hidden") === "true") return false;
  const r = el.getBoundingClientRect();
  return r.width >= 72 && r.height >= 48;
};

export const mediaWord = (t: AiTarget) => (t.selection ? null : t.image ? "这张图" : t.video ? "这段视频" : null);

/** 把这一块交给 AI：对话框先打开，图片 / 视频处理好了再放进去；带 message 就直接发 */
export function sendToAi(target: AiTarget, message?: string) {
  flash(target.block);
  const media = mediaWord(target);
  const text = target.selection || textOf(target.block).slice(0, MAX_TEXT);
  const snippet: PageSnippet | undefined = text
    ? {
        label: target.selection ? `${labelOf(target.block)}（选中的文字）` : labelOf(target.block),
        text,
        href: target.link ?? `${location.pathname}${location.search}`,
      }
    : undefined;
  const pending =
    target.image && !target.selection
      ? imageFromElement(target.image).then((a) => [a])
      : target.video && !target.selection
        ? videoAttachment(target.video.currentSrc || target.video.src, "页面视频").then((a) => [a])
        : undefined;
  pending?.catch(() => toast.error(`${media}读不出来，只把文字给 AI`));
  lookAtThis({ snippet, message, pending: pending?.catch(() => []) });
}

/** 右键菜单里通用的几条 AI 指令（全局菜单和页面自带菜单共用同一套说法） */
export function aiPrompts(t: AiTarget) {
  const media = mediaWord(t);
  return {
    summary: {
      label: media ? `AI 解读${media}` : "AI 总结并给建议",
      message: media ? `帮我看看${media}：是什么、有什么要注意的` : "总结一下这部分的要点，再告诉我接下来该做什么",
    },
    translate: media
      ? null
      : { label: `AI 翻译${t.selection ? "选中的文字" : "这里"}`, message: "把这部分内容翻译成中文；如果本来就是中文，就翻成地道的英文" },
    todo: { label: "AI 列出待办并起草", message: "根据这部分内容，帮我列出要跟进的事项，能起草的直接起草" },
  };
}

type Target = AiTarget & { x: number; y: number; touch?: boolean; selectable?: Element | null };

/** 列表行长按出 AI 菜单，菜单里的「多选」通过这个事件交回给那一行 */
export const SELECT_EVENT = "crm:select";

const SKIP = "input,textarea,select,button,[role=button],[contenteditable=''],[contenteditable=true],[data-no-ai],[data-ai-menu],[data-long-press]";

function flash(el: Element) {
  el.classList.remove("ac-ai-look");
  void (el as HTMLElement).offsetWidth;
  el.classList.add("ac-ai-look");
  setTimeout(() => el.classList.remove("ac-ai-look"), 1400);
}

export function AiContextMenu() {
  const [t, setT] = useState<Target | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    // ── 触屏长按 ──
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start = { x: 0, y: 0 };
    let lastTouch = 0;
    const cancel = () => clearTimeout(timer);
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      lastTouch = Date.now();
      cancel();
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest("[data-page-root]") || target.closest(SKIP)) return;
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        window.getSelection()?.removeAllRanges();
        navigator.vibrate?.(8);
        const a = target.closest("a[href]") as HTMLAnchorElement | null;
        setT({ ...aiTargetOf(target), selection: "", link: a?.href ?? null, x: start.x, y: start.y, touch: true, selectable: target.closest("[data-selectable]") });
        // 松手时的那次点击不要再打开链接：按多久都拦，松手后 400ms 内还没来就撤掉
        const block = (ev: Event) => {
          ev.preventDefault();
          ev.stopPropagation();
          off();
        };
        const off = () => {
          document.removeEventListener("click", block, { capture: true });
          document.removeEventListener("pointerup", later, { capture: true });
          document.removeEventListener("pointercancel", later, { capture: true });
        };
        const later = () => setTimeout(off, 400);
        document.addEventListener("click", block, { capture: true });
        document.addEventListener("pointerup", later, { capture: true });
        document.addEventListener("pointercancel", later, { capture: true });
      }, 480);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", cancel, { passive: true });
    document.addEventListener("pointercancel", cancel, { passive: true });
    document.addEventListener("scroll", cancel, { passive: true, capture: true });

    const onMenu = (e: MouseEvent) => {
      // 触屏长按由上面处理（安卓长按还会发一次 contextmenu）
      if (Date.now() - lastTouch < 1500) {
        if (e.target instanceof Element && e.target.closest("[data-page-root]") && !e.target.closest("input,textarea,[contenteditable=true]"))
          e.preventDefault();
        return;
      }
      if (e.shiftKey || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      if (target.closest("input,textarea,select,[contenteditable=''],[contenteditable=true],[data-no-ai],[data-ai-menu]")) return;
      if (!target.closest("[data-page-root]")) return;
      e.preventDefault();
      const sel = window.getSelection();
      const selection = sel && !sel.isCollapsed ? sel.toString().trim().slice(0, MAX_TEXT) : "";
      const a = target.closest("a[href]") as HTMLAnchorElement | null;
      setT({
        x: e.clientX,
        y: e.clientY,
        block: blockOf(target),
        selection,
        image: target.closest("img") ?? (target.querySelector?.(":scope > img") as HTMLImageElement | null),
        video: target.closest("video"),
        link: a?.href ?? null,
      });
    };
    document.addEventListener("contextmenu", onMenu);
    return () => {
      cancel();
      document.removeEventListener("contextmenu", onMenu);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", cancel);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("scroll", cancel, { capture: true });
    };
  }, []);

  // 贴着鼠标打开，放不下就往左 / 往上翻
  useLayoutEffect(() => {
    if (!t || t.touch || !menu.current) return;
    const r = menu.current.getBoundingClientRect();
    const left = t.x + r.width + 8 > window.innerWidth ? Math.max(8, t.x - r.width) : t.x;
    const top = t.y + r.height + 8 > window.innerHeight ? Math.max(8, t.y - r.height) : t.y;
    setPos({ left, top });
    menu.current.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [t]);

  useEffect(() => {
    if (!t || t.touch) return;
    const close = () => setT(null);
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [t]);

  if (!t) return null;

  const media = mediaWord(t);
  const what = t.selection ? "选中的文字" : (media ?? "这里");
  const p = aiPrompts(t);

  const look = (message?: string) => {
    const target = t;
    setT(null);
    sendToAi(target, message);
  };

  const copy = (s: string, done: string) => {
    setT(null);
    void navigator.clipboard.writeText(s).then(() => toast.success(done));
  };

  if (t.touch) {
    const text = textOf(t.block);
    return (
      <ActionSheet
        open
        onOpenChange={(v) => !v && setT(null)}
        title={labelOf(t.block)}
        items={[
          { label: `给 AI 看看${media ? media : ""}`, icon: Eye, onSelect: () => look() },
          { label: p.summary.label, icon: Sparkles, onSelect: () => look(p.summary.message) },
          { label: p.translate?.label ?? "", icon: Languages, hidden: !p.translate, onSelect: () => look(p.translate?.message) },
          { label: p.todo.label, icon: ListChecks, onSelect: () => look(p.todo.message) },
          "sep",
          { label: "复制文字", icon: Copy, hidden: !text, onSelect: () => copy(text, "已复制") },
          { label: "复制链接", icon: Link2, hidden: !t.link, onSelect: () => copy(t.link!, "链接已复制") },
          {
            label: "多选",
            icon: CircleCheckIcon,
            hidden: !t.selectable,
            onSelect: () => {
              t.selectable?.dispatchEvent(new Event(SELECT_EVENT));
              setT(null);
            },
          },
        ]}
      />
    );
  }

  const item = "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:bg-muted";

  return createPortal(
    <div
      ref={menu}
      data-ai-menu
      role="menu"
      aria-label="右键菜单"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[90] w-60 animate-in rounded-[12px] border border-line bg-popover p-1 text-popover-foreground shadow-e3 duration-100 fade-in-0 zoom-in-95"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => look()} className={cn(item, "h-10 font-medium")}>
        <span className="ac-tile size-6 shrink-0" style={{ borderRadius: "30% 30% 30% 9%" }}>
          <Eye className="size-3.5" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block leading-tight">给 AI 看看</span>
          <span className="block truncate text-[11.5px] leading-tight font-normal text-muted-foreground">把{what}交给 AI，说一句就行</span>
        </span>
      </button>
      <button type="button" role="menuitem" onClick={() => look(p.summary.message)} className={item}>
        <Sparkles className="size-4 text-muted-foreground" />
        {p.summary.label}
      </button>
      {p.translate && (
        <button type="button" role="menuitem" onClick={() => look(p.translate!.message)} className={item}>
          <Languages className="size-4 text-muted-foreground" />
          {p.translate.label}
        </button>
      )}
      <button type="button" role="menuitem" onClick={() => look(p.todo.message)} className={item}>
        <ListChecks className="size-4 text-muted-foreground" />
        {p.todo.label}
      </button>
      {(t.selection || t.link) && <div className="mx-2 my-1 h-px bg-line" role="separator" />}
      {t.selection && (
        <button type="button" role="menuitem" onClick={() => copy(t.selection, "已复制")} className={item}>
          <Copy className="size-4 text-muted-foreground" />
          复制
        </button>
      )}
      {t.link && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setT(null);
              window.open(t.link!, "_blank", "noopener");
            }}
            className={item}
          >
            <ExternalLink className="size-4 text-muted-foreground" />
            在新标签页打开
          </button>
          <button type="button" role="menuitem" onClick={() => copy(t.link!, "链接已复制")} className={item}>
            <Link2 className="size-4 text-muted-foreground" />
            复制链接
          </button>
        </>
      )}
      <p className="px-2.5 pt-1.5 pb-1 text-[11px] text-muted-foreground/80 max-md:hidden">Shift + 右键 打开浏览器菜单</p>
    </div>,
    document.body,
  );
}
