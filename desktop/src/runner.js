// 环境运行器子进程：用 Electron 自带的 Node（ELECTRON_RUN_AS_NODE）跑 dist/runner.mjs。
// 崩溃自动重启；首次运行先下载 Camoufox 浏览器内核。
import { spawn } from "node:child_process";
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
  for (const c of helpers) if (c.exitCode === null) c.kill("SIGTERM");
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
  if (!notFetched) return true;
  onProgress?.("正在下载浏览器内核（只在第一次，文件较大，请保持联网）…");
  const code = await runNode(camoufoxCli(), ["fetch"], {}, (l) => {
    const m = /(\d{1,3})%/.exec(l);
    if (m) onProgress?.(`正在下载浏览器内核 ${m[1]}%`);
  });
  return code === 0;
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
      c.kill("SIGTERM");
      setTimeout(() => c.exitCode === null && c.kill("SIGKILL"), 8000).unref();
    }
    this.set("stopped");
  }
}
