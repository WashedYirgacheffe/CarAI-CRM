import { randomBytes } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { can, getCurrentUser } from "@/server/auth";
import { putObject } from "@/server/storage";

/** 单个文件上限（反向代理 Caddy 限 50MB，留余量） */
const MAX_BYTES = 45 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
};

/**
 * WhatsApp 发图片 / 视频 / 文件前先上传到这里，存到 <tenantId>/wa/out-xxx.<ext>，返回 key，
 * 再由 sendWaMediaAction 排队发送。请求体就是文件本身，文件名放在 x-file-name（encodeURIComponent）。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!can(user, "whatsapp.use")) return Response.json({ error: "没有操作权限" }, { status: 403 });

  const mime = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() || "application/octet-stream";
  const size = Number(request.headers.get("content-length") ?? NaN);
  const name =
    decodeURIComponent(request.headers.get("x-file-name") ?? "")
      .replace(/[\\/\r\n]/g, "_")
      .slice(0, 200) || "file";
  if (!request.body || !Number.isFinite(size) || size <= 0) return Response.json({ error: "没有收到文件" }, { status: 400 });
  if (size > MAX_BYTES) return Response.json({ error: "文件不能超过 45MB" }, { status: 400 });

  let received = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      cb(received > size ? new Error("文件大小与声明不符") : null, chunk);
    },
  });
  const body = Readable.fromWeb(request.body as import("node:stream/web").ReadableStream).pipe(guard);
  const ext = EXT[mime] ?? (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() || "bin");
  const key = `${user.tenantId}/wa/out-${Date.now().toString(36)}${randomBytes(6).toString("hex")}.${ext}`;
  try {
    await putObject(key, body, { contentType: mime, size });
  } catch (e) {
    console.error("wa upload failed", e);
    return Response.json({ error: "上传失败，请重试" }, { status: 500 });
  }
  return Response.json({ key, mime, name, size });
}
