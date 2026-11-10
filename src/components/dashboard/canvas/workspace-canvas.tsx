"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Minimize2, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAction } from "@/hooks/use-action-form";
import { saveWorkspaceAction } from "@/app/(app)/dashboard/actions";
import { MAX_ITEMS, OVERVIEW_ID, itemTitle, makeItem, sameLayout, type CanvasItem, type CanvasLayout, type CanvasSize } from "@/lib/canvas";
import { cn } from "@/lib/utils";
import { CanvasCell, type DropHint } from "./canvas-cell";
import { useLayoutHistory } from "./use-layout-history";
import { WorkspaceSwitcher, SaveAsDialog, type Space } from "./workspace-switcher";
import { LeavePrompt } from "./leave-prompt";
import { registerCanvas, type WorkspaceEvent } from "@/components/ai/canvas-bridge";
import { AddMenu } from "./add-menu";
import { BusinessWidget, type WidgetApi } from "./business-widgets";

type Props = {
  blocks: Record<string, React.ReactNode>;
  available: string[];
  overview: CanvasLayout;
  workspaces: Space[];
  home: string | null;
  promptOff: boolean;
  tz: string;
  metrics: string[];
};

/** 同一个对象的业务组件：客户看 customerId，会话看 chatId */
const sameTarget = (a: CanvasItem, type: string, params: Record<string, string>) =>
  a.type === type &&
  (type === "whatsapp"
    ? a.params?.chatId === params.chatId
    : type === "customer" || type === "followups"
      ? a.params?.customerId === params.customerId
      : false);

const scrollToCell = (id: string) =>
  requestAnimationFrame(() => document.querySelector(`[data-cell="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));

/** 工作台画布：情景切换 + 12 列网格自动排列的组件 */
export function WorkspaceCanvas({ blocks, available, overview, workspaces, home: initialHome, promptOff, tz, metrics }: Props) {
  const router = useRouter();
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
  const add = (type: string, params?: Record<string, string>) => {
    const existing = params && layout.find((it) => sameTarget(it, type, params));
    if (existing) return scrollToCell(existing.id);
    const item = makeItem(type, undefined, params);
    set([...layout, item]);
    scrollToCell(item.id);
  };

  // 业务组件的回调：改自己的参数、在旁边再打开一个组件
  const apiFor = (it: CanvasItem): WidgetApi => ({
    tz,
    setParams: (params) => update((l) => l.map((x) => (x.id === it.id ? { ...x, params } : x))),
    open: (type, params, size) => {
      if (!can.has(type)) return;
      const existing = layout.find((x) => sameTarget(x, type, params));
      if (existing) return scrollToCell(existing.id);
      const item = makeItem(type, size, params);
      update((l) => {
        const i = l.findIndex((x) => x.id === it.id);
        const n = [...l];
        n.splice(i < 0 ? n.length : i + 1, 0, item);
        return n;
      });
      scrollToCell(item.id);
    },
  });
  const render = (it: CanvasItem) => blocks[it.type] ?? <BusinessWidget item={it} api={apiFor(it)} />;

  // 内嵌页（WhatsApp 聊天）里点了站内链接：在外层页面跳转
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const d = e.data as { type?: string; href?: string } | null;
      if (d?.type === "crm:navigate" && typeof d.href === "string" && d.href.startsWith("/") && !d.href.startsWith("//")) router.push(d.href);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [router]);

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

  // 全局 AI 浮窗通过这里读写画布
  const onAiWorkspace = (e: WorkspaceEvent) => {
    setMaxId(null);
    if (e.op === "saved") {
      const s = { id: e.id, name: e.name, layout: e.layout };
      setSpaces((ss) => (ss.some((x) => x.id === e.id) ? ss.map((x) => (x.id === e.id ? s : x)) : [...ss, s]));
      if (e.home) setHome(e.id);
      setActiveId(e.id);
      h.reset(e.layout);
      return e.layout;
    }
    // 用户亲口要求切换：不再弹「未保存」确认，切换前的样子还能在本次对话里重新摆出来
    const next = e.id === OVERVIEW_ID ? overview : e.layout;
    setActiveId(e.id);
    h.reset(next);
    return next;
  };
  const live = useRef({ layout, activeId, set, onAiWorkspace });
  useEffect(() => {
    live.current = { layout, activeId, set, onAiWorkspace };
  });
  useEffect(
    () =>
      registerCanvas({
        layout: () => live.current.layout,
        active: () => live.current.activeId,
        onLayout: (l) => (setMaxId(null), live.current.set(l)),
        onWorkspace: (e) => live.current.onAiWorkspace(e),
      }),
    [],
  );

  const maxItem = visible.find((it) => it.id === maxId) ?? null;

  return (
    <>
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
          <AddMenu available={can} onCanvas={onCanvas} full={layout.length >= MAX_ITEMS} metrics={metrics} onAdd={add} />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="surface flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="font-medium">画布是空的</p>
          <p className="text-sm text-muted-foreground">在上方告诉 AI 你想看什么，或用右上角的「添加组件」把需要的模块放上来。</p>
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
                render(it)
              )}
            </CanvasCell>
          ))}
        </div>
      )}

      {maxItem && (
        <MaximizedView title={itemTitle(maxItem)} onClose={() => setMaxId(null)}>
          {render(maxItem)}
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
          <h2 className="font-medium">{title}</h2>
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
