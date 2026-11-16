"use client";

import { useSyncExternalStore, ViewTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/*
 * 列表进详情的「共享元素」（UI 连续性）：
 * 点一行时记下它的 key 和名字（setHero），列表行、加载骨架、详情页里 key 对上的那个元素
 * 带上同一个 view-transition-name，浏览器在两个画面之间把它从原位置移到新位置、字号跟着缩放。
 *
 * - 名字用 CSS 类给（.vt-hero-*，见 globals.css），不用 React 的 <ViewTransition name>：
 *   手机上 WhatsApp / 邮件的列表切到会话时只是隐藏、不卸载，React 配不上对，浏览器按名字能配上。
 * - 只有从我们的入口点进去 / 点返回时播动画：点击时在 <html> 上标 data-vt（forward / back），过渡结束后清掉。
 *   不用 React 的 transitionTypes：路由有时会先提交一次不带过渡的中间状态，把类型「用掉」，方向就丢了。
 *   浏览器自己的后退（含 iOS 右滑）、自动刷新等没有标记，保持原来的硬切。
 * - scope 决定哪种布局下才共享：电脑上 WhatsApp / 邮件是左右分栏，列表和右栏同时在屏上，不做移动。
 */

export type Hero = {
  key: string;
  name: string;
  avatar?: string | null;
  phone?: string | null;
};
export type HeroScope = "all" | "md" | "lg";

let hero: Hero | null = null;
const listeners = new Set<() => void>();
let raf = 0;
let pending = false;

/** 过渡跑完后再通知订阅者重渲染（类名和点击时直接写到 DOM 上的一样，画面不变） */
function flush() {
  if (!pending) return;
  pending = false;
  for (const l of listeners) l();
}

/**
 * React 认为 <ViewTransition> 之外的内容「没参与过渡」时，会用脚本动画把旧画面整层（group(root)）设成透明，
 * 让它们硬切。我们的列表就在边界之外：不撤掉的话，过渡开头旧列表直接消失、整屏空白，共享元素孤零零地飞。
 * 只在我们标了方向的导航里撤掉，旧画面按 globals.css 慢慢淡出、露出下面的新页面。
 */
function keepOldRoot(root: HTMLElement) {
  for (const a of document.getAnimations()) {
    const fx = a.effect as KeyframeEffect | null;
    if (fx?.target !== root || "animationName" in a) continue;
    if (fx.pseudoElement === "::view-transition-group(root)" || fx.pseudoElement === "::view-transition") a.cancel();
  }
}

/** 标记这次切换的方向；页面上的过渡跑完（或 4 秒没等到）就清掉 */
function markNav(dir: "forward" | "back" | "switch") {
  const root = document.documentElement;
  root.dataset.vt = dir;
  cancelAnimationFrame(raf);
  const start = performance.now();
  let lastActive = 0;
  const tick = (now: number) => {
    let active = false;
    try {
      active = root.matches(":active-view-transition");
    } catch {
      // 不支持这个选择器的浏览器：1.5 秒后清
      if (now - start > 1500) {
        delete root.dataset.vt;
        return flush();
      }
    }
    if (active) {
      lastActive = now;
      keepOldRoot(root);
    }
    // 跑完一段过渡后再等一会儿：骨架换成真内容还会有第二段
    if ((lastActive && !active && now - lastActive > 600) || now - start > 4000) {
      delete root.dataset.vt;
      return flush();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

const WIDE: Record<HeroScope, string | null> = { all: null, md: "(min-width: 768px)", lg: "(min-width: 1024px)" };

const ON = ["vt-hero-name", "vt-hero-avatar"];
const SCOPES = ["vt-all", "vt-md", "vt-lg"];

/**
 * 点列表行时调用：记下共享元素，并标记「前进」。
 * scope 对应的宽度下不共享（电脑上左右分栏）时，只是右栏换内容，标记成「切换」：内容区直接交叉淡化。
 *
 * 不能在点击时让订阅的组件重渲染：那是一次同步提交，会把路由的跳转一起提前提交（列表直接换成骨架、不进过渡），
 * 浏览器拍到的旧画面里就没有列表了。所以点到的那一行（el：被点的链接）直接在 DOM 上加类名，
 * 别处残留的共享名先去掉（同名两个会让过渡作废），过渡跑完再通知组件。
 */
export function setHero(next: Hero, scope: HeroScope = "all", el?: Element | null) {
  hero = next;
  pending = true;
  for (const n of document.querySelectorAll(".vt-hero-name, .vt-hero-avatar")) n.classList.remove(...ON, ...SCOPES);
  if (el) {
    const pick = (marker: string) => (el.classList.contains(marker) ? el : el.querySelector(`.${marker}`));
    pick("vt-n")?.classList.add("vt-hero-name", `vt-${scope}`);
    pick("vt-a")?.classList.add("vt-hero-avatar", `vt-${scope}`);
  }
  const wide = WIDE[scope];
  markNav(wide && window.matchMedia(wide).matches ? "switch" : "forward");
}

/** 详情之间切换（邮件 j / k）：只让内容区淡入淡出，不移动标题 */
export function markSwitch() {
  markNav("switch");
}

/** 点详情里的「返回」时调用 */
export function markBack() {
  markNav("back");
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useHero(): Hero | null {
  return useSyncExternalStore(
    subscribe,
    () => hero,
    () => null,
  );
}

/**
 * 共享元素的类名（名字 / 头像）：key 对上时带共享名；
 * 另外始终带记号 vt-n / vt-a（无样式），点击时 setHero 靠它在被点的那一行里找到名字和头像
 */
export function useHeroClass(key: string, scope: HeroScope = "all") {
  const h = useHero();
  const on = h?.key === key;
  return {
    name: on ? `vt-n vt-hero-name vt-${scope}` : "vt-n",
    avatar: on ? `vt-a vt-hero-avatar vt-${scope}` : "vt-a",
  };
}

/**
 * 包住详情一侧的整页内容（骨架、详情页、打开的会话）。
 * React 只在「新插入的子树最外层」的 <ViewTransition> 挂上 / 卸下时才用 document.startViewTransition 包住这次提交，
 * 浏览器才会去配对上面那些 CSS 名字，所以它必须是页面的最外层，不能嵌在新元素里。
 * 进出场类名 vt-page：有方向标记时内容区淡入淡出（globals.css），其它切换不播；内容更新（刷新）不触发。
 */
export function HeroPage({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition default="none" enter="vt-page" exit="vt-page">
      {children}
    </ViewTransition>
  );
}

/** 共享元素的文字（列表行里的名字 / 主题，详情的标题）：key 对上时带共享名 */
export function HeroText({
  heroKey,
  scope = "all",
  as: Tag = "span",
  className,
  children,
}: {
  heroKey: string;
  scope?: HeroScope;
  as?: "span" | "p" | "h1" | "h2";
  className?: string;
  children: React.ReactNode;
}) {
  const cls = useHeroClass(heroKey, scope);
  return <Tag className={cn(className, cls.name)}>{children}</Tag>;
}

/** 服务端渲染的列表行用：点击时记下共享元素（其余和 Link 一样） */
export function HeroLink({ hero, scope = "all", onClick, ...props }: React.ComponentProps<typeof Link> & { hero: Hero; scope?: HeroScope }) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) setHero(hero, scope, e.currentTarget);
      }}
    />
  );
}

/** 服务端渲染的「返回」链接用：点击时标记返回 */
export function BackLink({ onClick, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        onClick?.(e);
        markBack();
      }}
    />
  );
}
