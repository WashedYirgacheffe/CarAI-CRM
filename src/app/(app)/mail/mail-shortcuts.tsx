"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useHotkeys } from "@/hooks/use-hotkeys";

export const MAIL_KEYS: [string, string][] = [
  ["j", "下一封"],
  ["k", "上一封"],
  ["r", "回复"],
  ["a", "回复全部"],
  ["f", "转发"],
  ["s", "加 / 取消星标"],
  ["e", "已处理（移出待办）"],
  ["u", "标为未读并返回列表"],
  ["c", "写邮件"],
  ["/", "搜索"],
  ["Esc", "关闭邮件，回到列表"],
  ["?", "显示快捷键"],
];

/** 邮件列表的键盘操作：j/k 切换邮件、/ 搜索、c 写信、Esc 返回、? 帮助（阅读区的 r/a/f/s/e/u 在 MailReader 里） */
export function MailShortcuts({ list, selectedId, listHref }: { list: { id: string; href: string }[]; selectedId: string; listHref: string }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const i = list.findIndex((x) => x.id === selectedId);

  const go = (d: 1 | -1) => {
    const target = i < 0 ? list[d === 1 ? 0 : list.length - 1] : list[i + d];
    if (target) router.push(target.href, { scroll: false });
  };

  useHotkeys({
    j: () => go(1),
    k: () => go(-1),
    c: () => router.push("/mail/compose"),
    "/": () => document.querySelector<HTMLInputElement>("input[name=q]")?.focus(),
    Escape: () => selectedId && router.push(listHref, { scroll: false }),
    "?": () => setHelp(true),
  });

  // 键盘切换时让选中的那封留在可见范围里
  useEffect(() => {
    if (selectedId) document.querySelector(`[data-mail-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <>
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={() => setHelp(true)}
        aria-label="键盘快捷键"
        title="键盘快捷键（?）"
        className="text-muted-foreground"
      >
        <Keyboard />
      </Button>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>邮件快捷键</DialogTitle>
            <DialogDescription>不用鼠标也能处理完一整箱邮件</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {MAIL_KEYS.map(([k, label]) => (
              <div key={k} className="contents">
                <dt>
                  {k.split(" / ").map((x, n) => (
                    <span key={x}>
                      {n > 0 && <span className="mx-1 text-muted-foreground">/</span>}
                      <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border bg-muted px-1.5 font-mono text-xs shadow-[0_1px_0_var(--border)]">
                        {x}
                      </kbd>
                    </span>
                  ))}
                </dt>
                <dd className="self-center text-foreground/80">{label}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
