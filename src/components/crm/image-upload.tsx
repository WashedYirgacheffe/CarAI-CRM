"use client";

import { useRef, useState } from "react";
import { ImageIcon, Loader2, Plus, Video, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** 上传进行中时放一个必填的空字段，浏览器会拦住表单提交，避免图片 / 视频还没传完就保存 */
function UploadingGuard({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <input
      required
      value=""
      onChange={() => {}}
      tabIndex={-1}
      aria-hidden
      className="pointer-events-none absolute size-px opacity-0"
      onInvalid={(e) => e.currentTarget.setCustomValidity("文件还在上传，请稍等")}
    />
  );
}

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

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime";

/** 上传一个文件到 /api/upload（请求体就是文件本身），返回 URL；带上传进度 */
export function uploadFile(file: File, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: { url?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data.url) resolve(data.url);
      else reject(new Error(data.error ?? "上传失败"));
    };
    xhr.onerror = () => reject(new Error("网络错误，上传失败"));
    xhr.send(file);
  });
}

/** 上传图片，把 URL 写进隐藏字段 name 参与表单提交 */
export function ImageUpload({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      setUrl(await uploadFile(file));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="relative flex items-center gap-3">
      <input type="hidden" name={name} value={url} />
      <UploadingGuard active={busy} />
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
        <p className="mt-1">JPG / PNG / WebP，不超过 10MB</p>
      </div>
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
    </div>
  );
}

/** 多张图片（最多 max 张），URL 数组以 JSON 写进隐藏字段 name */
export function GalleryUpload({ name, defaultValue, max = 8 }: { name: string; defaultValue?: string[]; max?: number }) {
  const [urls, setUrls] = useState<string[]>(defaultValue ?? []);
  const [busy, setBusy] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: File[]) {
    const room = Math.max(0, max - urls.length);
    if (files.length > room) toast.error(`最多 ${max} 张，多出的已忽略`);
    const pick = files.slice(0, room);
    setBusy(pick.length);
    for (const f of pick) {
      try {
        const url = await uploadFile(f);
        setUrls((u) => [...u, url]);
      } catch (e) {
        toast.error(`${f.name}：${e instanceof Error ? e.message : "上传失败"}`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (input.current) input.current.value = "";
  }

  return (
    <div className="relative space-y-1.5">
      <input type="hidden" name={name} value={JSON.stringify(urls)} />
      <UploadingGuard active={busy > 0} />
      <div className="flex flex-wrap gap-2">
        {urls.map((u) => (
          <span key={u} className="group relative">
            <Thumb src={u} className="size-16" />
            <button
              type="button"
              aria-label="移除图片"
              onClick={() => setUrls((list) => list.filter((x) => x !== u))}
              className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-foreground text-background group-hover:flex"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {Array.from({ length: busy }, (_, i) => (
          <span key={`b${i}`} className="flex size-16 items-center justify-center rounded-md border bg-muted">
            <Loader2 className="size-4 animate-spin" />
          </span>
        ))}
        {urls.length + busy < max && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex size-16 items-center justify-center rounded-md border border-dashed text-muted-foreground hover:border-primary hover:text-primary"
            aria-label="添加图片"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">更多图片，最多 {max} 张，每张不超过 10MB</p>
      <input
        ref={input}
        type="file"
        multiple
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => upload(Array.from(e.target.files ?? []))}
      />
    </div>
  );
}

/** 上传一个视频，URL 写进隐藏字段 name */
export function VideoUpload({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [pct, setPct] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setPct(0);
    try {
      setUrl(await uploadFile(file, setPct));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setPct(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="relative space-y-1.5">
      <input type="hidden" name={name} value={url} />
      <UploadingGuard active={pct !== null} />
      {url ? (
        <div className="flex items-end gap-3">
          <video src={url} controls preload="metadata" className="h-32 max-w-60 rounded-md border bg-black" />
          <div className="space-x-3 text-xs">
            <button type="button" className="text-primary hover:underline" onClick={() => input.current?.click()} disabled={pct !== null}>
              更换视频
            </button>
            <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setUrl("")}>
              移除
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={pct !== null}
          className="flex h-16 w-full max-w-60 items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground hover:border-primary hover:text-primary disabled:cursor-wait"
        >
          {pct !== null ? (
            <>
              <Loader2 className="size-4 animate-spin" /> 上传中 {pct}%
            </>
          ) : (
            <>
              <Video className="size-4" /> 上传产品视频
            </>
          )}
        </button>
      )}
      {url && pct !== null && <p className="text-xs text-muted-foreground">上传中 {pct}%</p>}
      <p className="text-xs text-muted-foreground">MP4 / WebM / MOV，不超过 200MB</p>
      <input
        ref={input}
        type="file"
        accept={VIDEO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
    </div>
  );
}
