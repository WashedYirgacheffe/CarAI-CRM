"use client";

import { ArrowLeft, ArrowRight, GripVertical, Maximize2, X } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SIZE_LABEL, SIZE_SPAN, widgetDef, type CanvasItem, type CanvasSize } from "@/lib/canvas";
import { cn } from "@/lib/utils";

export type DropHint = { id: string; after: boolean; vertical: boolean } | null;

type Props = {
  item: CanvasItem;
  index: number;
  count: number;
  children: React.ReactNode;
  dragging: boolean;
  armed: boolean;
  drop: DropHint;
  onArm: (armed: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverCell: (after: boolean, vertical: boolean) => void;
  onDropCell: () => void;
  onResize: (size: CanvasSize) => void;
  onMove: (delta: -1 | 1) => void;
  onMaximize: () => void;
  onRemove: () => void;
};

const toolBtn =
  "flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** 画布上的一格：悬停时顶边浮出工具条（拖动、尺寸、放大、关闭） */
export function CanvasCell(p: Props) {
  const def = widgetDef(p.item.type)!;
  const hint = p.drop?.id === p.item.id ? p.drop : null;

  return (
    <div
      data-cell={p.item.id}
      draggable={p.armed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", p.item.id);
        p.onDragStart();
      }}
      onDragEnd={p.onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const parent = e.currentTarget.parentElement?.getBoundingClientRect();
        // 占满一行的组件按上下半区判断，其余按左右半区
        const wide = !!parent && r.width > parent.width * 0.7;
        p.onDragOverCell(wide ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2, wide);
      }}
      onDrop={(e) => {
        e.preventDefault();
        p.onDropCell();
      }}
      className={cn("group/cell relative min-w-0 @container [&>[data-body]>*]:h-full", SIZE_SPAN[p.item.size], p.dragging && "opacity-40")}
    >
      {hint && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-20 rounded-full bg-primary",
            hint.vertical ? "inset-x-0 h-1" : "inset-y-0 w-1",
            hint.vertical ? (hint.after ? "-bottom-2" : "-top-2") : hint.after ? "-right-2" : "-left-2",
          )}
        />
      )}
      <div
        className={cn(
          "absolute -top-3.5 right-4 z-10 flex items-center gap-0.5 rounded-full border bg-background/95 p-0.5 shadow-sm backdrop-blur",
          "opacity-0 transition-opacity group-hover/cell:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100",
          // 触屏没有悬停、也拖不动：手机上不出工具条，排版在电脑上调
          "max-md:hidden",
        )}
      >
        <button
          type="button"
          aria-label={`拖动「${def.label}」调整位置`}
          title="拖动调整位置"
          className={cn(toolBtn, "cursor-grab active:cursor-grabbing")}
          onPointerDown={() => p.onArm(true)}
          onPointerUp={() => p.onArm(false)}
        >
          <GripVertical className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`「${def.label}」尺寸和位置`} className={cn(toolBtn, "w-auto px-2 text-xs font-medium")}>
              {SIZE_LABEL[p.item.size]}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel className="text-xs text-muted-foreground">尺寸</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={p.item.size} onValueChange={(v) => p.onResize(v as CanvasSize)}>
              {def.sizes.map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {SIZE_LABEL[s]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={p.index === 0} onSelect={() => p.onMove(-1)}>
              <ArrowLeft /> 往前挪
            </DropdownMenuItem>
            <DropdownMenuItem disabled={p.index === p.count - 1} onSelect={() => p.onMove(1)}>
              <ArrowRight /> 往后挪
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" aria-label={`放大「${def.label}」`} title="放大" className={toolBtn} onClick={p.onMaximize}>
          <Maximize2 className="size-3.5" />
        </button>
        <button type="button" aria-label={`关闭「${def.label}」`} title="从画布移除" className={toolBtn} onClick={p.onRemove}>
          <X className="size-4" />
        </button>
      </div>
      <div data-body className="h-full">
        {p.children}
      </div>
    </div>
  );
}
