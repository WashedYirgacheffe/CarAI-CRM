"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "@/components/icons";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { noAutofill } from "@/lib/no-autofill";

type Hit = { id: string; title: string; sub: string; href: string };
type Group = { key: string; label: string; hits: Hit[] };

/** 顶栏全局搜索：客户、联系人、线索、商机、报价单、订单、产品。⌘K / Ctrl+K 打开 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((g: Group[]) => {
          setGroups(g);
          setActive(0);
          setLoading(false);
        })
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  // 给每条结果编上全局序号，方便键盘上下选择
  const indexed = useMemo(() => {
    let i = 0;
    return groups.map((g) => ({ ...g, hits: g.hits.map((h) => ({ ...h, i: i++ })) }));
  }, [groups]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  const shown = q.trim() ? indexed : [];

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    setOpen(false);
    setQ("");
    router.push(hit.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center gap-2 rounded-full text-sm sm:border sm:border-border sm:bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:h-10 sm:w-[min(100%,28rem)] sm:justify-start sm:px-4"
        aria-label="全局搜索"
      >
        <Search className="size-4" />
        <span className="hidden flex-1 text-left sm:inline">搜索客户、线索、单据…</span>
        <kbd className="hidden rounded-md bg-muted px-2 py-0.5 font-sans text-[10px] sm:inline">⌘K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="inset-x-2 top-[calc(env(safe-area-inset-top)+0.5rem)] bottom-auto w-auto gap-0 overflow-hidden rounded-2xl p-0 data-open:slide-in-from-top-4 data-closed:slide-out-to-top-4 sm:inset-x-auto sm:top-[15%] sm:w-full sm:max-w-xl sm:translate-y-0 sm:rounded-3xl [&>[data-slot=dialog-handle]]:hidden"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">全局搜索</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3">
            {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <Search className="size-4 text-muted-foreground" />}
            <input
              {...noAutofill}
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLoading(!!e.target.value.trim());
                if (!e.target.value.trim()) setGroups([]);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(flat.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  go(flat[active]);
                }
              }}
              placeholder="客户名、邮箱、单号、产品货号…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-1.5">
            {!q.trim() && <p className="px-3 py-6 text-center text-sm text-muted-foreground">输入关键字，按 ↑↓ 选择，回车打开</p>}
            {q.trim() && !loading && shown.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">没有找到「{q.trim()}」相关的数据</p>
            )}
            {shown.map((g) => (
              <div key={g.key} className="mb-1">
                <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
                {g.hits.map((h) => {
                  const i = h.i;
                  return (
                    <button
                      key={`${g.key}-${h.id}`}
                      type="button"
                      data-index={i}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(h)}
                      className={cn("flex w-full flex-col rounded-xl px-2.5 py-1.5 text-left", i === active && "bg-accent text-accent-foreground")}
                    >
                      <span className="truncate text-sm">{h.title}</span>
                      {h.sub && <span className="truncate text-xs text-muted-foreground">{h.sub}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
