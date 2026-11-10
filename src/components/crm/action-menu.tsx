"use client";

import type { ComponentType, ReactNode } from "react";
import { ContextMenu as CM, DropdownMenu as DM } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * 同一份菜单，两种打开方式：右键（ContextMenu）和悬停出现的小箭头（DropdownMenu）。
 * WhatsApp 网页版就是这样：鼠标用户右键，触屏 / 不习惯右键的点箭头。
 */
export type MenuEntry =
  | { label: string; icon?: ComponentType<{ className?: string }>; onSelect: () => void; destructive?: boolean; hint?: string; hidden?: boolean }
  | "sep";

const content =
  "z-50 min-w-48 overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95";
const item =
  "relative flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground data-[variant=destructive]:[&_svg]:text-destructive";

const visible = (items: MenuEntry[]) => {
  const list = items.filter((x) => x === "sep" || !x.hidden);
  // 去掉开头、结尾和连续的分隔线
  return list.filter((x, i) => x !== "sep" || (i > 0 && i < list.length - 1 && list[i - 1] !== "sep"));
};

function Items({ items, Item, Sep }: { items: MenuEntry[]; Item: typeof CM.Item | typeof DM.Item; Sep: typeof CM.Separator | typeof DM.Separator }) {
  return (
    <>
      {visible(items).map((x, i) =>
        x === "sep" ? (
          <Sep key={`s${i}`} className="mx-1 my-1 h-px bg-border" />
        ) : (
          <Item key={x.label} className={item} data-variant={x.destructive ? "destructive" : undefined} onSelect={x.onSelect}>
            {x.icon && <x.icon />}
            <span className="flex-1">{x.label}</span>
            {x.hint && <span className="text-xs text-muted-foreground">{x.hint}</span>}
          </Item>
        ),
      )}
    </>
  );
}

/** 包住一块区域，右键弹出菜单 */
export function ContextActions({ items, children, disabled }: { items: MenuEntry[]; children: ReactNode; disabled?: boolean }) {
  if (disabled) return <>{children}</>;
  return (
    <CM.Root modal={false}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className={content} collisionPadding={8}>
          <Items items={items} Item={CM.Item} Sep={CM.Separator} />
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

/** 点按钮弹出同一份菜单 */
export function DropdownActions({
  items,
  trigger,
  align = "end",
  onOpenChange,
}: {
  items: MenuEntry[];
  trigger: ReactNode;
  align?: "start" | "end";
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DM.Root modal={false} onOpenChange={onOpenChange}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className={cn(content)} align={align} sideOffset={4} collisionPadding={8}>
          <Items items={items} Item={DM.Item} Sep={DM.Separator} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
