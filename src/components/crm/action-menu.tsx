"use client";

import { useRef, useState, type ComponentType, type ReactNode } from "react";
import { ContextMenu as CM, DropdownMenu as DM } from "radix-ui";
import { Eye, Languages, Sparkles } from "@/components/icons";
import { aiPrompts, aiTargetOf, sendToAi, type AiTarget } from "@/components/ai/ai-context-menu";
import { cn } from "@/lib/utils";

/**
 * 同一份菜单，两种打开方式：右键（ContextMenu）和悬停出现的小箭头（DropdownMenu）。
 * WhatsApp 网页版就是这样：鼠标用户右键，触屏 / 不习惯右键的点箭头。
 *
 * 和全局右键「给 AI 看看」的分工：页面自带菜单的地方，浏览器右键只出这一份菜单，
 * AI 的几条放在最上面一组（同一套说法、同一个入口），不会出现两个菜单抢位置。
 * 下拉箭头打开时，只有箭头在 data-ai-context 区域里才带 AI 组。
 */
export type AiAction = { label: string; message: string };
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

/** 菜单最上面的 AI 组：给 AI 看看 + 页面自己的 AI 指令 + 通用的总结 / 翻译 */
function AiItems({
  t,
  extra,
  Item,
  Sep,
}: {
  t: AiTarget;
  extra?: AiAction[];
  Item: typeof CM.Item | typeof DM.Item;
  Sep: typeof CM.Separator | typeof DM.Separator;
}) {
  const p = aiPrompts(t);
  const what = t.selection ? "选中的文字" : t.image ? "这张图" : t.video ? "这段视频" : "这里";
  const list = [...(extra ?? []), p.summary, ...(p.translate ? [p.translate] : [])];
  return (
    <>
      <Item className={cn(item, "py-1.5 font-medium")} onSelect={() => sendToAi(t)}>
        <span className="ac-tile size-6 shrink-0" style={{ borderRadius: "30% 30% 30% 9%" }}>
          <Eye className="!size-3.5 !text-current" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block leading-tight">给 AI 看看</span>
          <span className="block truncate text-[11.5px] leading-tight font-normal text-muted-foreground">把{what}交给 AI，说一句就行</span>
        </span>
      </Item>
      {list.map((a, i) => (
        <Item key={a.label} className={item} onSelect={() => sendToAi(t, a.message)}>
          {a === p.translate ? <Languages /> : <Sparkles className={cn(i < (extra?.length ?? 0) && "!text-brand")} />}
          <span className="flex-1">{a.label}</span>
        </Item>
      ))}
      <Sep className="mx-1 my-1 h-px bg-border" />
    </>
  );
}

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

/** 包住一块区域，右键弹出菜单；ai={false} 时不带 AI 组 */
export function ContextActions({
  items,
  children,
  disabled,
  ai = true,
  aiActions,
}: {
  items: MenuEntry[];
  children: ReactNode;
  disabled?: boolean;
  ai?: boolean;
  /** 这块内容专属的 AI 指令，比如 WhatsApp 消息的「AI 帮我回复」 */
  aiActions?: AiAction[];
}) {
  const [t, setT] = useState<AiTarget | null>(null);
  if (disabled) return <>{children}</>;
  return (
    <CM.Root modal={false}>
      <CM.Trigger asChild onContextMenu={(e) => setT(ai && e.target instanceof Element ? aiTargetOf(e.target) : null)}>
        {children}
      </CM.Trigger>
      <CM.Portal>
        <CM.Content className={content} collisionPadding={8}>
          {t && <AiItems t={t} extra={aiActions} Item={CM.Item} Sep={CM.Separator} />}
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
  aiActions,
}: {
  items: MenuEntry[];
  trigger: ReactNode;
  align?: "start" | "end";
  onOpenChange?: (open: boolean) => void;
  aiActions?: AiAction[];
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [t, setT] = useState<AiTarget | null>(null);
  return (
    <DM.Root
      modal={false}
      onOpenChange={(open) => {
        const el = ref.current;
        if (open) setT(el?.closest("[data-ai-context]") ? aiTargetOf(el) : null);
        onOpenChange?.(open);
      }}
    >
      <DM.Trigger asChild ref={ref}>
        {trigger}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content className={cn(content)} align={align} sideOffset={4} collisionPadding={8}>
          {t && <AiItems t={t} extra={aiActions} Item={DM.Item} Sep={DM.Separator} />}
          <Items items={items} Item={DM.Item} Sep={DM.Separator} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
