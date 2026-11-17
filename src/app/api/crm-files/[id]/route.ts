import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { fileForUser, previewResponse } from "@/server/files";
import { serveObject } from "@/server/storage";

/** 客户文件 / AI 临时文件：?download 下载，?preview=raw|json 在线预览 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/crm-files/[id]">,
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const found = await fileForUser(user, id);
  if (!found) return new Response("Not found", { status: 404 });
  const { file } = found;
  const preview = req.nextUrl.searchParams.get("preview");
  if (preview) return previewResponse(preview, file.key, file.name, file.mime);
  return serveObject(file.key, {
    contentType: file.mime,
    filename: file.name,
    download: true,
    cache: "private, max-age=3600",
  });
}
