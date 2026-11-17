// 环境运行器子进程：用 Electron 自带的 Node（ELECTRON_RUN_AS_NODE）跑 dist/runner.mjs。
// 崩溃自动重启；首次运行先下载 Camoufox 浏览器内核。
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { app } from "electron";

const require = createRequire(import.meta.url);
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const runnerFile = () => unpacked(path.join(app.getAppPath(), "dist", "runner.mjs"));
const camoufoxCli = () => unpacked(path.join(path.dirname(require.resolve("camoufox/package.json")), "dist", "__main__.js"));

function logFile() {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "runner.log");
}
export const runnerLogPath = logFile;

/** 浏览器内核状态：运行器读它决定能不能领任务，并把说明（下载进度）报给 CRM */
const browserStateFile = () => path.join(app.getPath("userData"), "browser-state.json");
export function setBrowserState(ready, note = "") {
  try {
    fs.writeFileSync(browserStateFile(), JSON.stringify({ ready, note }));
  } catch {
    /* 写不了就算了，运行器会当成还没准备好 */
  }
}

function nodeEnv(extra = {}) {
  return { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...extra };
}

/** 一次性的子进程（下载内核等），退出软件时一起结束 */
const helpers = new Set();
export function killHelpers() {
  for (const c of helpers) if (c.exitCode === null) killTree(c);
}

function runNode(file, args, env, onLine) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], { env: nodeEnv(env), cwd: app.getPath("userData"), stdio: ["ignore", "pipe", "pipe"] });
    helpers.add(child);
    const out = fs.createWriteStream(logFile(), { flags: "a" });
    const feed = (b) => {
      out.write(b);
      // 下载进度用 \r 刷新同一行
      for (const line of b.toString().split(/[\r\n]+/)) if (line.trim()) onLine?.(line);
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("exit", (code) => {
      helpers.delete(child);
      out.end();
      resolve(code ?? 1);
    });
  });
}

/** Camoufox 内核没下载过就下载（压缩包 1 GB 多，只在第一次） */
export async function ensureBrowser(onProgress) {
  let notFetched = false;
  await runNode(camoufoxCli(), ["active"], {}, (l) => {
    if (/not fetched/i.test(l)) notFetched = true;
  });
  if (notFetched) {
    onProgress?.("正在下载浏览器内核（只在第一次，文件较大，请保持联网）…");
    const code = await runNode(camoufoxCli(), ["fetch"], {}, (l) => {
      const m = /(\d{1,3})%/.exec(l);
      if (m) onProgress?.(`正在下载浏览器内核 ${m[1]}%`);
    });
    if (code !== 0) return false;
  }
  brandBrowser();
  return true;
}

const BROWSER_NAME = "车车浏览器";

/**
 * 把下载的内核改成「车车浏览器」：程序坞和菜单栏的名字、图标都换成我们的。
 * 内核是链接器 ad-hoc 签名，Info.plist 不在签名范围内，改了不用重签。每次启动检查一遍（内核升级会换新目录）。
 */
function brandBrowser() {
  if (process.platform === "win32") return brandBrowserWin();
  if (process.platform !== "darwin") return;
  const root = path.join(app.getPath("home"), "Library", "Caches", "camoufox", "browsers");
  const icon = [path.join(process.resourcesPath, "icon.icns"), path.join(app.getAppPath(), "build", "icon.icns")].find((p) => fs.existsSync(p));
  const apps = [];
  try {
    for (const channel of fs.readdirSync(root))
      for (const ver of fs.readdirSync(path.join(root, channel))) {
        const a = path.join(root, channel, ver, "Camoufox.app");
        if (fs.existsSync(path.join(a, "Contents", "Info.plist"))) apps.push(a);
      }
  } catch {
    return;
  }
  for (const a of apps) {
    const res = path.join(a, "Contents", "Resources");
    const plist = path.join(a, "Contents", "Info.plist");
    try {
      if (fs.readFileSync(plist, "utf8").includes(`<string>${BROWSER_NAME}</string>`)) continue;
      const set = (...args) => execFileSync("plutil", [...args, plist]);
      set("-replace", "CFBundleName", "-string", BROWSER_NAME);
      set("-replace", "CFBundleDisplayName", "-string", BROWSER_NAME);
      if (icon) {
        fs.copyFileSync(icon, path.join(res, "cheche.icns"));
        set("-replace", "CFBundleIconFile", "-string", "cheche.icns");
        // 新系统优先用 Assets.car 里的 AppIcon，去掉才会用上面的图标文件
        try {
          set("-remove", "CFBundleIconName");
        } catch {
          /* 没有这个键 */
        }
      }
      for (const lp of fs.readdirSync(res).filter((f) => f.endsWith(".lproj"))) {
        const strings = path.join(res, lp, "InfoPlist.strings");
        if (fs.existsSync(strings)) fs.writeFileSync(strings, `CFBundleName = "${BROWSER_NAME}";\nCFBundleDisplayName = "${BROWSER_NAME}";\n`);
      }
      // 让系统重新读名字和图标
      const now = new Date();
      fs.utimesSync(a, now, now);
      try {
        execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", a]);
      } catch {
        /* 刷新不了也不影响使用 */
      }
    } catch (e) {
      fs.appendFileSync(logFile(), `改浏览器名字和图标失败：${e instanceof Error ? e.message : e}\n`);
    }
  }
}

/**
 * Windows：改 camoufox.exe 的版本信息（任务栏显示的名字取 FileDescription）和图标。
 * 内核没有签名，改资源不影响运行；改完在旁边留个标记，下次不再改。
 */
