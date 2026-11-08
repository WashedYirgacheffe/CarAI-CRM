import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getCurrentUser } from "@/server/auth";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, UPLOAD_DIR } from "@/server/uploads";

/** 上传图片（产品图等），返回可访问的 URL。只接受 jpg / png / webp / gif，最大 3MB。 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "没有收到文件" }, { status: 400 });
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return Response.json({ error: "只支持 JPG、PNG、WebP、GIF 图片" }, { status: 400 });
  if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "图片不能超过 3MB" }, { status: 400 });

  const name = `${Date.now().toString(36)}${randomBytes(6).toString("hex")}.${ext}`;
  const dir = path.join(UPLOAD_DIR, user.tenantId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return Response.json({ url: `/api/files/${user.tenantId}/${name}` });
}
