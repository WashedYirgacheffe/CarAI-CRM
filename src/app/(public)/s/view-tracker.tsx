"use client";

import { useEffect } from "react";

type Kind = "q" | "inquiry" | "shipping" | "p";
type Ev = { at: number; type: "section" | "click" | "hide" | "show"; name?: string };

const ENDPOINT = "/s/v";
const HEARTBEAT_MS = 10_000;

/**
 * 公开页面的访问记录：打开时报一次，之后每 10 秒（页面在前台时）报停留时长、看到哪一块、点了什么。
 * 区块用 data-track-section="名字" 标出，按钮 / 链接用 data-track-click="名字"。
 */
export function ViewTracker({ kind, token }: { kind: Kind; token: string }) {
  useEffect(() => {
    let visit: { id: string; sig: string } | null = null;
    let stopped = false;
    let activeMs = 0;
    let maxScroll = 0;
    let since = document.visibilityState === "visible" ? performance.now() : 0;
    const sections: Record<string, number> = {};
    const events: Ev[] = [];
    // 正在看的区块：可见面积最大的那块
    const ratios = new Map<string, number>();
    let current: string | null = null;
    let currentSince = 0;

    const now = () => performance.now();
    const visible = () => document.visibilityState === "visible";

    function flushTime() {
      const t = now();
      if (since) activeMs += t - since;
      if (current && currentSince) sections[current] = (sections[current] ?? 0) + (t - currentSince);
      since = visible() ? t : 0;
      currentSince = visible() && current ? t : 0;
    }

    function pickSection() {
      let best: string | null = null;
      let bestRatio = 0.15;
      for (const [name, r] of ratios) if (r > bestRatio) [best, bestRatio] = [name, r];
      if (best === current) return;
      flushTime();
      current = best;
      currentSince = best && visible() ? now() : 0;
      if (best) events.push({ at: Date.now(), type: "section", name: best });
    }

    function payload() {
      flushTime();
      const body = {
        op: "ping",
        ...visit,
        activeMs: Math.round(activeMs),
        maxScroll,
        sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, Math.round(v)])),
        events: events.splice(0),
      };
      activeMs = 0;
      for (const k of Object.keys(sections)) delete sections[k];
      return JSON.stringify(body);
    }

    function send(beacon = false) {
      if (!visit || stopped) return;
      const body = payload();
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, body);
      else void fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {});
    }

    const onScroll = () => {
      const h = document.documentElement;
      const pct = Math.round(((h.scrollTop + window.innerHeight) / Math.max(h.scrollHeight, 1)) * 100);
      if (pct > maxScroll) maxScroll = Math.min(100, pct);
    };
    const onVisibility = () => {
      events.push({ at: Date.now(), type: visible() ? "show" : "hide" });
      if (visible()) {
        since = now();
        if (current) currentSince = since;
      } else send(true);
    };
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-track-click]");
      const name = el?.getAttribute("data-track-click");
      if (!name) return;
      events.push({ at: Date.now(), type: "click", name });
      // 点了联系方式多半要离开页面，马上报
      send(true);
    };
    const onHide = () => send(true);

    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const name = (en.target as HTMLElement).dataset.trackSection;
          if (!name) continue;
          // 区块比屏幕高时按占屏比例算
          const r = en.intersectionRect.height / Math.min(en.boundingClientRect.height || 1, window.innerHeight);
          ratios.set(name, en.isIntersecting ? r : 0);
        }
        pickSection();
      },
      { threshold: [0, 0.15, 0.3, 0.5, 0.75, 1] },
    );

    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ op: "start", kind, token, referrer: document.referrer || null }),
    })
      .then((r) => r.json())
      .then((r: { id?: string; sig?: string }) => {
        if (stopped || !r.id || !r.sig) return;
        visit = { id: r.id, sig: r.sig };
        document.querySelectorAll<HTMLElement>("[data-track-section]").forEach((el) => io.observe(el));
      })
      .catch(() => {});

    onScroll();
    const timer = setInterval(() => visible() && send(), HEARTBEAT_MS);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", onHide);
    return () => {
      send(true);
      stopped = true;
      clearInterval(timer);
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", onHide);
    };
  }, [kind, token]);
  return null;
}
