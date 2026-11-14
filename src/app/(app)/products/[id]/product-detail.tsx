"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, Pencil, Plus, Sparkles, Trash2, WandSparkles, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { VisitList } from "@/components/crm/visit-timeline";
import { runAction } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import type { VisitView } from "@/lib/share-visit";
import { Panel } from "@/app/(app)/customers/[id]/detail-ui";
import { optimizeListingAction, saveListingAction, setProductStatusAction, type ListingDraft } from "../actions";
import { ProductForm, type ProductRow } from "../product-table";

/** 右上角：编辑资料、停售 / 恢复 */
export function ProductActions({ product, categories }: { product: ProductRow; categories: { id: string; name: string }[] }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => runAction(setProductStatusAction(product.id, product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"))}
      >
        {product.status === "ACTIVE" ? "停售" : "恢复在售"}
      </Button>
      <Button size="sm" onClick={() => setEditing(true)}>
        <Pencil /> 编辑资料
      </Button>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {editing && <ProductForm product={product} categories={categories} onDone={() => setEditing(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Listing = { listingTitle: string; bullets: string[]; listingDesc: string; keywords: string };

/** 产品卡内容：标题、卖点、介绍、关键词；AI 给出建议，采用后再保存 */
export function ListingEditor({
  id,
  initial,
  canEdit,
  canAi,
  fallbackTitle,
}: {
  id: string;
  initial: Listing;
  canEdit: boolean;
  canAi: boolean;
  fallbackTitle: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Listing>({ ...initial, bullets: initial.bullets.length ? initial.bullets : [""] });
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [focus, setFocus] = useState("");
  const [thinking, startAi] = useTransition();
  const [saving, startSave] = useTransition();
  const dirty = JSON.stringify({ ...form, bullets: form.bullets.filter(Boolean) }) !== JSON.stringify(initial);
  const empty = !initial.listingTitle && !initial.bullets.length && !initial.listingDesc;

  const set = <K extends keyof Listing>(k: K, v: Listing[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setBullet = (i: number, v: string) =>
    set(
      "bullets",
      form.bullets.map((b, k) => (k === i ? v : b)),
    );

  const optimize = () =>
    startAi(async () => {
      const r = await optimizeListingAction(id, focus);
      if (r.ok && r.draft) setDraft(r.draft);
      else await runAction(Promise.resolve(r));
    });
  const adopt = () => {
    if (!draft) return;
    setForm({
      listingTitle: draft.listingTitle,
      bullets: draft.bullets.length ? draft.bullets : [""],
      listingDesc: draft.listingDesc,
      keywords: draft.keywords,
    });
    setDraft(null);
    toast.success("已填进下面，检查一下再保存");
  };
  const save = () =>
    startSave(async () => {
      const r = await runAction(saveListingAction(id, { ...form, bullets: form.bullets.filter((b) => b.trim()) }));
      if (r.ok) router.refresh();
    });

  if (!canEdit) {
    return (
      <Panel title="产品卡内容">
        {empty ? <p className="text-[13px] text-muted-foreground">还没写产品卡内容，客户看到的是基本资料。</p> : <ListingRead listing={initial} />}
      </Panel>
    );
  }

  return (
    <Panel title="产品卡内容" action={<span className="text-[12px] text-muted-foreground">客户打开产品卡看到的文字，建议用英文</span>}>
      {canAi && (
        <div className="mb-4 rounded-xl bg-brand-soft/40 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-brand-ink">
              <Sparkles className="size-4" /> AI 优化 Listing
            </p>
            <Input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="可选：这次的要求，如「突出可定制 logo」「面向中东市场」"
              className="h-8 flex-1 bg-card text-[13px]"
              aria-label="AI 优化的要求"
            />
            <Button size="sm" disabled={thinking} onClick={optimize}>
              {thinking ? <Loader2 /> : <WandSparkles />}
              {thinking ? "正在写…" : empty ? "帮我写" : "优化"}
            </Button>
          </div>
          {!draft && !thinking && (
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              参考产品资料和客户的查看数据（停留在哪、点了什么）来写，只给建议，你确认后才保存。
            </p>
          )}
          {draft && <DraftView draft={draft} onAdopt={adopt} onDiscard={() => setDraft(null)} />}
        </div>
      )}

      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">标题</span>
          <Input value={form.listingTitle} onChange={(e) => set("listingTitle", e.target.value)} placeholder={fallbackTitle} maxLength={200} />
          <span className="mt-1 block text-[12px] text-muted-foreground">
            不填就用英文品名。{form.listingTitle.length > 0 && `${form.listingTitle.length} / 200`}
          </span>
        </label>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">卖点</legend>
          <ol className="space-y-2">
            {form.bullets.map((b, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-right text-[12px] text-muted-foreground tabular-nums">{i + 1}</span>
                <Input
                  value={b}
                  onChange={(e) => setBullet(i, e.target.value)}
                  maxLength={300}
                  aria-label={`卖点 ${i + 1}`}
                  placeholder="Durable build: …"
                />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`删除卖点 ${i + 1}`}
                  disabled={form.bullets.length === 1 && !b}
                  onClick={() => set("bullets", form.bullets.length === 1 ? [""] : form.bullets.filter((_, k) => k !== i))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ol>
          {form.bullets.length < 8 && (
            <Button size="xs" variant="ghost" className="mt-1.5 ml-4 text-primary" onClick={() => set("bullets", [...form.bullets, ""])}>
              <Plus /> 加一条
            </Button>
          )}
        </fieldset>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">详细介绍</span>
          <Textarea
            value={form.listingDesc}
            onChange={(e) => set("listingDesc", e.target.value)}
            rows={7}
            maxLength={8000}
            placeholder="段落之间空一行"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">关键词</span>
          <Input
            value={form.keywords}
            onChange={(e) => set("keywords", e.target.value)}
            maxLength={500}
            placeholder="逗号分隔，用于以后搜索和 AI 分析"
          />
        </label>

        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setForm({ ...initial, bullets: initial.bullets.length ? initial.bullets : [""] })}>
              撤销修改
            </Button>
          )}
          <Button size="sm" disabled={!dirty || saving} onClick={save}>
            {saving ? "正在保存…" : "保存产品卡"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function DraftView({ draft, onAdopt, onDiscard }: { draft: ListingDraft; onAdopt: () => void; onDiscard: () => void }) {
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-card p-3 text-[13px]">
      {draft.notes.length > 0 && (
        <ul className="space-y-1 text-[12px] text-muted-foreground">
          {draft.notes.map((n, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="mt-[0.55em] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
              <span className="text-pretty">{n}</span>
            </li>
          ))}
        </ul>
      )}
      <ListingRead listing={draft} />
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onDiscard}>
          <X /> 不要
        </Button>
        <Button size="xs" onClick={onAdopt}>
          采用，填到下面
        </Button>
      </div>
    </div>
  );
}

function ListingRead({ listing }: { listing: Listing }) {
  return (
    <div lang="en" className="space-y-2 text-[13px]">
      {listing.listingTitle && <p className="text-[15px] font-semibold text-balance">{listing.listingTitle}</p>}
      {listing.bullets.length > 0 && (
        <ul className="space-y-1">
          {listing.bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-primary" />
              <span className="text-pretty">{b}</span>
            </li>
          ))}
        </ul>
      )}
      {listing.listingDesc && <p className="line-clamp-6 whitespace-pre-line text-foreground/85">{listing.listingDesc}</p>}
      {listing.keywords && <p className="text-[12px] text-muted-foreground">{listing.keywords}</p>}
    </div>
  );
}

/** 客户视角预览：嵌入真正的产品卡页面（带着登录 cookie，不会被算成客户访问） */
export function CardPreview({ url, priceUrl, version }: { url: string; priceUrl: string; version: number }) {
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [withPrice, setWithPrice] = useState(false);
  const link = withPrice ? priceUrl : url;
  const path = (() => {
    try {
      return new URL(link).pathname;
    } catch {
      return link;
    }
  })();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("链接已复制");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  return (
    <Panel
      title="客户看到的产品卡"
      action={
        <div role="radiogroup" aria-label="预览设备" className="flex rounded-[10px] bg-muted p-0.5 text-[12px]">
          {(["mobile", "desktop"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={device === d}
              onClick={() => setDevice(d)}
              className={cn(
                "rounded-lg px-2.5 py-0.5",
                device === d ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {d === "mobile" ? "手机" : "电脑"}
            </button>
          ))}
        </div>
      }
    >
      <div className={cn("mx-auto overflow-hidden rounded-xl bg-muted ring-1 ring-border", device === "mobile" ? "w-[300px]" : "w-full")}>
        <div className={cn("relative origin-top-left", device === "mobile" ? "h-[560px]" : "h-[420px]")}>
          {/* 手机按 375 宽渲染后缩放到 300；电脑按 1200 宽缩放到面板宽 */}
          <iframe
            key={`${path}-${version}-${device}`}
            src={path}
            title="产品卡预览"
            className="absolute top-0 left-0 origin-top-left border-0 bg-background"
            style={
              device === "mobile" ? { width: 375, height: 700, transform: "scale(0.8)" } : { width: 1200, height: 1400, transform: "scale(0.3)" }
            }
          />
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={withPrice} onChange={(e) => setWithPrice(e.target.checked)} className="size-4 accent-primary" />
        链接里显示单价
      </label>
      <div className="mt-2 flex gap-2">
        <Input readOnly value={link} className="h-8 flex-1 text-[12px]" aria-label="产品卡链接" onFocus={(e) => e.target.select()} />
        <Button size="sm" variant="outline" onClick={copy}>
          <Copy /> 复制
        </Button>
        <Button size="icon-sm" variant="ghost" asChild>
          <Link href={path} target="_blank" aria-label="新窗口打开" title="新窗口打开">
            <ExternalLink />
          </Link>
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-pretty text-muted-foreground">
        这个链接不绑定客户，谁打开都记在这个产品下。在 WhatsApp 会话里发产品，链接会绑定那位客户，打开时还会写进客户的跟进记录。
      </p>
    </Panel>
  );
}

/** 最近的访问：前面标出是哪个客户（客户页里能看到同一条记录） */
export function ProductVisits({ visits, tz }: { visits: (VisitView & { customer: { id: string; name: string } | null })[]; tz: string }) {
  const labels = Object.fromEntries(
    visits.map((v) => [v.id, v.customer ? <span>{v.customer.name}</span> : <span className="text-muted-foreground">未绑定客户的链接</span>]),
  );
  return <VisitList visits={visits} tz={tz} labels={labels} />;
}
