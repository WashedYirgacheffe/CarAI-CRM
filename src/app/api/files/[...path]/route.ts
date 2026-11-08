import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { serveObject } from "@/server/storage";
import { MIME_OF, resolveUpload } from "@/server/uploads";

/** 读取上传的图片 / 视频：只能读本企业的 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/files/[...path]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { path: segments } = await ctx.params;
  const key = resolveUpload(user.tenantId, segments);
  if (!key) return new Response("Not found", { status: 404 });
  return serveObject(key, { contentType: MIME_OF[key.split(".").pop()!] ?? "application/octet-stream" });
}
