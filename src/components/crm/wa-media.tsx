import { FileText } from "lucide-react";

export type WaMediaInfo = { type: string; mime: string; name: string | null; size: number | null } | null;

const sizeText = (n: number | null) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** WhatsApp 消息里的图片 / 视频 / 语音 / 文件（走 /api/whatsapp/media 鉴权后跳转到 OSS） */
export function WaMedia({ id, media, onOpen }: { id: string; media: WaMediaInfo; onOpen?: () => void }) {
  if (!media) return null;
  const src = `/api/whatsapp/media/${id}`;
  if (media.type === "sticker") {
    // eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口，不能用 next/image
    return <img src={src} alt="" loading="lazy" className="mb-1 size-28 object-contain" />;
  }
  if (media.type === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口，不能用 next/image
    const img = <img src={src} alt="" loading="lazy" className="max-h-72 max-w-full rounded-md object-contain" />;
    return onOpen ? (
      <button type="button" onClick={onOpen} className="mb-1 block cursor-zoom-in" aria-label="查看大图">
        {img}
      </button>
    ) : (
      <a href={src} target="_blank" rel="noreferrer" className="mb-1 block">
        {img}
      </a>
    );
  }
  if (media.type === "video") return <video src={src} controls preload="metadata" className="mb-1 max-h-72 max-w-full rounded-md bg-black" />;
  if (media.type === "audio") return <audio src={src} controls preload="none" className="mb-1 h-9 max-w-full" />;
  return (
    <a href={`${src}?download`} className="mb-1 flex items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 hover:bg-black/10">
      <FileText className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{media.name || "文件"}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{sizeText(media.size)}</span>
    </a>
  );
}

/** 有媒体时，正文里的「[图片]」「[视频]」等占位不再显示，只保留说明文字 */
export function waCaption(body: string, media: WaMediaInfo) {
  if (!media) return body;
  if (media.type === "document") return ""; // 文件名已显示在文件卡片里
  return body.replace(/^\[(图片|视频|语音|表情)\]\s*/, "");
}

type Row = { mediaKey: string | null; mediaMime: string | null; mediaName: string | null; mediaSize: number | null; type: string };
export const waMediaOf = (m: Row): WaMediaInfo =>
  m.mediaKey ? { type: m.type, mime: m.mediaMime ?? "", name: m.mediaName, size: m.mediaSize } : null;
