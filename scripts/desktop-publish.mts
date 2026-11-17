/**
 * 发布桌面版：把 desktop/release 里的安装包和更新清单传到存储的 desktop/ 目录（OSS），
 * 装了旧版的电脑 4 小时内检查到并自动下载，重启后生效。
 *
 *   cd desktop && npm run dist       # Mac：DMG + ZIP + latest-mac.yml（签名公证需要的环境变量见 desktop/README.md）
 *   cd desktop && npm run dist:win   # Windows：安装程序 .exe + latest.yml
 *   pnpm desktop:publish [desktop/release]
 *
 * 目录里有哪个平台的清单就发哪个平台。需要和服务器一样的 OSS_* 环境变量。
 * 清单最后传：安装包都到位了，客户端才会看到新版本。
 */
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";

loadEnv({ quiet: true });
const { putObject, ossEnabled } = await import("@/server/storage");

const dir = path.resolve(process.argv[2] || "desktop/release");
const ymls = ["latest-mac.yml", "latest.yml"].filter((n) => fs.existsSync(path.join(dir, n)));
if (!ymls.length) {
  console.error(`${dir} 里没有 latest-mac.yml 或 latest.yml，先在 desktop 里 npm run dist / dist:win`);
  process.exit(1);
}
if (!ossEnabled) console.warn("没有配置 OSS_BUCKET，只会存到本地 UPLOAD_DIR（仅供测试）");
const type = (n: string) =>
  n.endsWith(".zip") ? "application/zip" : n.endsWith(".dmg") ? "application/x-apple-diskimage" : n.endsWith(".exe") ? "application/vnd.microsoft.portable-executable" : "application/octet-stream";
for (const yml of ymls) {
  const text = fs.readFileSync(path.join(dir, yml), "utf8");
  const version = /^version:\s*(\S+)/m.exec(text)?.[1];
  const names = new Set([...text.matchAll(/(?:url|path):\s*(\S+)/g)].map((m) => m[1]));
  for (const n of [...names]) if (fs.existsSync(path.join(dir, `${n}.blockmap`))) names.add(`${n}.blockmap`);
  for (const n of names) {
    const p = path.join(dir, n);
    if (!fs.existsSync(p)) throw new Error(`${yml} 里列了 ${n}，但目录里没有`);
    const size = fs.statSync(p).size;
    process.stdout.write(`上传 ${n}（${Math.round(size / 1048576)} MB）… `);
    await putObject(`desktop/${n}`, fs.createReadStream(p), { contentType: type(n), size });
    console.log("好了");
  }
  await putObject(`desktop/${yml}`, Buffer.from(text), { contentType: "text/yaml" });
  console.log(`已发布桌面版 ${version}（${yml === "latest.yml" ? "Windows" : "Mac"}）`);
}
