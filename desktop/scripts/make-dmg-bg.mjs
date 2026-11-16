// 生成 DMG 窗口背景（含安装和「打不开怎么办」说明）：
//   ./node_modules/.bin/electron scripts/make-dmg-bg.mjs
// 输出 build/background.tiff（600×460，含 @2x）。图标位置和 package.json 的 build.dmg.contents 对应。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, nativeImage } from "electron";

const build = path.join(import.meta.dirname, "..", "build");
const W = 600;
const H = 460;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${W * 2}px;height:${H * 2}px;overflow:hidden}
  .page{width:${W}px;height:${H}px;zoom:2;box-sizing:border-box;background:#f6f6f9;
    font-family:-apple-system,"PingFang SC",sans-serif;color:#1d1d1f;position:relative}
  h1{position:absolute;top:22px;left:0;right:0;margin:0;text-align:center;font-size:15px;font-weight:600}
  .arrow{position:absolute;top:128px;left:250px;width:100px;height:2px;background:#8a8aa0}
  .arrow:after{content:"";position:absolute;right:-2px;top:-5px;border:6px solid transparent;border-left:9px solid #8a8aa0;border-right:0}
  .help{position:absolute;left:36px;right:36px;top:228px;padding:12px 16px;border-radius:10px;
    background:#fff;border:1px solid #e3e3ea;font-size:12px;line-height:1.75}
  .help b{font-weight:600}
  .help .t{font-size:13px;font-weight:600;margin-bottom:2px}
  .muted{color:#6e6e80}
</style></head><body><div class="page">
  <h1>把「车车 CRM」拖到「应用程序」</h1>
  <div class="arrow"></div>
  <div class="help">
    <div class="t">第一次打开被系统拦住？</div>
    1. 在「应用程序」里双击打开，提示「无法验证」时点<b>完成</b><br>
    2. 打开 <b>系统设置 → 隐私与安全性</b>，在最下面点<b>仍要打开</b>，输入开机密码<br>
    <span class="muted">提示「已损坏」或找不到按钮：双击下面的「打不开请看我」，按里面的命令操作</span>
  </div>
</div></body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W * 2,
    height: H * 2,
    show: false,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true, zoomFactor: 1 },
  });
  let last = null;
  win.webContents.on("paint", (_e, _dirty, image) => (last = image));
  win.webContents.setFrameRate(10);
  const tmp = path.join(build, ".render.html");
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp).finally(() => fs.rmSync(tmp, { force: true }));
  await new Promise((r) => setTimeout(r, 1000));
  if (!last) throw new Error("没画出来");
  const full = last.getSize().width === W * 2 ? last : last.resize({ width: W * 2, height: H * 2, quality: "best" });
  const p2 = path.join(build, "background@2x.png");
  const p1 = path.join(build, "background.png");
  fs.writeFileSync(p2, full.toPNG());
  fs.writeFileSync(p1, nativeImage.createFromBuffer(full.toPNG()).resize({ width: W, height: H, quality: "best" }).toPNG());
  execFileSync("tiffutil", ["-cathidpicheck", p1, p2, "-out", path.join(build, "background.tiff")]);
  fs.rmSync(p1);
  if (!process.env.KEEP) fs.rmSync(p2);
  console.log("wrote background.tiff");
  app.quit();
}).catch((e) => {
  console.error(e);
  app.exit(1);
});
