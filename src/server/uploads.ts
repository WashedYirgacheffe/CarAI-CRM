import "server-only";

export { UPLOAD_DIR } from "@/server/storage";

export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** 扩展名 → MIME */
export const MIME_OF: Record<string, string> = Object.fromEntries(
  Object.entries({ ...IMAGE_TYPES, ...VIDEO_TYPES }).map(([mime, ext]) => [ext, mime]),
);

/** 文件 URL（/api/files/<tenantId>/<name>）→ 存储 key；不合法（越界、格式不对）返回 null */
export function resolveUpload(tenantId: string, segments: string[]) {
  if (segments.length !== 2 || segments[0] !== tenantId) return null;
  if (!/^[a-z0-9]+\.(jpg|png|webp|gif|mp4|webm|mov)$/.test(segments[1])) return null;
  return `${segments[0]}/${segments[1]}`;
}
