"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { MenuEntry } from "@/components/crm/action-menu";
import { cn } from "@/lib/utils";

/*
 * 手机列表行的左右滑操作（仿 iOS 邮件 / 微信）：
 * - 左滑露出右侧按钮（如「更多」「删除」），右滑露出左侧按钮（如「已读」「置顶」）
 * - 滑过整行 55% 松手直接执行最外侧那个操作
 * - 只响应触摸；鼠标用户继续用右键 / 「⋯」菜单
 * - 同一时间只有一行是展开的，点别处自动收起
 */

export type SwipeAction = {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onAction: () => void;
  tone?: "primary" | "brand" | "destructive" | "neutral" | "emerald" | "amber" | "sky";
  hidden?: boolean;
};

const TONE: Record<NonNullable<SwipeAction["tone"]>, string> = {
  primary: "bg-primary text-primary-foreground",
  brand: "bg-brand text-brand-foreground",
  destructive: "bg-red-500 text-white",
  neutral: "bg-[oklch(0.62_0_0)] text-white",
  emerald: "bg-emerald-500 text-white",
  amber: "bg-amber-500 text-white",
  sky: "bg-sky-500 text-white",
};

const BTN = 76; // 每个按钮宽度
const EASE = "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)";

// 全局只允许一行展开
let closeOpen: (() => void) | null = null;

export function SwipeRow({
  left = [],
  right = [],
  children,
  className,
  contentClassName,
  disabled,
}: {
  /** 右滑露出（排在左侧），第一个在最外侧 */
  left?: SwipeAction[];
  /** 左滑露出（排在右侧），第一个在最外侧 */
  right?: SwipeAction[];
  children: React.ReactNode;
  className?: string;
  /** 内容层（随手指移动的那层），需要不透明背景 */
  contentClassName?: string;
  disabled?: boolean;
}) {
  const L = left.filter((a) => !a.hidden);
  const R = right.filter((a) => !a.hidden);
  const rowRef = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const g = useRef({ id: -1, x0: 0, y0: 0, base: 0, lock: "" as "" | "x" | "y", moved: false, width: 0 });

  useEffect(() => {
    if (x === 0) return;
    const close = () => setX(0);
    const me = close;
    if (closeOpen && closeOpen !== me) closeOpen();
    closeOpen = me;
    const onDown = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      if (closeOpen === me) closeOpen = null;
    };
  }, [x]);

  if (disabled || (!L.length && !R.length)) return <div className={className}>{children}</div>;

  const maxL = L.length * BTN;
  const maxR = R.length * BTN;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: x, lock: "", moved: false, width: rowRef.current?.offsetWidth ?? 375 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (e.pointerId !== s.id) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
      if (s.lock === "x") {
        setDragging(true);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // 指针已失效时忽略
        }
      }
    }
    if (s.lock !== "x") return;
    s.moved = true;
    let next = s.base + dx;
    // 没有按钮的方向不能拉；超过按钮总宽后加阻尼（满滑除外）
    if (next > 0 && !L.length) next = 0;
    if (next < 0 && !R.length) next = 0;
    const full = s.width * 0.9;
    if (next > maxL) next = Math.min(maxL + (next - maxL) * 0.85, full);
    if (next < -maxR) next = Math.max(-maxR + (next + maxR) * 0.85, -full);
    setX(next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = g.current;
    if (e.pointerId !== s.id) return;
    s.id = -1;
    if (s.lock !== "x") return;
    setDragging(false);
    const w = s.width;
    if (x < 0 && -x > w * 0.55 && R[0]) {
      setX(0);
      R[0].onAction();
    } else if (x > 0 && x > w * 0.55 && L[0]) {
      setX(0);
      L[0].onAction();
    } else if (x < 0) setX(-x > maxR / 2 ? -maxR : 0);
    else if (x > 0) setX(x > maxL / 2 ? maxL : 0);
  };

  const run = (a: SwipeAction) => {
    setX(0);
    a.onAction();
  };

  // 满滑时最外侧按钮撑满露出的区域
  const fullR = -x > maxR + 24;
  const fullL = x > maxL + 24;

  return (
    <div ref={rowRef} className={cn("relative overflow-hidden", className)}>
      {x > 0 && (
        <div className="absolute inset-y-0 left-0 flex" style={{ width: Math.max(x, maxL) }}>
          {L.map((a, i) => (
            <ActionButton key={a.label} a={a} onClick={() => run(a)} style={{ flex: fullL ? (i === 0 ? "1 1 auto" : "0 0 0px") : "1 1 0px" }} />
          ))}
        </div>
      )}
      {x < 0 && (
        <div className="absolute inset-y-0 right-0 flex flex-row-reverse" style={{ width: Math.max(-x, maxR) }}>
          {R.map((a, i) => (
            <ActionButton key={a.label} a={a} onClick={() => run(a)} style={{ flex: fullR ? (i === 0 ? "1 1 auto" : "0 0 0px") : "1 1 0px" }} />
          ))}
        </div>
      )}
      <div
        className={cn("relative touch-pan-y", contentClassName)}
        style={{ transform: x ? `translate3d(${x}px,0,0)` : undefined, transition: dragging ? "none" : EASE }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          // 刚滑过 / 已展开时，点击只用来收起，不触发里面的链接
          if (g.current.moved || x !== 0) {
            e.preventDefault();
            e.stopPropagation();
            g.current.moved = false;
            if (x !== 0) setX(0);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ActionButton({ a, onClick, style }: { a: SwipeAction; onClick: () => void; style: React.CSSProperties }) {
  const Icon = a.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...style, transition: "flex 220ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-1 overflow-hidden text-xs font-medium whitespace-nowrap",
        TONE[a.tone ?? "neutral"],
      )}
    >
      {Icon && <Icon className="size-5" />}
      {a.label}
    </button>
  );
}

