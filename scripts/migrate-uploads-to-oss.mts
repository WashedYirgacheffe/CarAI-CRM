/**
 * 把本地 UPLOAD_DIR 里的文件（产品图、邮件附件等）原样上传到 OSS，key = 相对路径。
 * 可重复执行（同名覆盖）。本地文件保留不删，确认无误后可自行清理。
 *
 *   docker compose run --rm worker pnpm job:migrate-uploads
 */
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ossEnabled, putObject, UPLOAD_DIR } from "@/server/storage";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

if (!ossEnabled) {
  console.error("没有配置 OSS_BUCKET，不需要迁移");
  process.exit(1);
}
let ok = 0;
let failed = 0;
for await (const file of walk(UPLOAD_DIR)) {
  const key = path.relative(UPLOAD_DIR, file).split(path.sep).join("/");
  try {
    await putObject(key, await readFile(file), { contentType: MIME[key.split(".").pop() ?? ""] ?? "application/octet-stream" });
    ok++;
  } catch (e) {
    failed++;
    console.error("失败", key, (e as Error).message);
  }
}
console.log(`迁移完成：成功 ${ok} 个，失败 ${failed} 个`);
process.exit(failed ? 1 : 0);
