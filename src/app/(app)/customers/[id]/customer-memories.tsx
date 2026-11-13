"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bot, Check, NotebookPen, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { runAction } from "@/hooks/use-action-form";
import { MEMORY_KINDS, type MemoryKind } from "@/lib/ai-memory";
import { confirmMemoryAction, extractCustomerMemoriesAction, forgetMemoryAction } from "@/app/(app)/settings/memory/actions";
import { Panel } from "./detail-ui";

export type CustomerMemory = { id: string; kind: MemoryKind; title: string; content: string; trusted: boolean; source: string; disputed: boolean };

const FOLD = 5;

/** 客户详情：AI 记得的这个客户的事。从往来消息里看到的只作参考，点「对」才算数 */
export function CustomerMemories({ customerId, items, canEdit }: { customerId: string; items: CustomerMemory[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [reading, start] = useTransition();
  const shown = open ? items : items.slice(0, FOLD);
  return (
    <Panel
      title="AI 记得的"
      icon={<NotebookPen className="size-4 text-muted-foreground" />}
      action={
        canEdit && (
          <Button
            size="xs"
            variant="ghost"
            className="text-primary"
            disabled={reading}
            onClick={() => start(async () => void (await runAction(extractCustomerMemoriesAction(customerId))))}
          >
            <Bot /> {reading ? "正在读往来…" : "读一遍往来"}
          </Button>
        )
      }
      bodyClassName="px-4 pb-3 md:px-5"
    >
      {items.length ? (
        <ul className="space-y-2.5">
          {shown.map((m) => (
            <li key={m.id} className="group text-[13px]">
              <p className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1 text-pretty">
                  <span className="mr-1.5 text-[12px] text-muted-foreground">{MEMORY_KINDS[m.kind] ?? m.kind}</span>
                  {m.title}
                </span>
                {canEdit && !m.trusted && (
                  <span className="flex shrink-0 gap-0.5">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`对，确认：${m.title}`}
                      title="对，确认"
                      onClick={() => runAction(confirmMemoryAction(m.id))}
                    >
                      <Check />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`不对，忘掉：${m.title}`}
                      title="不对，忘掉"
                      onClick={() => runAction(forgetMemoryAction(m.id))}
                    >
                      <X />
                    </Button>
                  </span>
                )}
              </p>
              {m.content && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{m.content}</p>}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {m.disputed ? (
                  <span className="text-warn">说法不一致，去记忆页定一下</span>
                ) : m.trusted ? (
                  "已确认"
                ) : m.source === "outside" ? (
                  "从邮件 / 消息看到的，只作参考"
                ) : (
                  "AI 发现的，只作参考"
                )}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-3 text-center text-[13px] text-balance text-muted-foreground">
          聊天时告诉 AI 这个客户的付款方式、决策人、忌讳，它会记在这里；新的往来邮件和 WhatsApp 它也会自己读。
        </p>
      )}
      <div className="mt-2 flex items-center justify-between text-[12px]">
        {items.length > FOLD ? (
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
            {open ? "收起" : `还有 ${items.length - FOLD} 条`}
          </button>
        ) : (
          <span />
        )}
        {items.length > 0 && (
          <Link href="/settings/memory" className="text-muted-foreground hover:text-foreground">
            管理记忆
          </Link>
        )}
      </div>
    </Panel>
  );
}
