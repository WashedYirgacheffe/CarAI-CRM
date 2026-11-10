"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dismissSavePromptAction } from "@/app/(app)/dashboard/actions";
import type { ActionState } from "@/lib/action";
import { toast } from "sonner";

/**
 * 还没有默认情景的用户改了画布、要去别的页面时，问一句要不要存为默认。
 * 只拦应用内的链接点击；关浏览器标签页时浏览器不允许自定义弹窗，就不拦了。
 */
export function LeavePrompt({ enabled, onSave }: { enabled: boolean; onSave: () => Promise<ActionState> }) {
  const router = useRouter();
  const [href, setHref] = useState<string | null>(null);
  const [never, setNever] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setHref(url.pathname + url.search + url.hash);
    };
    // 捕获阶段，赶在 Next 的 <Link> 跳转之前
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled]);

  const go = async (save: boolean) => {
    if (!href) return;
    setBusy(true);
    try {
      if (never) await dismissSavePromptAction();
      if (save) {
        const r = await onSave();
        if (!r.ok) return void toast.error(r.message ?? "保存失败");
        toast.success("已保存为默认情景");
      }
      router.push(href);
      setHref(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!href} onOpenChange={(o) => !o && setHref(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>需要保存当前页面为默认模式吗？</DialogTitle>
          <DialogDescription>保存后，每次打开工作台都会展示现在这套组件布局。以后可以在「情景」菜单里改。</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={never} onCheckedChange={(v) => setNever(!!v)} />
          不再提示
        </label>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => go(false)}>
            不保存，直接离开
          </Button>
          <Button disabled={busy} onClick={() => go(true)}>
            保存为默认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