/** 手机底部弹出的操作菜单（替代下拉菜单 / 右键菜单），每项 52px 高，底部带「取消」 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: React.ReactNode;
  items: MenuEntry[];
}) {
  const list = items.filter((x) => x === "sep" || !x.hidden);
  const shown = list.filter((x, i) => x !== "sep" || (i > 0 && i < list.length - 1 && list[i - 1] !== "sep"));
  const anyIcon = shown.some((x) => x !== "sep" && x.icon);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-t-3xl border-t-0 px-3 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      >
        <span className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/25" aria-hidden />
        <SheetTitle className={cn("truncate px-3 pb-1 text-center text-[13px] font-normal text-muted-foreground", !title && "sr-only")}>
          {title || "操作"}
        </SheetTitle>
        <SheetDescription className="sr-only">选择一项操作</SheetDescription>
        <ul className="overflow-hidden rounded-2xl bg-muted/50">
          {shown.map((x, i) =>
            x === "sep" ? (
              <li key={`s${i}`} className="h-1.5 bg-background" aria-hidden />
            ) : (
              <li key={x.label} className="border-b border-background last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    x.onSelect();
                  }}
                  className={cn(
                    "flex h-[52px] w-full items-center gap-3 px-4 text-left text-[16px] active:bg-muted",
                    x.destructive && "text-destructive",
                  )}
                >
                  {x.icon ? (
                    <x.icon className={cn("size-5 shrink-0", x.destructive ? "text-destructive" : "text-muted-foreground")} />
                  ) : (
                    anyIcon && <span className="size-5 shrink-0" aria-hidden />
                  )}
                  <span className="flex-1 truncate">{x.label}</span>
                </button>
              </li>
            ),
          )}
        </ul>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="mt-2 h-[52px] w-full rounded-2xl bg-muted/50 text-[16px] font-medium active:bg-muted"
        >
          取消
        </button>
      </SheetContent>
    </Sheet>
  );
}
