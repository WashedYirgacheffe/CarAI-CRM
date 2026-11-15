"use client";

import { useState } from "react";
import { Eye, Loader2, Pencil, Plus, RefreshCw, Trash2, TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { SocialIcon } from "@/components/crm/social-icon";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { CUSTOMER_PLATFORMS, platformInfo } from "@/lib/social";
import { cn } from "@/lib/utils";
import { checkSocialNowAction, deleteSocialAction, saveSocialAction, toggleSocialWatchAction } from "../social-actions";

export type SocialRow = {
  id: string;
  platform: string;
  url: string;
  handle: string | null;
  source: string;
  watch: boolean;
  checkedAt: string | null;
  lastError: string | null;
};

export type SocialPostRow = { id: string; platform: string; title: string; url: string | null; date: string; unread: boolean };

/** 客户档案卡里的一排社媒图标：点了直接打开主页；「管理」打开弹窗 */
export function CustomerSocials({
  customerId,
  canEdit,
  items,
  posts,
  watching,
  watchStar,
}: {
  customerId: string;
  canEdit: boolean;
  items: SocialRow[];
  posts: SocialPostRow[];
  /** 这个客户的星级够不够自动跟踪 */
  watching: boolean;
  watchStar: number;
}) {
  const [open, setOpen] = useState(false);
  const unread = posts.filter((p) => p.unread).length;
  if (!items.length && !canEdit) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((s) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noreferrer noopener"
            className="transition-transform hover:-translate-y-0.5"
            aria-label={`${platformInfo(s.platform).label} ${s.handle ?? ""}`}
          >
            <SocialIcon platform={s.platform} title={`${platformInfo(s.platform).label}${s.handle ? ` · ${s.handle}` : ""}`} />
          </a>
        ))}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "relative inline-flex h-7 items-center gap-1 rounded-lg border border-dashed px-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary",
            items.length > 0 && "border-solid",
          )}
        >
          {items.length ? "社媒" : <><Plus className="size-3.5" />添加社媒</>}
          {unread > 0 && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-destructive" aria-label={`${unread} 条新动态`} />}
        </button>
      </div>
      <SocialsDialog
        open={open}
        onOpenChange={setOpen}
        customerId={customerId}
        canEdit={canEdit}
        items={items}
        posts={posts}
        watching={watching}
        watchStar={watchStar}
      />
    </>
  );
}

function SocialsDialog({
  open,
  onOpenChange,
  customerId,
  canEdit,
  items,
  posts,
  watching,
  watchStar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string;
  canEdit: boolean;
  items: SocialRow[];
  posts: SocialPostRow[];
  watching: boolean;
  watchStar: number;
}) {
  const [editing, setEditing] = useState<SocialRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, p: Promise<{ ok?: boolean; message?: string }>) => {
    setBusy(key);
    await runAction(p as never);
    setBusy(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg *:min-w-0">
        <DialogHeader>
          <DialogTitle>客户社媒</DialogTitle>
          <DialogDescription>
            {watchStar === 0
              ? "企业已关闭社媒跟踪"
              : watching
                ? `重点客户（${watchStar} 星及以上），勾选的账号每 6 小时自动查一次更新`
                : `给客户标到 ${watchStar} 星及以上，就会自动跟踪这些账号的更新`}
          </DialogDescription>
        </DialogHeader>

        {items.length > 0 && (
          <ul className="divide-y divide-border/70 rounded-lg border">
            {items.map((s) => (
              <li key={s.id} className="flex items-center gap-2.5 px-3 py-2.5">
                <SocialIcon platform={s.platform} />
                <div className="min-w-0 flex-1">
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="block truncate text-sm hover:text-primary hover:underline">
                    {s.handle ?? s.url.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    {platformInfo(s.platform).label}
                    {s.source === "research" && " · 穿透挖到"}
                    {s.lastError ? (
                      <span className="inline-flex min-w-0 items-center gap-0.5 text-amber-600" title={s.lastError}>
                        <TriangleAlert className="size-3 shrink-0" />
                        <span className="truncate">{s.lastError}</span>
                      </span>
                    ) : (
                      s.checkedAt && ` · ${s.checkedAt} 查过`
                    )}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <label className="mr-1 flex items-center gap-1 text-xs text-muted-foreground" title="跟踪这个账号的更新">
                      <Checkbox
                        checked={s.watch}
                        disabled={busy === `w${s.id}`}
                        onCheckedChange={(v) => run(`w${s.id}`, toggleSocialWatchAction(customerId, s.id, v === true))}
                      />
                      跟踪
                    </label>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="马上查一次"
                      title="马上查一次更新"
                      disabled={!!busy}
                      onClick={() => run(`c${s.id}`, checkSocialNowAction(customerId, s.id))}
                    >
                      {busy === `c${s.id}` ? <Loader2 /> : <RefreshCw />}
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="修改" onClick={() => setEditing(s)}>
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="删除"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={!!busy}
                      onClick={() => run(`d${s.id}`, deleteSocialAction(customerId, s.id))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && <SocialForm key={editing?.id ?? "new"} customerId={customerId} editing={editing} onDone={() => setEditing(null)} />}

        {posts.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Eye className="size-3.5" /> 最近动态
            </h3>
            <ul className="space-y-1">
              {posts.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <SocialIcon platform={p.platform} className="size-5 rounded-md" />
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer noopener" className={cn("min-w-0 flex-1 truncate hover:text-primary hover:underline", p.unread && "font-medium")}>
                      {p.title}
                    </a>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{p.date}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SocialForm({ customerId, editing, onDone }: { customerId: string; editing: SocialRow | null; onDone: () => void }) {
  const [state, submit, pending] = useActionForm(saveSocialAction, (form) => {
    form.reset();
    onDone();
  });
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg bg-muted/50 p-3">
      <input type="hidden" name="customerId" value={customerId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="social-url">{editing ? "修改主页链接" : "添加主页链接"}</FieldLabel>
          <Input
            id="social-url"
            name="url"
            defaultValue={editing?.url}
            placeholder="https://www.linkedin.com/company/…"
            autoComplete="off"
            required
          />
          <FieldErrors state={state} name="url" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel>平台</FieldLabel>
            <NativeSelect name="platform" defaultValue={editing?.platform ?? "auto"}>
              <option value="auto">按链接自动识别</option>
              {CUSTOMER_PLATFORMS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="social-handle">账号名（可不填）</FieldLabel>
            <Input id="social-handle" name="handle" defaultValue={editing?.handle ?? ""} placeholder="@acme" autoComplete="off" />
          </Field>
        </div>
      </FieldGroup>
      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        {editing && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            取消
          </Button>
        )}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 /> : editing ? null : <Plus />}
          {editing ? "保存" : "添加"}
        </Button>
      </div>
    </form>
  );
}
