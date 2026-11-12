"use client";

import { useEffect, useState } from "react";
import { Dialog as D } from "radix-ui";
import { ChevronLeft, ChevronRight, Download, ExternalLink, X, ZoomIn, ZoomOut } from "@/components/icons";
import { cn } from "@/lib/utils";

export type LightboxImage = { id: string; caption?: string; meta?: string };

/**
 * 聊天图片大图查看：← → 切换、Esc 关闭、点图片放大 / 还原，底部缩略图条。
 * 和 WhatsApp 网页版一样在页面里看，不下载；需要时再点「下载」。
 */
export function WaLightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: LightboxImage[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const open = index !== null && !!images[index];
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState("50% 50%");
  const cur = open ? images[index] : null;
  const src = cur ? `/api/whatsapp/media/${cur.id}` : "";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && index! > 0) {
        setZoom(false);
        onIndex(index! - 1);
      }
      if (e.key === "ArrowRight" && index! < images.length - 1) {
        setZoom(false);
        onIndex(index! + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, images.length, onIndex]);

  const go = (i: number) => {
    setZoom(false);
    onIndex(i);
  };
  const btn = "flex size-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white";

  return (
    <D.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setZoom(false);
          onClose();
        }
      }}
    >
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/92 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content className="fixed inset-0 z-50 flex flex-col outline-none" aria-describedby={undefined}>
          <D.Title className="sr-only">查看图片</D.Title>
          <header className="flex items-center gap-2 px-4 py-3 text-white">
            <div className="min-w-0 flex-1">
              {cur?.meta && <p className="truncate text-sm text-white/80">{cur.meta}</p>}
              <p className="text-xs text-white/50 tabular-nums">
                {index! + 1} / {images.length}
              </p>
            </div>
            <button
              type="button"
              className={btn}
              onClick={() => setZoom((z) => !z)}
              aria-label={zoom ? "还原" : "放大"}
              title={zoom ? "还原" : "放大"}
            >
              {zoom ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
            </button>
            <a className={btn} href={src} target="_blank" rel="noreferrer" aria-label="新标签页打开" title="新标签页打开">
              <ExternalLink className="size-5" />
            </a>
            <a className={btn} href={`${src}?download`} aria-label="下载" title="下载">
              <Download className="size-5" />
            </a>
            <D.Close className={btn} aria-label="关闭" title="关闭（Esc）">
              <X className="size-5" />
            </D.Close>
          </header>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-14">
            {index! > 0 && (
              <button type="button" className={cn(btn, "absolute left-3 z-10 size-12 bg-white/5")} onClick={() => go(index! - 1)} aria-label="上一张">
                <ChevronLeft className="size-7" />
              </button>
            )}
            {cur && (
              // eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口
              <img
                key={cur.id}
                src={src}
                alt={cur.caption || ""}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
                  setZoom((z) => !z);
                }}
                style={{ transformOrigin: origin }}
                className={cn(
                  "max-h-full max-w-full object-contain transition-transform duration-200 select-none",
                  zoom ? "scale-[2.2] cursor-zoom-out" : "cursor-zoom-in",
                )}
              />
            )}
            {index! < images.length - 1 && (
              <button
                type="button"
                className={cn(btn, "absolute right-3 z-10 size-12 bg-white/5")}
                onClick={() => go(index! + 1)}
                aria-label="下一张"
              >
                <ChevronRight className="size-7" />
              </button>
            )}
          </div>

          {cur?.caption && <p className="mx-auto max-w-2xl px-6 pt-3 text-center text-sm whitespace-pre-wrap text-white/85">{cur.caption}</p>}
          {images.length > 1 && (
            <div className="flex justify-center gap-1.5 overflow-x-auto px-4 py-3">
              {images.map((im, i) => (
                <button
                  key={im.id}
                  type="button"
                  onClick={() => go(i)}
                  className={cn(
                    "size-14 shrink-0 overflow-hidden rounded-md ring-2 transition",
                    i === index ? "ring-white" : "opacity-55 ring-transparent hover:opacity-100",
                  )}
                  aria-label={`第 ${i + 1} 张`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口 */}
                  <img src={`/api/whatsapp/media/${im.id}`} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
