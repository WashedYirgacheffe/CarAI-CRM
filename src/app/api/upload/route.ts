import { randomBytes } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { getCurrentUser } from "@/server/auth";
import { putObject } from "@/server/storage";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_TYPES } from "@/server/uploads";

/**
 * 上传产品图片 / 视频，返回可访问的 URL。
 * 请求体就是文件本身（Content-Type 为文件类型），边收边写入存储，大视频也不占内存。
 * 图片：JPG / PNG / WebP / GIF，最大 10MB；视频：MP4 / WebM / MOV，最大 200MB。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const size = Number(request.headers.get("content-length") ?? NaN);
  const isVideo = type in VIDEO_TYPES;
  const ext = IMAGE_TYPES[type] ?? VIDEO_TYPES[type];
  if (!ext) return Response.json({ error: "只支持 JPG、PNG、WebP、GIF 图片，或 MP4、WebM、MOV 视频" }, { status: 400 });
  if (!request.body || !Number.isFinite(size) || size <= 0) return Response.json({ error: "没有收到文件" }, { status: 400 });
  const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > max) return Response.json({ error: isVideo ? "视频不能超过 200MB" : "图片不能超过 10MB" }, { status: 400 });

  // 实际收到的字节数不能超过声明的大小
  let received = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      cb(received > size ? new Error("文件大小与声明不符") : null, chunk);
    },
  });
  const body = Readable.fromWeb(request.body as import("node:stream/web").ReadableStream).pipe(guard);

  const name = `${Date.now().toString(36)}${randomBytes(6).toString("hex")}.${ext}`;
  try {
    await putObject(`${user.tenantId}/${name}`, body, { contentType: type, size });
  } catch (e) {
    console.error("upload failed", e);
    return Response.json({ error: "上传失败，请重试" }, { status: 500 });
  }
  return Response.json({ url: `/api/files/${user.tenantId}/${name}`, kind: isVideo ? "video" : "image" });
}
