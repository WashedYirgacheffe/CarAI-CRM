// 打包前补齐两个架构的原生模块：npm 只装当前 CPU 的那一份，
// 在 Apple 芯片上打 Intel 包时会缺 impit-darwin-x64（Camoufox 下载内核要用），反之亦然。
// 版本跟 impit 主包的 optionalDependencies 对齐。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const nm = path.join(root, "node_modules");
const impit = JSON.parse(fs.readFileSync(path.join(nm, "impit", "package.json"), "utf8"));

for (const name of ["impit-darwin-arm64", "impit-darwin-x64"]) {
  const version = impit.optionalDependencies?.[name];
  if (!version) throw new Error(`impit 没有声明 ${name}`);
  const dest = path.join(nm, name);
  const cur = fs.existsSync(path.join(dest, "package.json")) ? JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).version : null;
  if (cur === version) continue;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "native-"));
  const tgz = execFileSync("npm", ["pack", `${name}@${version}`, "--silent", "--pack-destination", tmp], { encoding: "utf8" }).trim().split("\n").pop();
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["xzf", path.join(tmp, tgz), "-C", dest, "--strip-components=1"]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`补齐 ${name}@${version}`);
}
