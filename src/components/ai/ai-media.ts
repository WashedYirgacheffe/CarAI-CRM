"use client";

/**
 * 给 AI 看的图片和视频：都在浏览器里先处理好再发——
 * 图片缩到长边 1280 转 JPEG（一张一两百 KB）；视频按时长均匀抽 6～8 帧，模型按帧理解过程。
 */

export type AiAttachment = {
  id: string;
  kind: "image" | "video";
  name: string;
  /** 发给模型的画面（data URL） */
  frames: string[];
  /** 视频每一帧的秒数 */
  times?: number[];
  duration?: number;
  /** 对话里显示的小图（存进历史，体积小） */
  thumb: string;
};

export const MAX_ATTACHMENTS = 6;
const MAX_SIDE = 1280;
const THUMB_SIDE = 160;

const uid = () => Math.random().toString(36).slice(2, 10);

function draw(src: CanvasImageSource, w: number, h: number, max: number, quality: number) {
  const k = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext("2d")!;
  // 透明的 PNG 垫白底，转 JPEG 不变黑
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片读不出来"));
    img.src = url;
  });
}

export async function imageAttachment(blob: Blob, name = "图片"): Promise<AiAttachment> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    return { id: uid(), kind: "image", name, frames: [draw(img, w, h, MAX_SIDE, 0.85)], thumb: draw(img, w, h, THUMB_SIDE, 0.7) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 页面上的一张图片（产品图、头像、WhatsApp 里的图）：同源的直接画，跨域的先下载 */
export async function imageFromElement(el: HTMLImageElement): Promise<AiAttachment> {
  const name = el.alt?.trim() || decodeURIComponent(el.currentSrc.split("/").pop()?.split("?")[0] ?? "") || "页面图片";
  const res = await fetch(el.currentSrc || el.src, { credentials: "include" });
  if (!res.ok) throw new Error("图片下载失败");
  return imageAttachment(await res.blob(), name.slice(0, 60));
}

const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((resolve, reject) => {
    const done = () => {
      v.removeEventListener("seeked", done);
      resolve();
    };
    v.addEventListener("seeked", done);
    v.addEventListener("error", () => reject(new Error("视频读不出来")), { once: true });
    v.currentTime = t;
  });

export async function videoAttachment(src: Blob | string, name = "视频"): Promise<AiAttachment> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  v.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("这个视频格式浏览器读不了"));
      setTimeout(() => reject(new Error("视频加载超时")), 20_000);
    });
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    // 短视频少抽几帧，长视频最多 8 帧；避开第 0 秒的黑屏
    const n = duration < 4 ? 3 : duration < 20 ? 6 : 8;
    const times = Array.from({ length: n }, (_, i) => Math.min(duration - 0.05, ((i + 0.5) / n) * duration));
    const frames: string[] = [];
    let thumb = "";
    for (const t of times) {
      await seek(v, Math.max(0, t));
      frames.push(draw(v, v.videoWidth, v.videoHeight, 768, 0.75));
      if (!thumb) thumb = draw(v, v.videoWidth, v.videoHeight, THUMB_SIDE, 0.7);
    }
    return { id: uid(), kind: "video", name, frames, times, duration, thumb };
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

/** 选的、粘贴的、拖进来的文件：图片和视频收下，其他的忽略 */
export async function filesToAttachments(files: Iterable<File>): Promise<{ items: AiAttachment[]; skipped: number }> {
  const items: AiAttachment[] = [];
  let skipped = 0;
  for (const f of files) {
    try {
      if (f.type.startsWith("image/")) items.push(await imageAttachment(f, f.name || "图片"));
      else if (f.type.startsWith("video/")) items.push(await videoAttachment(f, f.name || "视频"));
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { items, skipped };
}
