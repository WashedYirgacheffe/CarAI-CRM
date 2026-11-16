import { getObject } from "@/server/storage";

/** 下载最新的桌面版安装包：/api/desktop/download?arch=arm64|x64（默认 Apple 芯片） */
export async function GET(req: Request) {
  const arch = new URL(req.url).searchParams.get("arch") === "x64" ? "x64" : "arm64";
  const yml = await getObject("desktop/latest-mac.yml").catch(() => null);
  if (!yml) return new Response("桌面版还没有发布", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const files = [...yml.toString("utf8").matchAll(/url:\s*(\S+\.dmg)/g)].map((m) => m[1]);
  const dmg = files.find((f) => f.includes(`-${arch}-`)) ?? files[0];
  if (!dmg) return new Response("没有找到安装包", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return Response.redirect(new URL(`/api/desktop/update/${encodeURIComponent(dmg)}`, req.url), 302);
}
