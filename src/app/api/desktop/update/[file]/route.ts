import { getObject, serveObject } from "@/server/storage";

/*
 * 桌面版自动更新源（electron-updater generic provider：https://<CRM>/api/desktop/update）。
 * 文件由 scripts/desktop-publish.mts 传到存储的 desktop/ 目录：
 *   latest-mac.yml 直接返回（不缓存，发新版立即生效）；安装包 / 差量块 302 到有时效的 OSS 链接。
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/desktop/update/[file]">) {
  const { file } = await ctx.params;
  if (!/^[A-Za-z0-9_.-]+$/.test(file) || file.startsWith(".")) return new Response("Not found", { status: 404 });
  const key = `desktop/${file}`;
  if (file.endsWith(".yml")) {
    const data = await getObject(key).catch(() => null);
    if (!data) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(data), { headers: { "content-type": "text/yaml; charset=utf-8", "cache-control": "no-store" } });
  }
  const type = file.endsWith(".zip") ? "application/zip" : file.endsWith(".dmg") ? "application/x-apple-diskimage" : "application/octet-stream";
  return serveObject(key, { contentType: type, filename: file, download: true });
}
