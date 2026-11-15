// 社媒矩阵运行器：在要弹浏览器窗口的电脑上跑（试点用自己的 Mac），拿企业令牌去 CRM 领任务，
// 每个账号用一个 Camoufox 持久化环境（固定指纹 + 自己的代理）。方案见 docs/social-matrix-plan.md
//
//   CRM_URL=https://crm.caraicrm.com MATRIX_RUNNER_TOKEN=mr_xxx pnpm matrix-runner
//
// 也可以把这两个变量写进项目根目录的 .env.runner。需要 Node 22.15+。
import { config as loadEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { socksDispatcher } from "fetch-socks";
import { matrixPlatform, type MatrixPlatformInfo } from "@/lib/matrix";

loadEnv({ path: ".env.runner", quiet: true });

const VERSION = "0.1.0";
const CRM_URL = (process.env.CRM_URL || "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = process.env.MATRIX_RUNNER_TOKEN || "";
const ROOT = process.env.MATRIX_PROFILE_DIR || path.join(os.homedir(), ".cheche-crm", "matrix");
const MAX_JOBS = Math.max(1, Number(process.env.MATRIX_MAX_JOBS || 3));
const POLL_MS = 3000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;

const log = (...a: unknown[]) => console.log(new Date().toLocaleTimeString(), ...a);

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 15)) {
  console.error(`Camoufox 需要 Node 22.15 以上，当前是 ${process.version}。可以用：PATH=/opt/homebrew/bin:$PATH pnpm matrix-runner`);
  process.exit(1);
}
if (!TOKEN.startsWith("mr_")) {
  console.error("缺少运行器令牌：到 CRM「社媒矩阵 → 运行器」生成，设成环境变量 MATRIX_RUNNER_TOKEN（或写进 .env.runner）");
  process.exit(1);
}

fs.mkdirSync(ROOT, { recursive: true });
const idFile = path.join(ROOT, "runner-id");
const RUNNER_ID = fs.existsSync(idFile) ? fs.readFileSync(idFile, "utf8").trim() : randomUUID();
fs.writeFileSync(idFile, RUNNER_ID);
const HOST = os.hostname().replace(/\.local$/, "");

// ── 和 CRM 通信 ──

