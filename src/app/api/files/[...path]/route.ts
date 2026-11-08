import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { IMAGE_TYPES, resolveUpload } from "@/server/uploads";

const MIME = Object.fromEntries(Object.entries(IMAGE_TYPES).map(([mime, ext]) => [ext, mime]));

/** 读取上传的文件：只能读本企业的 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/files/[...path]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { path: segments } = await ctx.params;
  const file = resolveUpload(user.tenantId, segments);
  if (!file) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(file);
    return new Response(data, {
      headers: {
        "Content-Type": MIME[file.split(".").pop()!] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
