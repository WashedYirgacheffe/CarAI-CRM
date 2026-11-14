"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Building2,
  Check,
  ChevronDown,
  Link2,
  Link2Off,
  MailOpen,
  MessageSquareText,
  MoreHorizontal,
  Pin,
  PinOff,
  Sparkles,
} from "@/components/icons";
import { aiTargetOf, sendToAi } from "@/components/ai/ai-context-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLongPress } from "@/hooks/use-long-press";
import { WaAvatar } from "@/components/crm/wa-avatar";
import { ContextActions, DropdownActions, type MenuEntry } from "@/components/crm/action-menu";
import { ActionSheet, SwipeRow } from "@/components/crm/swipe-row";
import { runAction } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { chatOpAction, unlinkChatAction } from "./actions";
import { LinkChatDialog } from "./link-chat";

export type ChatRow = {
  id: string;
  href: string;
  active: boolean;
  name: string;
  rawName: string | null;
  phone: string | null;
  avatar: string | null;
  time: string;
  lastText: string | null;
  lastFromMe: boolean;
  unread: number;
  pinned: boolean;
  archived: boolean;
  customer: { id: string; name: string } | null;
};

/** 会话列表的一行：桌面右键或悬停小箭头出菜单；手机左右滑（右滑已读 / 置顶，左滑归档 / 更多），长按出菜单（第一项是 AI） */
export function ChatListItem({ c, backHref, ai }: { c: ChatRow; backHref: string; ai?: boolean }) {
  const isMobile = useIsMobile();
  const press = useLongPress();
  const rowRef = useRef<HTMLLIElement>(null);
  const router = useRouter();
  const [linking, setLinking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const unread = c.unread > 0;

  const items: MenuEntry[] = [
    {
      label: c.pinned ? "取消置顶" : "置顶聊天",
      icon: c.pinned ? PinOff : Pin,
      onSelect: () => void runAction(chatOpAction(c.id, c.pinned ? "unpin" : "pin")),
    },
    {
      label: unread ? "标记为已读" : "标记为未读",
      icon: unread ? MessageSquareText : MailOpen,
      onSelect: async () => {
        const r = await runAction(chatOpAction(c.id, unread ? "read" : "unread"));
        // 正打开的会话标为未读后退出来，不然一打开又被清掉
        if (r.ok && !unread && c.active) router.push(backHref);
      },
    },
    {
      label: c.archived ? "取消归档" : "归档聊天",
      icon: c.archived ? ArchiveRestore : Archive,
      onSelect: async () => {
        const r = await runAction(chatOpAction(c.id, c.archived ? "unarchive" : "archive"));
        if (r.ok && c.active) router.push(backHref);
      },
    },
    "sep",
    { label: c.customer ? "更换关联客户" : "关联客户", icon: Link2, onSelect: () => setLinking(true) },
    {
      label: "取消关联客户",
      icon: Link2Off,
      hidden: !c.customer,
      onSelect: () => {
        if (c.customer && confirm(`取消与「${c.customer.name}」的关联？已记录的跟进会保留。`)) void runAction(unlinkChatAction(c.id));
      },
    },
    { label: "客户详情", icon: Building2, hidden: !c.customer, onSelect: () => c.customer && router.push(`/customers/${c.customer.id}`) },
  ];

  const chatAi = [{ label: "AI 总结这段对话", message: "读一下这个 WhatsApp 对话：总结聊到哪了、对方在等我什么，再起草下一条回复" }];

  return (
    <li ref={rowRef} className="group/item relative" data-ai-context data-ai-label={`WhatsApp 会话 · ${c.name}`}>
      <SwipeRow
        contentClassName="bg-card"
        left={[
          {
            label: unread ? "已读" : "未读",
            icon: unread ? MessageSquareText : MailOpen,
            tone: "sky",
            onAction: () => void runAction(chatOpAction(c.id, unread ? "read" : "unread")),
          },
          {
            label: c.pinned ? "取消置顶" : "置顶",
            icon: c.pinned ? PinOff : Pin,
            tone: "neutral",
            onAction: () => void runAction(chatOpAction(c.id, c.pinned ? "unpin" : "pin")),
          },
        ]}
        right={[
          {
            label: c.archived ? "取消归档" : "归档",
            icon: c.archived ? ArchiveRestore : Archive,
            tone: "primary",
            onAction: () => void runAction(chatOpAction(c.id, c.archived ? "unarchive" : "archive")),
          },
          { label: "更多", icon: MoreHorizontal, tone: "neutral", onAction: () => setSheet(true) },
        ]}
      >
        <ContextActions items={items} aiActions={chatAi} disabled={isMobile}>
          <Link
            href={c.href}
            data-long-press
            {...press(() => setSheet(true))}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 transition-colors md:rounded-xl md:px-2.5",
              c.active ? "bg-accent" : "hover:bg-muted/60",
              menuOpen && !c.active && "bg-muted/60",
            )}
          >
            <WaAvatar src={c.avatar} name={c.rawName} phone={c.phone} className="size-12" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 truncate text-[15px] font-medium">{c.name}</span>
                {/* 关联的客户跟在名字后面，不另占一行 */}
                {c.customer ? (
                  <span className="inline-flex max-w-[45%] min-w-0 shrink items-center gap-1 self-center rounded-md bg-primary/8 px-1.5 py-px text-[11px] text-primary">
                    <Building2 className="size-3 shrink-0" />
                    <span className="truncate">{c.customer.name}</span>
                  </span>
                ) : null}
                <span className="flex-1" />
                <span className={cn("shrink-0 text-xs tabular-nums", unread ? "font-medium text-emerald-600" : "text-muted-foreground")}>
                  {c.time}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                {c.lastFromMe && <Check className="size-3.5 shrink-0 text-muted-foreground" aria-label="我发出的" />}
                <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{c.lastText || " "}</p>
                {c.pinned && <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label="已置顶" />}
                {unread && (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-medium text-white tabular-nums">
                    {c.unread > 99 ? "99+" : c.unread}
                  </span>
                )}
                {/* 给悬停箭头留位置 */}
                <span className="w-0 shrink-0 transition-[width] group-hover/item:w-5" aria-hidden />
              </div>
            </div>
          </Link>
        </ContextActions>
      </SwipeRow>
      <ActionSheet
        open={sheet}
        onOpenChange={setSheet}
        title={c.name}
        items={[
          ...(ai
            ? ([
                {
                  label: chatAi[0].label,
                  icon: Sparkles,
                  onSelect: () => rowRef.current && sendToAi(aiTargetOf(rowRef.current), chatAi[0].message),
                },
                "sep",
              ] satisfies MenuEntry[])
            : []),
          ...items,
        ]}
      />
      <div
        className={cn(
          "absolute top-9 right-3 opacity-0 max-md:hidden transition-opacity group-hover/item:opacity-100 focus-within:opacity-100",
          menuOpen && "opacity-100",
        )}
      >
        <DropdownActions
          items={items}
          aiActions={chatAi}
          onOpenChange={setMenuOpen}
          trigger={
            <button
              type="button"
              aria-label="会话操作"
              className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-black/5 hover:text-foreground"
            >
              <ChevronDown className="size-4" />
            </button>
          }
        />
      </div>
      {linking && <LinkChatDialog chatId={c.id} open={linking} onOpenChange={setLinking} current={c.customer?.name} />}
    </li>
  );
}
