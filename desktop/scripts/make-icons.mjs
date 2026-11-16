// 生成安装包图标和菜单栏图标（用 Electron 离屏渲染 SVG，比 sips 清晰）：
//   ./node_modules/.bin/electron scripts/make-icons.mjs
// 输出 build/icon.png（1024，带 macOS 图标留白）、build/icon.icns、build/trayTemplate.png / @2x
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, nativeImage } from "electron";

const here = import.meta.dirname;
const build = path.join(here, "..", "build");
const svg = fs.readFileSync(path.join(build, "icon-source.svg"), "utf8");
// 菜单栏图标只要标志本身（白色笔画改成黑色，系统按深浅色自动反色）
const mark = svg.match(/<svg x="10"[\s\S]*<\/svg><\/svg>$/)[0].replace(/<\/svg>$/, "").replace(/fill="#fff"/g, 'fill="#000"').replace(/ opacity="\.75"/, "");

/** 离屏渲染：同一个窗口依次画（第二个窗口加载会 ERR_FAILED），等 paint 事件取整帧，再裁出需要的区域 */
let win = null;
let last = null;
async function render(html, w, h, file) {
  if (!win) {
    win = new BrowserWindow({
      width: 1024,
      height: 1024,
      show: false,
      transparent: true,
      frame: false,
      useContentSize: true,
      webPreferences: { offscreen: true, zoomFactor: 1 },
    });
    win.webContents.on("paint", (_e, _dirty, image) => (last = image));
    win.webContents.setFrameRate(10);
  }
  last = null;
  const tmp = path.join(build, `.render.html`);
  fs.writeFileSync(tmp, `<html><body style="margin:0;background:transparent;overflow:hidden">${html}</body></html>`);
  await win.loadFile(tmp).finally(() => fs.rmSync(tmp, { force: true }));
  await new Promise((r) => setTimeout(r, 800));
  if (!last) throw new Error(`没画出来：${file}`);
  let img = last;
  const scale = img.getSize().width / 1024;
  if (w < 1024 || h < 1024) img = img.crop({ x: 0, y: 0, width: Math.round(w * scale), height: Math.round(h * scale) });
  if (img.getSize().width !== w) img = img.resize({ width: w, height: h, quality: "best" });
  fs.writeFileSync(file, img.toPNG());
  console.log("wrote", path.basename(file), img.getSize());
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const dataUrl = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString("base64")}`;
  // macOS 图标规范：1024 画布，主体 824，四周留白，带一点投影
  await render(
    `<div style="width:1024px;height:1024px;display:flex;align-items:center;justify-content:center">
       <img src="${dataUrl(svg)}" style="width:824px;height:824px;filter:drop-shadow(0 12px 18px rgba(40,30,120,.28))">
     </div>`,
    1024, 1024, path.join(build, "icon.png"),
  );
  const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="7.5 7.5 49 49">${mark}</svg>`;
  // 窗口太小渲染不出来：画大图再缩小
  const big = path.join(build, "tray-big.png");
  await render(`<img src="${dataUrl(markSvg)}" style="width:360px;height:360px;display:block">`, 360, 360, big);
  for (const [s, name] of [[18, "trayTemplate.png"], [36, "trayTemplate@2x.png"]]) {
    fs.writeFileSync(path.join(build, name), nativeImage.createFromPath(big).resize({ width: s, height: s, quality: "best" }).toPNG());
  }
  if (!process.env.KEEP) fs.rmSync(big);
  // icns
  const set = path.join(build, "icon.iconset");
  fs.rmSync(set, { recursive: true, force: true });
  fs.mkdirSync(set);
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync("sips", ["-z", String(s), String(s), path.join(build, "icon.png"), "--out", path.join(set, `icon_${s}x${s}.png`)]);
    execFileSync("sips", ["-z", String(s * 2), String(s * 2), path.join(build, "icon.png"), "--out", path.join(set, `icon_${s}x${s}@2x.png`)]);
  }
  execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(build, "icon.icns")]);
  fs.rmSync(set, { recursive: true, force: true });
  console.log("icons ok");
  app.quit();
}).catch((e) => {
  console.error(e);
  app.exit(1);
});
