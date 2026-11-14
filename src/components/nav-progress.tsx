"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/*
 * 点了链接、新页面还没到的这段时间：
 * - 侧栏立刻高亮要去的模块（usePendingPath）
 * - 顶部一条细进度条（NavProgress）
 * 网络慢时（国内到香港服务器往返几百毫秒）点了不再像没反应。
 */

let pending: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();

function setPending(path: string | null) {
  clearTimeout(timer);
  // 链接被别的代码拦下、没真的跳转时，不能一直挂着
  if (path) timer = setTimeout(() => setPending(null), 12_000);
  if (pending === path) return;
  pending = path;
  for (const f of subs) f();
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

/** 正在去的页面路径（不含查询参数）；没有在跳转时为 null */
export function usePendingPath() {
  return useSyncExternalStore(
    subscribe,
    () => pending,
    () => null,
  );
}

/** 普通左键点站内链接、且确实换页面（路径或查询参数不同）时，返回目标地址 */
function targetOf(e: MouseEvent): URL | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!(a instanceof HTMLAnchorElement)) return null;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return url;
}

/** 顶部进度条；放在外壳里，同时负责监听点击和页面换好 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const path = usePendingPath();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const url = targetOf(e);
      if (url) setPending(url.pathname);
    };
    const onPop = () => setPending(null);
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // 地址变了（新页面或它的加载骨架已经出来）：跳转结束
  useEffect(() => setPending(null), [pathname, search]);

  // 已经预取好的页面几十毫秒就换过去了，过 120ms 还没到才出进度条；到了以后走满、淡出
  useEffect(() => {
    const t = setTimeout(() => setShown(!!path), path ? 120 : 450);
    return () => clearTimeout(t);
  }, [path]);
  const phase = !shown ? "idle" : path ? "run" : "done";

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 origin-left bg-primary motion-reduce:transition-none",
        phase === "idle" && "scale-x-0 opacity-0",
        phase === "run" && "scale-x-[0.85] opacity-100 transition-transform duration-[8000ms] ease-[cubic-bezier(0.1,0.8,0.2,1)]",
        phase === "done" && "scale-x-100 opacity-0 transition-[transform,opacity] duration-300",
      )}
    />
  );
}
