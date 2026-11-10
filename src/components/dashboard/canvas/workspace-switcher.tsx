"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, Pencil, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { runAction } from "@/hooks/use-action-form";
import { deleteWorkspaceAction, renameWorkspaceAction, saveWorkspaceAction, setHomeWorkspaceAction } from "@/app/(app)/dashboard/actions";
import { OVERVIEW_ID, type CanvasLayout } from "@/lib/canvas";

export type Space = { id: string; name: string; layout: CanvasLayout };

type Props = {
  spaces: Space[];
  activeId: string;
  home: string | null;
  onSwitch: (id: string) => void;
  onSaveAs: () => void;
  onHomeChange: (id: string) => void;
  onRenamed: (id: string, name: string) => void;
  onDeleted: (id: string) => void;
};

/** 情景切换：概览 + 我保存的情景；★ 是默认情景（每次打开工作台展示） */
export function WorkspaceSwitcher({ spaces, activeId, home, onSwitch, onSaveAs, onHomeChange, onRenamed, onDeleted }: Props) {
  const [renaming, setRenaming] = useState(false);
  const all = [{ id: OVERVIEW_ID, name: "概览" }, ...spaces];
  const active = all.find((s) => s.id === activeId) ?? all[0];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="max-w-64">
            <span className="text-muted-foreground">情景</span>
            <span className="truncate font-medium">{active.name}</span>
            {home === active.id && <Star className="fill-amber-400 text-amber-400" aria-label="默认情景" />}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground">切换情景</DropdownMenuLabel>
          {all.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => onSwitch(s.id)}>
              <Check className={s.id === activeId ? "" : "invisible"} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {home === s.id && <Star className="fill-amber-400 text-amber-400" aria-label="默认情景" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSaveAs}>
            <Copy /> 另存为新情景…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={home === activeId}
            onSelect={async () => {
              const r = await runAction(setHomeWorkspaceAction(activeId));
              if (r.ok) onHomeChange(activeId);
            }}
          >
            <Star /> 设为默认情景
          </DropdownMenuItem>
          {activeId !== OVERVIEW_ID && (
            <>
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil /> 重命名…
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={async () => {
                  if (!confirm(`删除情景「${active.name}」？`)) return;
                  const r = await runAction(deleteWorkspaceAction(activeId));
                  if (r.ok) onDeleted(activeId);
                }}
              >
                <Trash2 /> 删除此情景
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {renaming && (
        <NameDialog
          title="重命名情景"
          initial={active.name}
          onOpenChange={setRenaming}
          onSubmit={async (name) => {
            const r = await runAction(renameWorkspaceAction(activeId, name));
            if (r.ok) onRenamed(activeId, name.trim());
            return !!r.ok;
          }}
        />
      )}
    </>
  );
}

function NameDialog({
  title,
  initial,
  onOpenChange,
  onSubmit,
  children,
}: {
  title: string;
  initial: string;
  onOpenChange: (o: boolean) => void;
  onSubmit: (name: string) => Promise<boolean>;
  children?: React.ReactNode;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            try {
              if (await onSubmit(name)) onOpenChange(false);
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>情景保存的是画布上有哪些组件、多大、怎么排。只有你自己能看到。</DialogDescription>
          </DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="例如：日常跟单" autoFocus aria-label="情景名称" />
          {children}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 把当前画布另存为新情景 */
export function SaveAsDialog({
  open,
  onOpenChange,
  layout,
  defaultHome,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  layout: CanvasLayout;
  defaultHome: boolean;
  onCreated: (s: Space, asHome: boolean) => void;
}) {
  const [asHome, setAsHome] = useState(defaultHome);
  if (!open) return null;
  return (
    <NameDialog
      title="另存为新情景"
      initial=""
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setAsHome(defaultHome);
      }}
      onSubmit={async (name) => {
        const r = await saveWorkspaceAction({ name, layout, home: asHome });
        await runAction(Promise.resolve(r));
        if (r.ok && r.id) onCreated({ id: r.id, name: name.trim(), layout }, asHome);
        return !!r.ok;
      }}
    >
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={asHome} onCheckedChange={(v) => setAsHome(!!v)} />
        设为默认情景（每次打开工作台展示）
      </label>
    </NameDialog>
  );
}