async function api<T>(p: string, body: unknown): Promise<T> {
  const res = await fetch(`${CRM_URL}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

type Proxy = { server: string; username?: string; password?: string };
type Job = {
  id: string;
  kind: "login" | "open" | "check";
  account: { id: string; platform: string; name: string; os: string; fingerprint: Record<string, unknown> | null; status: string };
  proxy: Proxy;
};
type Report = {
  status?: "running" | "waiting" | "done" | "failed";
  error?: string;
  result?: Record<string, unknown>;
  account?: {
    status?: "new" | "pending" | "active" | "expired" | "restricted";
    statusNote?: string | null;
    fingerprint?: Record<string, unknown>;
    loggedIn?: boolean;
    checked?: boolean;
  };
  event?: string;
};

const report = (jobId: string, r: Report) =>
  api<{ ok: boolean; canceled: boolean }>(`/api/matrix/runner/jobs/${jobId}`, { runnerId: RUNNER_ID, ...r }).catch((e) => {
    log("回报失败", jobId, (e as Error).message);
    return { ok: false, canceled: false };
  });

// ── 代理出口：启动前先查一遍，查不到就不开（不让真实 IP 漏出去） ──

type Geo = { ip: string; timezone: string; lat: number; lon: number; countryCode: string };

function dispatcherOf(p: Proxy): Dispatcher {
  const u = new URL(p.server);
  if (u.protocol.startsWith("socks")) {
    return socksDispatcher({
      type: 5,
      host: u.hostname,
      port: Number(u.port),
      ...(p.username ? { userId: p.username, password: p.password ?? "" } : {}),
    });
  }
  return new ProxyAgent({
    uri: p.server,
    ...(p.username ? { token: `Basic ${Buffer.from(`${p.username}:${p.password ?? ""}`).toString("base64")}` } : {}),
  });
}

async function proxyGeo(p: Proxy): Promise<Geo> {
  const dispatcher = dispatcherOf(p);
  try {
    const res = await undiciFetch("http://ip-api.com/json/?fields=status,message,query,timezone,lat,lon,countryCode", {
      dispatcher,
      signal: AbortSignal.timeout(15_000),
    });
    const d = (await res.json()) as { status: string; message?: string; query: string; timezone: string; lat: number; lon: number; countryCode: string };
    if (d.status !== "success") throw new Error(d.message || "查询失败");
    return { ip: d.query, timezone: d.timezone, lat: d.lat, lon: d.lon, countryCode: d.countryCode };
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    throw new Error(`代理连不上，没有打开浏览器（${err.cause?.message || err.message}）`);
  } finally {
    await dispatcher.close().catch(() => {});
  }
}

// ── 浏览器环境 ──

type Ctx = import("playwright-core").BrowserContext;

async function launch(job: Job, headless: boolean): Promise<{ ctx: Ctx; fingerprint?: Record<string, unknown> }> {
  const { Camoufox, getRandomPreset } = await import("camoufox");
  const geo = await proxyGeo(job.proxy);
  const targetOs = job.account.os === "macos" ? "macos" : "windows";
  let fingerprint: Record<string, unknown> | undefined;
  let preset = job.account.fingerprint;
  if (!preset) {
    // 第一次启动：抽一个真实设备的指纹，存回 CRM，以后一直用它
    const p = getRandomPreset(targetOs);
    if (p) {
      delete p.timezone; // 时区跟着代理走
      preset = fingerprint = p;
    }
  }
  const dir = path.join(ROOT, job.account.id);
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await Camoufox({
    persistent_context: true,
    user_data_dir: dir,
    headless,
    os: targetOs,
    proxy: job.proxy,
    ...(preset ? { fingerprint_preset: preset } : {}),
    locale: geo.countryCode,
    config: {
      timezone: geo.timezone,
      "geolocation:latitude": geo.lat,
      "geolocation:longitude": geo.lon,
      "geolocation:accuracy": 50,
      "webrtc:ipv4": geo.ip,
    },
    humanize: true,
    i_know_what_im_doing: true,
  });
  log(`  环境已启动：${job.account.name}（出口 ${geo.ip} · ${geo.timezone}）`);
  return { ctx, fingerprint };
}

async function loggedIn(ctx: Ctx, platform: MatrixPlatformInfo) {
  const cookies = await ctx.cookies();
  return platform.authCookies.some((a) =>
    cookies.some((c) => c.name === a.name && c.value && c.domain.replace(/^\./, "").endsWith(a.domain) && (c.expires === -1 || c.expires * 1000 > Date.now())),
  );
}

/** 叫人：Mac 右上角弹通知 + 提示音 */
function notify(title: string, text: string) {
  if (process.platform !== "darwin") return;
  const esc = (s: string) => s.replace(/["\\]/g, "\\$&");
  execFile("osascript", ["-e", `display notification "${esc(text)}" with title "${esc(title)}" sound name "Glass"`], () => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 任务 ──

const running = new Map<string, { canceled: boolean }>();

async function runJob(job: Job, state: { canceled: boolean }) {
  const platform = matrixPlatform(job.account.platform);
  if (!platform) return report(job.id, { status: "failed", error: `不支持的平台 ${job.account.platform}` });
  log(`▶ ${job.kind} · ${platform.label} · ${job.account.name}`);
  let ctx: Ctx | null = null;
  try {
    const launched = await launch(job, job.kind === "check");
    ctx = launched.ctx;
    const fp = launched.fingerprint ? { fingerprint: launched.fingerprint } : {};
    let closed = false;
    ctx.on("close", () => (closed = true));
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    if (job.kind === "check") {
      await page.goto(platform.homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
      await sleep(4000);
      const ok = await loggedIn(ctx, platform);
      await report(job.id, {
        status: "done",
        result: { loggedIn: ok, url: page.url() },
        account: { ...fp, status: ok ? "active" : "expired", statusNote: ok ? null : "登录已失效，需要重新登录", checked: true },
        event: ok ? "check:ok" : "check:expired",
      });
      log(`  ${ok ? "已登录" : "登录失效"}`);
      return;
    }

    if (job.kind === "open") {
      await report(job.id, { status: "running", account: fp, event: "open" });
      await page.goto(platform.homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
      await sleep(3000);
      if (!(await loggedIn(ctx, platform))) {
        await report(job.id, { account: { status: "expired", statusNote: "打开时发现没登录" } });
      }
      // 窗口开着就一直算运行中，人关掉窗口或在 CRM 点取消才结束
      while (!closed && !state.canceled) await sleep(1000);
      await report(job.id, { status: "done", event: "close" });
      log(`  环境已关闭：${job.account.name}`);
      return;
    }

    // 登录：开窗口 → 叫人 → 每 2 秒看一眼登录 Cookie
    await page.goto(platform.loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    if (!(await loggedIn(ctx, platform))) {
      await report(job.id, { status: "waiting", account: fp, event: "login:waiting" });
      notify("社媒矩阵：需要你登录", `${platform.label} · ${job.account.name}，请在弹出的浏览器窗口里扫码或输入账号密码`);
      log(`  ⏳ 等你登录：${platform.label} · ${job.account.name}（窗口已弹出，10 分钟内有效）`);
    }
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (true) {
      if (state.canceled) {
        if (stopping) await report(job.id, { status: "failed", error: "运行器退出了", account: { status: "new" } });
        log("  已取消");
        return;
      }
      if (closed) {
        await report(job.id, { status: "failed", error: "登录窗口被关掉了", account: { status: "new" }, event: "login:closed" });
        return;
      }
      if (await loggedIn(ctx, platform).catch(() => false)) break;
      if (Date.now() > deadline) {
        await report(job.id, { status: "failed", error: "10 分钟内没有完成登录", account: { status: "new" }, event: "login:timeout" });
        log("  登录超时");
        return;
      }
      await sleep(2000);
    }
    // 登录后多留几秒，让平台把剩下的 Cookie / 本地存储写完
    await sleep(5000);
    await report(job.id, {
      status: "done",
      account: { ...fp, status: "active", statusNote: null, loggedIn: true },
      event: "login:ok",
    });
    notify("社媒矩阵：登录成功", `${platform.label} · ${job.account.name}`);
    log(`  ✅ 登录成功：${platform.label} · ${job.account.name}`);
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0].slice(0, 400);
    log("  ✖", msg);
    await report(job.id, {
      status: "failed",
      error: msg,
      ...(job.kind === "login" ? { account: { status: "new" as const } } : {}),
      event: `${job.kind}:error`,
    });
  } finally {
    await ctx?.close().catch(() => {});
  }
}

// ── 主循环 ──

let stopping = false;

async function poll() {
  const { canceled, job } = await api<{ canceled: string[]; job: Job | null }>("/api/matrix/runner/poll", {
    runnerId: RUNNER_ID,
    host: HOST,
    version: VERSION,
    running: [...running.keys()],
    free: stopping ? 0 : MAX_JOBS - running.size,
  });
  for (const id of canceled) {
    const s = running.get(id);
    if (s) s.canceled = true;
  }
  if (job) {
    const state = { canceled: false };
    running.set(job.id, state);
    void runJob(job, state).finally(() => running.delete(job.id));
  }
  return !!job;
}

async function main() {
  log(`社媒矩阵运行器 ${VERSION} · ${HOST} · ${CRM_URL}`);
  log(`浏览器环境目录：${ROOT}`);
  let lastErr = "";
  while (!stopping) {
    try {
      const got = await poll();
      if (lastErr) log("已重新连上 CRM");
      lastErr = "";
      if (got) continue; // 刚领到任务，马上看看还有没有
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== lastErr) log("连不上 CRM：", msg);
      lastErr = msg;
    }
    await sleep(POLL_MS);
  }
}

async function shutdown() {
  if (stopping) process.exit(1);
  stopping = true;
  log("正在退出，关闭所有环境…");
  for (const s of running.values()) s.canceled = true;
  const until = Date.now() + 10_000;
  while (running.size && Date.now() < until) await sleep(300);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await main();
