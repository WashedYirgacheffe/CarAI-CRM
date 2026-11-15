// 把运行器（scripts/matrix-runner.mts）打成一个 JS 文件，嵌进 CRM，云端运行器启动时上传到 Sandbox 里执行。
// 由 pnpm build / pnpm typecheck 自动调用；产物 src/generated/matrix-runner-bundle.ts 不进 git。
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = await build({
  entryPoints: [path.join(root, "scripts/matrix-runner.mts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  write: false,
  // 浏览器内核和 Playwright 已经装在 Sandbox 基础镜像里
  external: ["camoufox", "playwright-core"],
  alias: { "@": path.join(root, "src") },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
mkdirSync(path.join(root, "src/generated"), { recursive: true });
writeFileSync(
  path.join(root, "src/generated/matrix-runner-bundle.ts"),
  `// 自动生成，勿改：scripts/build-matrix-runner.mjs\nconst bundle: string = ${JSON.stringify(out.outputFiles[0].text)};\nexport default bundle;\n`,
);
console.log(`matrix runner bundle: ${(out.outputFiles[0].text.length / 1024).toFixed(0)} KB`);
