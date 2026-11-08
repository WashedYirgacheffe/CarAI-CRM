"use client";

import { useRef, useState } from "react";
import { ImageIcon, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** 产品缩略图；没有图时显示占位 */
export function Thumb({ src, alt = "", className }: { src?: string | null; alt?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground",
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- 图片走鉴权接口，不能用 next/image 的优化器
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : (
        <ImageIcon className="size-4" />
      )}
    </span>
  );
}

/** 上传图片，把 URL 写进隐藏字段 name 参与表单提交 */
export function ImageUpload({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "上传失败");
      setUrl(data.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input type="hidden" name={name} value={url} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="relative cursor-pointer rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="上传图片"
      >
        <Thumb src={url} className="size-16" />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center rounded-md bg-background/70">
            <Loader2 className="size-4 animate-spin" />
          </span>
        )}
      </button>
      <div className="text-xs text-muted-foreground">
        <button type="button" className="text-primary hover:underline" onClick={() => input.current?.click()}>
          {url ? "更换图片" : "上传图片"}
        </button>
        {url && (
          <button type="button" className="ml-3 inline-flex items-center gap-0.5 hover:text-destructive" onClick={() => setUrl("")}>
            <X className="size-3" /> 移除
          </button>
        )}
        <p className="mt-1">JPG / PNG / WebP，不超过 3MB</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
    </div>
  );
}
