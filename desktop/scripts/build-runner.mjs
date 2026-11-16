// 把 CRM 仓库里的环境运行器（scripts/matrix-runner.mts）打成 dist/runner.mjs，随桌面版一起发。
// camoufox、playwright-core 装在桌面版自己的 node_modules 里。
import { build } from "esbuild";
import path from "node:path";

const here = path.resolve(import.meta.dirname, "..");
const root = path.resolve(here, "..");
await build({
  entryPoints: [path.join(root, "scripts/matrix-runner.mts")],
  outfile: path.join(here, "dist/runner.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["camoufox", "playwright-core"],
  alias: { "@": path.join(root, "src") },
  // 打包后的 dotenv 等 CJS 依赖要用 require
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
console.log("runner → dist/runner.mjs");
