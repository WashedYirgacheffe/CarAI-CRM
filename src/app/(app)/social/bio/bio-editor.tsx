"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, Download, ExternalLink, ImageIcon, Loader2, Plus, QrCode, Trash2, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { SocialIcon } from "@/components/crm/social-icon";
import { uploadFile } from "@/components/crm/image-upload";
import { BioView } from "@/components/social/bio-view";
import { useActionForm } from "@/hooks/use-action-form";
import { BIO_THEMES, detectPlatform, PLATFORMS, platformInfo, type BioLink } from "@/lib/social";
import { cn } from "@/lib/utils";
import { saveBioAction } from "../actions";

type PageData = {
  id: string;
  slug: string;
  title: string;
  bio: string;
  avatar: string | null;
  theme: string;
  published: boolean;
  links: BioLink[];
};

const newId = () => Math.random().toString(36).slice(2, 10);

/** 聚合主页编辑：左边填，右边手机预览，下面是分享链接和二维码 */
export function BioEditor({
  page,
  company,
  share,
}: {
  page: PageData;
  company: string | null;
  share: { url: string; qr: string; views: number; clicks: Record<string, number> };
}) {
  const [title, setTitle] = useState(page.title);
  const [bio, setBio] = useState(page.bio);
  const [avatar, setAvatar] = useState(page.avatar);
  const [theme, setTheme] = useState(page.theme);
  const [links, setLinks] = useState<BioLink[]>(page.links);
  const [state, submit, pending] = useActionForm(saveBioAction);

  const update = (id: string, patch: Partial<BioLink>) => setLinks((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) =>
    setLinks((ls) => {
      const j = i + d;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = (kind: BioLink["kind"]) =>
    setLinks((ls) => [...ls, { id: newId(), kind, platform: kind === "qr" ? "wechat" : "linkedin", label: "", url: "", image: null }]);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form onSubmit={submit} className="space-y-4">
        <input type="hidden" name="id" value={page.id} />
        <input type="hidden" name="avatar" value={avatar ?? ""} />
        <input type="hidden" name="theme" value={theme} />
        <input type="hidden" name="links" value={JSON.stringify(links)} />

        <section className="surface space-y-4 p-4 md:p-5">
          <div className="flex items-start gap-4">
            <AvatarUpload value={avatar} onChange={setAvatar} />
            <FieldGroup className="min-w-0 flex-1 gap-3">
              <Field>
                <FieldLabel htmlFor="bio-title">标题</FieldLabel>
                <Input id="bio-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="bio-bio">简介</FieldLabel>
                <Textarea
                  id="bio-bio"
                  name="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={300}
                  rows={2}
                  placeholder="Sales Manager · Auto parts export since 2012"
                />
              </Field>
            </FieldGroup>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="bio-slug">公开地址</FieldLabel>
              <div className="flex items-center rounded-md border bg-muted/40 pl-2.5 text-sm text-muted-foreground focus-within:ring-3 focus-within:ring-ring/50">
                /b/
                <input
                  id="bio-slug"
                  name="slug"
                  defaultValue={page.slug}
                  className="h-9 min-w-0 flex-1 bg-transparent px-1 text-foreground outline-none"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <FieldErrors state={state} name="slug" />
            </Field>
            <Field>
              <FieldLabel>配色</FieldLabel>
              <div className="flex gap-2">
                {Object.entries(BIO_THEMES).map(([k, t]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTheme(k)}
                    className={cn("flex h-9 flex-1 items-center justify-center rounded-md border text-xs", theme === k && "ring-2 ring-primary")}
                    style={{ background: t.bg, color: t.text }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="published" defaultChecked={page.published} />
            公开（关掉后链接打不开）
          </label>
        </section>

        <section className="surface p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">链接和二维码</h2>
            <div className="flex gap-1.5">
              <Button type="button" size="xs" variant="outline" onClick={() => add("link")}>
                <Plus /> 链接
              </Button>
              <Button type="button" size="xs" variant="outline" onClick={() => add("qr")}>
                <QrCode className="size-3" /> 二维码
              </Button>
            </div>
          </div>
          {links.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">加上 LinkedIn、WhatsApp、官网，或者微信二维码</p>
          ) : (
            <ul className="space-y-2.5">
              {links.map((l, i) => (
                <li key={l.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <SocialIcon platform={l.platform} className="size-6 rounded-md" />
                    <span className="text-xs text-muted-foreground">{l.kind === "qr" ? "二维码卡片" : "链接按钮"}</span>
                    {share.clicks[l.id] ? <span className="text-xs text-muted-foreground tabular-nums">· {share.clicks[l.id]} 次点击</span> : null}
                    <div className="ml-auto flex items-center">
                      <Button type="button" size="icon-xs" variant="ghost" aria-label="上移" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp />
                      </Button>
                      <Button type="button" size="icon-xs" variant="ghost" aria-label="下移" disabled={i === links.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label="删除"
                        className="hover:text-destructive"
                        onClick={() => setLinks((ls) => ls.filter((x) => x.id !== l.id))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[9rem_10rem_minmax(0,1fr)]">
                    <NativeSelect value={l.platform} onChange={(e) => update(l.id, { platform: e.target.value as BioLink["platform"] })} aria-label="平台">
                      {PLATFORMS.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input
                      value={l.label}
                      onChange={(e) => update(l.id, { label: e.target.value })}
                      placeholder={platformInfo(l.platform).label}
                      maxLength={40}
                      aria-label="显示文字"
                    />
                    <Input
                      value={l.url}
                      onChange={(e) => {
                        const url = e.target.value;
                        const p = detectPlatform(url);
                        // 平台还是默认值时，按链接自动换
                        update(l.id, { url, ...(url.includes(".") && p !== "website" && p !== l.platform && !l.label ? { platform: p } : {}) });
                      }}
                      placeholder={l.kind === "qr" ? "链接（可不填，上传二维码图片也行）" : "https://… / mailto: / tel:"}
                      aria-label="链接"
                      autoComplete="off"
                    />
                  </div>
                  {l.kind === "qr" && (
                    <div className="mt-2">
                      <QrUpload value={l.image ?? null} onChange={(image) => update(l.id, { image })} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <FormMessage state={state} />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 />} 保存主页
          </Button>
        </div>
      </form>

      <aside className="space-y-4 lg:sticky lg:top-4">
        <section className="surface p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>分享</span>
            <span className="tabular-nums">{share.views} 次浏览</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Input readOnly value={share.url} className="h-8 text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="复制链接"
              onClick={() => navigator.clipboard.writeText(share.url).then(() => toast.success("已复制"))}
            >
              <Copy />
            </Button>
            <Button size="icon-sm" variant="outline" aria-label="打开" asChild>
              <a href={share.url} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- 服务端生成的 data URL */}
            <img src={share.qr} alt="主页二维码" className="size-24 rounded-md border bg-white p-1" />
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p>印在名片、展会物料上，客户扫码就能看到你的全部联系方式。</p>
              <Button size="xs" variant="outline" asChild>
                <a href={share.qr} download={`bio-${page.slug}.png`}>
                  <Download /> 下载二维码
                </a>
              </Button>
            </div>
          </div>
        </section>

        <div className="mx-auto w-full max-w-[22rem] overflow-hidden rounded-[2rem] border-8 border-foreground/85 shadow-xl">
          <div className="h-[36rem] overflow-y-auto">
            <BioView
              title={title}
              bio={bio}
              avatar={avatar}
              theme={theme}
              company={company}
              links={links.map((l) => ({ ...l, href: l.url || "#", qr: null }))}
            />
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground">预览（没传图的二维码卡片，保存后按链接自动生成）</p>
      </aside>
    </div>
  );
}

function useUpload(onDone: (url: string) => void) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const el = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      className="hidden"
      onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setBusy(true);
        try {
          onDone(await uploadFile(f));
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "上传失败");
        } finally {
          setBusy(false);
          e.target.value = "";
        }
      }}
    />
  );
  return { busy, pick: () => input.current?.click(), el };
}

function AvatarUpload({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const up = useUpload(onChange);
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <button
        type="button"
        onClick={up.pick}
        className="relative flex size-20 items-center justify-center overflow-hidden rounded-full border bg-muted text-muted-foreground"
        aria-label="上传头像"
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- 鉴权图片
          <img src={value} alt="" className="size-full object-cover" />
        ) : (
          <ImageIcon className="size-5" />
        )}
        {up.busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 />
          </span>
        )}
      </button>
      {value ? (
        <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => onChange(null)}>
          移除
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">头像 / Logo</span>
      )}
      {up.el}
    </div>
  );
}

function QrUpload({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const up = useUpload(onChange);
  return (
    <div className="flex items-center gap-2 text-xs">
      {value && (
        // eslint-disable-next-line @next/next/no-img-element -- 鉴权图片
        <img src={value} alt="" className="size-12 rounded border bg-white object-contain" />
      )}
      <Button type="button" size="xs" variant="outline" disabled={up.busy} onClick={up.pick}>
        {up.busy ? <Loader2 /> : <ImageIcon className="size-3" />}
        {value ? "换一张二维码图片" : "上传二维码图片（如微信）"}
      </Button>
      {value && (
        <button type="button" className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-destructive" onClick={() => onChange(null)}>
          <X className="size-3" /> 移除
        </button>
      )}
      {up.el}
    </div>
  );
}
