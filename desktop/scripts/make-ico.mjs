// 由 build/icon.png 生成 Windows 图标 build/icon.ico（PNG 格式的各尺寸打包进一个 ICO）：
//   node scripts/make-ico.mjs <放 16/24/32/48/64/128/256.png 的目录>
// 各尺寸先用 sips 从 icon.png 裁掉 macOS 留白再缩放：sips -c 860 860 build/icon.png …; sips -z N N …
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => fs.readFileSync(path.join(dir, `${s}.png`)));
const head = Buffer.alloc(6);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s >= 256 ? 0 : s, 0);
  e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
fs.writeFileSync(path.join(import.meta.dirname, "..", "build", "icon.ico"), Buffer.concat([head, ...entries, ...pngs]));
console.log("wrote build/icon.ico");
