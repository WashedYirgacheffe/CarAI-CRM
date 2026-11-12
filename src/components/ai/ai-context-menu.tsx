"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Copy, ExternalLink, Eye, Languages, Link2, ListChecks, Sparkles } from "@/components/icons";
import { imageFromElement, videoAttachment, type AiAttachment } from "./ai-media";
import { cn } from "@/lib/utils";

/*
 * 全局右键菜单：在任何页面右键，第一项就是「给 AI 看看」——
 * 把右键点到的那一块（一行客户、一封邮件、一条消息、一张卡片、一张图）连同所在页面交给 AI，
 * 对话框打开、输入框就绪，说一句想做什么就行；也可以直接「总结」「翻译」。
 * 输入框里、标了 data-no-ai 的区域、按住 Shift 右键时，仍然是浏览器自己的菜单。
 */

export const AI_LOOK_EVENT = "crm:ai-look";
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
function labelOf(block: Element) {
  const own = block.getAttribute("data-ai-label") || block.getAttribute("aria-label");
  const heading = block.querySelector("h1,h2,h3,h4,[data-slot=card-title]");
  const first = textOf(block).split("\n")[0];
  const title = (own || (heading ? textOf(heading) : "") || first || "").slice(0, 60);
  const page = document.querySelector("[data-page-root] h1")?.textContent?.trim() || document.title;
  return [page, title].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ");
}

type Target = {
  x: number;
  y: number;
  block: Element;
  selection: string;
  image: HTMLImageElement | null;
  video: HTMLVideoElement | null;
  link: string | null;
};

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
    const onMenu = (e: MouseEvent) => {
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
    return () => document.removeEventListener("contextmenu", onMenu);
  }, []);

  // 贴着鼠标打开，放不下就往左 / 往上翻
  useLayoutEffect(() => {
    if (!t || !menu.current) return;
    const r = menu.current.getBoundingClientRect();
    const left = t.x + r.width + 8 > window.innerWidth ? Math.max(8, t.x - r.width) : t.x;
    const top = t.y + r.height + 8 > window.innerHeight ? Math.max(8, t.y - r.height) : t.y;
    setPos({ left, top });
    menu.current.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [t]);

  useEffect(() => {
    if (!t) return;
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

  const media = t.image ? "这张图" : t.video ? "这段视频" : null;
  const what = t.selection ? "选中的文字" : (media ?? "这里");

  const look = (message?: string) => {
    const target = t;
    setT(null);
    flash(target.block);
    const text = target.selection || textOf(target.block).slice(0, MAX_TEXT);
    const snippet: PageSnippet | undefined = text
      ? {
          label: target.selection ? `${labelOf(target.block)}（选中的文字）` : labelOf(target.block),
          text,
          href: target.link ?? `${location.pathname}${location.search}`,
        }
      : undefined;
    // 图片、视频要先下载 / 抽帧，对话框先打开，处理好了再放进去
    const pending =
      target.image && !target.selection
        ? imageFromElement(target.image).then((a) => [a])
        : target.video && !target.selection
          ? videoAttachment(target.video.currentSrc || target.video.src, "页面视频").then((a) => [a])
          : undefined;
    pending?.catch(() => toast.error(`${media}读不出来，只把文字给 AI`));
    lookAtThis({ snippet, message, pending: pending?.catch(() => []) });
  };

  const copy = (s: string, done: string) => {
    setT(null);
    void navigator.clipboard.writeText(s).then(() => toast.success(done));
  };

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
      <button
        type="button"
        role="menuitem"
        onClick={() => look(media ? `帮我看看${media}：是什么、有什么要注意的` : "总结一下这部分的要点，再告诉我接下来该做什么")}
        className={item}
      >
        <Sparkles className="size-4 text-muted-foreground" />
        {media ? `AI 解读${media}` : "AI 总结并给建议"}
      </button>
      {!media && (
        <button type="button" role="menuitem" onClick={() => look("把这部分内容翻译成中文；如果本来就是中文，就翻成地道的英文")} className={item}>
          <Languages className="size-4 text-muted-foreground" />
          AI 翻译{t.selection ? "选中的文字" : "这里"}
        </button>
      )}
      <button type="button" role="menuitem" onClick={() => look("根据这部分内容，帮我列出要跟进的事项，能起草的直接起草")} className={item}>
        <ListChecks className="size-4 text-muted-foreground" />
        AI 列出待办并起草
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
