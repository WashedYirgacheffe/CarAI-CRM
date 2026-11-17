import { getCurrentUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { saveFile } from "@/server/files";
import { MAX_FILE_BYTES } from "@/lib/files";

/**
 * 上传客户文件，或发给 AI 看的文件。请求体就是文件本身：
 * x-file-name（encodeURIComponent）、x-customer-id（不带 = 给 AI 的临时文件，只有自己能看）、x-category（可选）。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const size = Number(request.headers.get("content-length") ?? NaN);
  if (!request.body || !Number.isFinite(size) || size <= 0)
    return Response.json({ error: "没有收到文件" }, { status: 400 });
  if (size > MAX_FILE_BYTES)
    return Response.json({ error: "文件不能超过 25MB" }, { status: 400 });

  const customerId = request.headers.get("x-customer-id") || null;
  if (customerId) {
    const found = await getCustomerForUser(user, customerId);
    if (!found)
      return Response.json({ error: "客户不存在或没有权限" }, { status: 404 });
    if (!found.access.edit)
      return Response.json(
        { error: "没有编辑这个客户的权限" },
        { status: 403 },
      );
  }
  let name = "file";
  try {
    name =
      decodeURIComponent(request.headers.get("x-file-name") ?? "") || "file";
  } catch {}
  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.length > MAX_FILE_BYTES)
    return Response.json({ error: "文件不能超过 25MB" }, { status: 400 });
  try {
    const f = await saveFile(user, {
      customerId,
      name,
      mime: request.headers.get("content-type"),
      buffer,
      category: request.headers.get("x-category"),
      source: "upload",
    });
    return Response.json({
      id: f.id,
      name: f.name,
      mime: f.mime,
      size: f.size,
      category: f.category,
      textState: f.textState,
    });
  } catch (e) {
    console.error("file upload failed", e);
    return Response.json({ error: "上传失败，请重试" }, { status: 500 });
  }
}
