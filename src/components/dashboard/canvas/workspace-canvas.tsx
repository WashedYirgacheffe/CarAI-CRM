"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutGrid, Minimize2, Plus, Redo2, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { runAction } from "@/hooks/use-action-form";
import { saveWorkspaceAction } from "@/app/(app)/dashboard/actions";
import { MAX_ITEMS, OVERVIEW_ID, WIDGETS, makeItem, sameLayout, widgetDef, type CanvasLayout, type CanvasSize } from "@/lib/canvas";
import { cn } from "@/lib/utils";
import { CanvasCell, type DropHint } from "./canvas-cell";
import { useLayoutHistory } from "./use-layout-history";
import { WorkspaceSwitcher, SaveAsDialog, type Space } from "./workspace-switcher";
import { LeavePrompt } from "./leave-prompt";

type Props = {
  blocks: Record<string, React.ReactNode>;
  available: string[];
  overview: CanvasLayout;
  workspaces: Space[];
  home: string | null;
  promptOff: boolean;
};

/** 工作台画布：情景切换 + 12 列网格自动排列的组件 */
export function WorkspaceCanvas({ blocks, available, overview, workspaces, home: initialHome, promptOff }: Props) {
  const [spaces, setSpaces] = useState<Space[]>(workspaces);
  const [home, setHome] = useState<string | null>(initialHome);
  const [activeId, setActiveId] = useState<string>(() => initialHome ?? OVERVIEW_ID);
  const savedOf = useCallback(
    (id: string) => (id === OVERVIEW_ID ? overview : (spaces.find((s) => s.id === id)?.layout ?? overview)),
    [overview, spaces],
  );
  const h = useLayoutHistory(savedOf(activeId));
  const { layout, set } = h;
  const dirty = !sameLayout(layout, savedOf(activeId));

  const [saveAs, setSaveAs] = useState(false);
  const [maxId, setMaxId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropHint>(null);

  const can = useMemo(() => new Set(available), [available]);
  const visible = layout.filter((it) => can.has(it.type));
  const onCanvas = new Set(layout.map((it) => it.type));

  const update = (fn: (l: CanvasLayout) => CanvasLayout) => set(fn(layout));
  const resize = (id: string, size: CanvasSize) => update((l) => l.map((it) => (it.id === id ? { ...it, size } : it)));
  const remove = (id: string) => update((l) => l.filter((it) => it.id !== id));
  const move = (id: string, delta: -1 | 1) =>
    update((l) => {
      // 在可见的组件之间挪（看不到的组件保持原位）
      const vis = l.filter((it) => can.has(it.type));
      const i = vis.findIndex((it) => it.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= vis.length) return l;
      const a = l.indexOf(vis[i]);
      const b = l.indexOf(vis[j]);
      const n = [...l];
      [n[a], n[b]] = [n[b], n[a]];
      return n;
    });
  const dropOn = (targetId: string, after: boolean) =>
    update((l) => {
      const dragged = l.find((it) => it.id === dragId);
      if (!dragged || dragged.id === targetId) return l;
      const rest = l.filter((it) => it.id !== dragged.id);
      const t = rest.findIndex((it) => it.id === targetId);
      rest.splice(after ? t + 1 : t, 0, dragged);
      return rest;
    });
  const add = (type: string) => {
    const item = makeItem(type);
    set([...layout, item]);
    requestAnimationFrame(() => document.querySelector(`[data-cell="${item.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  const switchTo = (id: string) => {
    if (id === activeId) return;
    if (dirty && !confirm("当前情景有未保存的改动，切换后会丢失。继续切换吗？")) return;
    setActiveId(id);
    setMaxId(null);
    h.reset(savedOf(id));
  };

  const save = async () => {
    if (activeId === OVERVIEW_ID) return setSaveAs(true);
    const r = await runAction(saveWorkspaceAction({ id: activeId, layout }));
    if (r.ok) setSpaces((ss) => ss.map((s) => (s.id === activeId ? { ...s, layout } : s)));
  };

  const created = (s: Space, asHome: boolean) => {
    setSpaces((ss) => [...ss, s]);
    if (asHome) setHome(s.id);
    setActiveId(s.id);
    h.reset(s.layout);
  };

  // 撤销 / 重做快捷键（输入框里不拦）
  const { undo, redo } = h;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const el = e.target;
      if (el instanceof Element && el.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const maxItem = visible.find((it) => it.id === maxId) ?? null;
  const addable = WIDGETS.filter((w) => can.has(w.type));

  return (
    <>
      <AiBar />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <WorkspaceSwitcher
          spaces={spaces}
          activeId={activeId}
          home={home}
          onSwitch={switchTo}
          onSaveAs={() => setSaveAs(true)}
          onHomeChange={setHome}
          onRenamed={(id, name) => setSpaces((ss) => ss.map((s) => (s.id === id ? { ...s, name } : s)))}
          onDeleted={(id) => {
            setSpaces((ss) => ss.filter((s) => s.id !== id));
            if (home === id) setHome(OVERVIEW_ID);
            if (activeId === id) {
              setActiveId(OVERVIEW_ID);
              h.reset(overview);
            }
          }}
        />
        {dirty && (
          <>
            <span className="text-xs text-muted-foreground">有未保存的改动</span>
            <Button size="sm" onClick={save}>
              {activeId === OVERVIEW_ID ? "另存为情景" : "保存"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => h.reset(savedOf(activeId))}>
              放弃改动
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={h.undo} disabled={!h.canUndo} aria-label="撤销" title="撤销（⌘Z）">
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={h.redo} disabled={!h.canRedo} aria-label="重做" title="重做（⇧⌘Z）">
            <Redo2 />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="ml-1">
                <Plus /> 添加组件
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-1.5">
              <ul className="max-h-[60vh] overflow-y-auto">
                {addable.map((w) => {
                  const placed = onCanvas.has(w.type);
                  return (
                    <li key={w.type}>
                      <button
                        type="button"
                        disabled={placed || layout.length >= MAX_ITEMS}
                        onClick={() => add(w.type)}
                        className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                      >
                        <LayoutGrid className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
                            {w.label}
                            {placed && <span className="text-xs font-normal text-muted-foreground">已在画布上</span>}
                          </span>
                          <span className="block text-xs text-muted-foreground">{w.desc}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="surface flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="font-medium">画布是空的</p>
          <p className="text-sm text-muted-foreground">用右上角的「添加组件」把需要的模块放上来，或切回「概览」。</p>
        </div>
      ) : (
        <div
          className="grid grid-flow-row-dense grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-12"
          onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}
        >
          {visible.map((it, i) => (
            <CanvasCell
              key={it.id}
              item={it}
              index={i}
              count={visible.length}
              dragging={dragId === it.id}
              armed={armedId === it.id}
              drop={drop}
              onArm={(a) => setArmedId(a ? it.id : null)}
              onDragStart={() => setDragId(it.id)}
              onDragEnd={() => {
                setDragId(null);
                setArmedId(null);
                setDrop(null);
              }}
              onDragOverCell={(after, vertical) => {
                if (!dragId || dragId === it.id) return setDrop(null);
                if (drop?.id !== it.id || drop.after !== after || drop.vertical !== vertical) setDrop({ id: it.id, after, vertical });
              }}
              onDropCell={() => {
                if (drop) dropOn(drop.id, drop.after);
                setDrop(null);
              }}
              onResize={(s) => resize(it.id, s)}
              onMove={(d) => move(it.id, d)}
              onMaximize={() => setMaxId(it.id)}
              onRemove={() => remove(it.id)}
            >
              {maxId === it.id ? (
                <div className="surface flex h-full min-h-32 items-center justify-center text-sm text-muted-foreground">正在放大显示</div>
              ) : (
                blocks[it.type]
              )}
            </CanvasCell>
          ))}
        </div>
      )}

      {maxItem && (
        <MaximizedView title={widgetDef(maxItem.type)!.label} onClose={() => setMaxId(null)}>
          {blocks[maxItem.type]}
        </MaximizedView>
      )}

      <SaveAsDialog open={saveAs} onOpenChange={setSaveAs} layout={layout} defaultHome={home === null} onCreated={created} />

      <LeavePrompt
        enabled={home === null && !promptOff && dirty}
        onSave={async () => {
          const r =
            activeId === OVERVIEW_ID
              ? await saveWorkspaceAction({ name: "我的工作台", layout, home: true })
              : await saveWorkspaceAction({ id: activeId, layout, home: true });
          return r;
        }}
      />
    </>
  );
}

/** 顶部 AI 栏：第 2 期接通，先占好位置 */
function AiBar() {
  return (
    <div className="surface mb-4 flex items-center gap-3 px-4 py-3" aria-disabled>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-600">
        <Sparkles className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">告诉 AI 你想看什么、做什么，它会帮你把需要的组件摆上来</span>
      <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">即将上线</span>
    </div>
  );
}

/** 放大显示：铺满窗口，Esc 或点背景关闭 */
function MaximizedView({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className="absolute inset-4 flex flex-col overflow-hidden rounded-2xl bg-background shadow-2xl md:inset-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <Minimize2 /> 还原
          </Button>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-auto p-4 @container md:p-6 [&>*]:min-h-full")}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