function brandBrowserWin() {
  const base = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
  const root = path.join(base, "camoufox", "camoufox", "Cache", "browsers");
  const icon = path.join(app.getAppPath(), "build", "icon.ico");
  const exes = [];
  try {
    for (const channel of fs.readdirSync(root))
      for (const ver of fs.readdirSync(path.join(root, channel))) {
        const exe = path.join(root, channel, ver, "camoufox.exe");
        if (fs.existsSync(exe)) exes.push(exe);
      }
  } catch {
    return;
  }
  const { NtExecutable, NtExecutableResource, Resource, Data } = require("resedit");
  for (const exe of exes) {
    const mark = path.join(path.dirname(exe), ".cheche-branded");
    if (fs.existsSync(mark)) continue;
    try {
      const bin = NtExecutable.from(fs.readFileSync(exe));
      const res = NtExecutableResource.from(bin);
      const vi = Resource.VersionInfo.fromEntries(res.entries)[0] ?? Resource.VersionInfo.createEmpty();
      const langs = vi.getAllLanguagesForStringValues();
      const lang = langs[0] ?? { lang: 0x0409, codepage: 1200 };
      vi.setStringValues(lang, { FileDescription: BROWSER_NAME, ProductName: BROWSER_NAME, CompanyName: "车车 CRM" });
      vi.outputToResourceEntries(res.entries);
      if (fs.existsSync(icon)) {
        // 程序图标是编号最小的那组图标
        const groups = Resource.IconGroupEntry.fromEntries(res.entries);
        const first = groups.sort((a, b) => (typeof a.id === "number" && typeof b.id === "number" ? a.id - b.id : 0))[0];
        const icons = Data.IconFile.from(fs.readFileSync(icon)).icons.map((i) => i.data);
        Resource.IconGroupEntry.replaceIconsForResource(res.entries, first?.id ?? 1, first?.lang ?? lang.lang, icons);
      }
      res.outputResource(bin);
      const tmp = `${exe}.cheche-tmp`;
      fs.writeFileSync(tmp, Buffer.from(bin.generate()));
      fs.renameSync(tmp, exe);
      fs.writeFileSync(mark, new Date().toISOString());
    } catch (e) {
      fs.appendFileSync(logFile(), `改浏览器名字和图标失败：${e instanceof Error ? e.message : e}\n`);
    }
  }
}

/** Windows 上 kill() 会直接结束进程、不走退出流程，浏览器子进程会残留：连同子进程一起结束 */
function killTree(child, force) {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* 已经退出 */
    }
  } else child.kill(force ? "SIGKILL" : "SIGTERM");
}

export class Runner {
  constructor({ crmUrl, onState, onWatch }) {
    this.crmUrl = crmUrl;
    this.onState = onState;
    /** 常驻监听的账号变了：(names: string[]) */
    this.onWatch = onWatch;
    this.child = null;
    this.token = null;
    this.host = "";
    this.stopped = true;
    this.fails = 0;
    this.state = "stopped";
  }

  set(state, detail) {
    this.state = state;
    this.onState?.(state, detail);
  }

  /** 用这个设备令牌启动（已经在跑并且令牌没变就不动） */
  start(token, host) {
    if (this.child && this.token === token) return;
    this.stop();
    this.token = token;
    this.host = host;
    this.stopped = false;
    this.fails = 0;
    this.spawn();
  }

  spawn() {
    if (this.stopped) return;
    const child = spawn(process.execPath, [runnerFile()], {
      cwd: app.getPath("userData"),
      env: nodeEnv({
        CRM_URL: this.crmUrl,
        MATRIX_RUNNER_TOKEN: this.token,
        MATRIX_RUNNER_HOST: this.host,
        MATRIX_PROFILE_DIR: path.join(app.getPath("userData"), "matrix"),
        MATRIX_BROWSER_STATE: browserStateFile(),
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.set("running");
    const out = fs.createWriteStream(logFile(), { flags: "a" });
    out.write(`\n──── ${new Date().toISOString()} 运行器启动 ────\n`);
    const feed = (b) => out.write(b);
    // 运行器用「@@watch 数量 名字、名字」这一行告诉外壳哪些账号在实时收私信
    let rest = "";
    child.stdout.on("data", (b) => {
      feed(b);
      const lines = (rest + b.toString()).split("\n");
      rest = lines.pop() ?? "";
      for (const l of lines) {
        const m = /^@@watch (\d+) ?(.*)$/.exec(l.trim());
        if (m) this.onWatch?.(m[2] ? m[2].split("、") : []);
      }
    });
    child.stderr.on("data", feed);
    const started = Date.now();
    child.on("exit", (code) => {
      out.end();
      this.onWatch?.([]);
      if (this.child !== child) return;
      this.child = null;
      if (this.stopped) return this.set("stopped");
      if (code === 3) {
        this.stopped = true;
        return this.set("unauthorized");
      }
      // 跑了一分钟以上再崩的不算连续失败
      this.fails = Date.now() - started > 60_000 ? 1 : this.fails + 1;
      if (this.fails > 5) return this.set("crashed", `运行器连续退出（代码 ${code}），查看日志`);
      this.set("restarting");
      setTimeout(() => this.spawn(), Math.min(30_000, 2000 * this.fails));
    });
  }

  stop() {
    this.stopped = true;
    const c = this.child;
    this.child = null;
    if (c && c.exitCode === null) {
      killTree(c);
      setTimeout(() => c.exitCode === null && killTree(c, true), 8000).unref();
    }
    this.set("stopped");
  }
}
