"use client";

import { useEffect } from "react";

/** 嵌在工作台里时：点到嵌入页以外的链接，交给外层工作台去跳转，而不是在小窗口里打开整个后台 */
export function EmbedLinks() {
  useEffect(() => {
    if (window.parent === window) return;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/embed") || url.pathname.startsWith("/api")) return;
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage({ type: "crm:navigate", href: url.pathname + url.search + url.hash }, location.origin);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
