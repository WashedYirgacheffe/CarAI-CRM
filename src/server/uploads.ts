import "server-only";
import path from "node:path";

/** 上传文件根目录。Docker 部署时挂载成卷（见 docker-compose.yml） */
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "storage/uploads");

export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** 文件 URL → 磁盘路径；不合法（越界、格式不对）返回 null */
export function resolveUpload(tenantId: string, segments: string[]) {
  if (segments.length !== 2 || segments[0] !== tenantId) return null;
  if (!/^[a-z0-9]+\.(jpg|png|webp|gif)$/.test(segments[1])) return null;
  return path.join(UPLOAD_DIR, segments[0], segments[1]);
}
