import type { NextRequest } from "next/server";
import { readShareToken } from "@/server/share";
import { serveObject } from "@/server/storage";
import { MIME_OF } from "@/server/uploads";

/** 公开页面上的产品图片 / 视频：链接带签名，只能读签过名的那一个文件 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/s/img/[token]">) {
  const { token } = await ctx.params;
  const payload = readShareToken("img", token);
  const key = payload ? Buffer.from(payload, "base64url").toString("utf8") : null;
  if (!key || !/^[a-z0-9]+\/[a-z0-9]+\.(jpg|png|webp|gif|mp4|webm|mov)$/.test(key)) return new Response("Not found", { status: 404 });
  return serveObject(key, { contentType: MIME_OF[key.split(".").pop()!] ?? "application/octet-stream" });
}
