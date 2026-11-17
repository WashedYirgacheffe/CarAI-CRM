import { getObject } from "@/server/storage";

const text = (msg: string) => new Response(msg, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

/** 下载最新的桌面版安装包：/api/desktop/download?arch=arm64|x64|win（默认 Apple 芯片的 Mac 版） */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("arch");
  const win = q === "win";
  const arch = q === "x64" ? "x64" : "arm64";
  const yml = await getObject(win ? "desktop/latest.yml" : "desktop/latest-mac.yml").catch(() => null);
  if (!yml) return text(win ? "Windows 版还没有发布" : "桌面版还没有发布");
  const files = [...yml.toString("utf8").matchAll(/url:\s*(\S+\.(?:dmg|exe))/g)].map((m) => m[1]);
  const file = win ? files[0] : (files.find((f) => f.includes(`-${arch}-`)) ?? files[0]);
  if (!file) return text("没有找到安装包");
  // 用相对地址：反向代理后面 req.url 的主机是容器内的 0.0.0.0:3000
  return new Response(null, { status: 302, headers: { location: `/api/desktop/update/${encodeURIComponent(file)}` } });
}
