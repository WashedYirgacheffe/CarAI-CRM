// 社媒矩阵运行器：在要弹浏览器窗口的电脑上跑（试点用自己的 Mac），拿企业令牌去 CRM 领任务，
// 每个账号用一个 Camoufox 持久化环境（固定指纹 + 自己的代理）。方案见 docs/social-matrix-plan.md
//
//   CRM_URL=https://crm.caraicrm.com MATRIX_RUNNER_TOKEN=mr_xxx pnpm matrix-runner
//
// 也可以把这两个变量写进项目根目录的 .env.runner。需要 Node 22.15+。
//
// 云端（Vercel Sandbox）由 CRM 按需启动，带 MATRIX_HEADLESS=1：不弹窗口，
// 把画面实时推给 CRM，人在 CRM 网页里点击、输入、扫码；空闲 MATRIX_IDLE_EXIT_MIN 分钟后自己退出、CRM 停掉 Sandbox。
import { config as loadEnv } from "dotenv";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { socksDispatcher } from "fetch-socks";
import { JOB_TIMEOUT_MS, TRANSFER_MAX_PARTS, TRANSFER_PART_BYTES, matrixPlatform, type MatrixPlatformInfo } from "@/lib/matrix";
import { sendReplies, syncInbox, watchHome, watchSupported, watchTick, type InboxThread, type Reply } from "./matrix-inbox.mjs";

loadEnv({ path: ".env.runner", quiet: true });

const VERSION = "0.5.0";
const CRM_URL = (process.env.CRM_URL || "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = process.env.MATRIX_RUNNER_TOKEN || "";
const ROOT = process.env.MATRIX_PROFILE_DIR || path.join(os.homedir(), ".cheche-crm", "matrix");
const MAX_JOBS = Math.max(1, Number(process.env.MATRIX_MAX_JOBS || 3));
const POLL_MS = 3000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;
/** 无界面：画面推给 CRM（云端运行器） */
const HEADLESS = process.env.MATRIX_HEADLESS === "1";
/** 空闲多久自己退出（0 = 不退出） */
const IDLE_EXIT_MS = Number(process.env.MATRIX_IDLE_EXIT_MIN || 0) * 60_000;
/** 桌面版（设备令牌）：开启常驻监听 */
const DEVICE = TOKEN.startsWith("md_");
/** 最多同时常驻几个账号（每个是一个无界面浏览器，约 300~500 MB 内存） */
const MAX_WATCH = Math.max(0, Number(process.env.MATRIX_MAX_WATCH ?? 5));
/**
 * 桌面版写的浏览器内核状态文件：{ ready, note }。内核还没下载好时照常报心跳（CRM 显示在线和下载进度），
 * 但不领任务、不常驻；下载好后自动开始。没有这个变量就当已经准备好。
 */
const BROWSER_STATE = process.env.MATRIX_BROWSER_STATE || "";
function browserState(): { ready: boolean; note: string } {
  if (!BROWSER_STATE) return { ready: true, note: "" };
  try {
    const s = JSON.parse(fs.readFileSync(BROWSER_STATE, "utf8")) as { ready?: boolean; note?: string };
    return { ready: !!s.ready, note: String(s.note ?? "").slice(0, 200) };
  } catch {
    return { ready: false, note: "正在准备浏览器内核…" };
  }
}
/** 账号封面：最多几分钟截一次 */
const SNAPSHOT_EVERY_MS = 15 * 60_000;

const log = (...a: unknown[]) => console.log(new Date().toLocaleTimeString(), ...a);

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 15)) {
  console.error(`Camoufox 需要 Node 22.15 以上，当前是 ${process.version}。可以用：PATH=/opt/homebrew/bin:$PATH pnpm matrix-runner`);
  process.exit(1);
}
if (!/^(mr|mrc|md)_/.test(TOKEN)) {
  console.error("缺少运行器令牌：到 CRM「社媒矩阵 → 运行器」生成，设成环境变量 MATRIX_RUNNER_TOKEN（或写进 .env.runner）");
  process.exit(1);
}

fs.mkdirSync(ROOT, { recursive: true });
const idFile = path.join(ROOT, "runner-id");
const RUNNER_ID = process.env.MATRIX_RUNNER_ID || (fs.existsSync(idFile) ? fs.readFileSync(idFile, "utf8").trim() : randomUUID());
fs.writeFileSync(idFile, RUNNER_ID);
const HOST = process.env.MATRIX_RUNNER_HOST || os.hostname().replace(/\.local$/, "");

// ── 和 CRM 通信 ──

const UNAUTHORIZED = "令牌无效（HTTP 401）";

async function api<T>(p: string, body: unknown): Promise<T> {
  const res = await fetch(`${CRM_URL}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) throw new Error(UNAUTHORIZED);
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

type Proxy = { server: string; username?: string; password?: string };
type Cookie = Parameters<Ctx["addCookies"]>[0][number];
type Job = {
  id: string;
  kind: "login" | "open" | "check" | "inbox" | "reply" | "export" | "import";
  payload?: { parts?: number; sha256?: string };
  /** 迁移环境：一次性密钥（base64，32 字节） */
  transferKey?: string;
  account: { id: string; platform: string; name: string; os: string; fingerprint: Record<string, unknown> | null; status: string };
  proxy: Proxy;
  /** 导入 Cookie 建号：启动后先写进浏览器 */
  cookies?: Cookie[];
  /** 回复任务：要发的消息 */
  replies?: Reply[];
};
type Report = {
  status?: "running" | "waiting" | "done" | "failed";
  error?: string;
  /** 运行中的进度说明 */
  progress?: string;
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

/** 进度说明（迁移环境时显示在 CRM 账号列表里） */
const progress = (jobId: string, text: string) => {
  log(`  ${text}`);
  return report(jobId, { progress: text });
};

/** 截一张账号页面当封面（失败不影响任务；force 时不管间隔） */
const snapshotAt = new Map<string, number>();
async function snapshot(accountId: string, page: Page, force = false) {
  if (!force && Date.now() - (snapshotAt.get(accountId) ?? 0) < SNAPSHOT_EVERY_MS) return;
  snapshotAt.set(accountId, Date.now());
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 50, timeout: 10_000 });
    const res = await fetch(`${CRM_URL}/api/matrix/runner/snapshot/${accountId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "image/jpeg" },
      body: new Uint8Array(buf),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) log("  封面上传失败", res.status);
  } catch (e) {
    log("  截封面失败", (e as Error).message.split("\n")[0]);
  }
}

/** 把读到的私信报给 CRM */
async function reportInbox(jobId: string, threads: InboxThread[]) {
  if (!threads.length) return 0;
  const res = await fetch(`${CRM_URL}/api/matrix/runner/jobs/${jobId}/inbox`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-runner-id": RUNNER_ID },
    body: JSON.stringify({ threads: threads.slice(0, 100).map((t) => ({ ...t, messages: t.messages.slice(-300) })) }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json().catch(() => ({}))) as { received?: number; error?: string };
  if (!res.ok) throw new Error(`上报私信失败：${data.error ?? res.status}`);
  return data.received ?? 0;
}

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

// ── 带账号密码的 SOCKS5：浏览器（Firefox 内核）不支持，本机起一个 HTTP 代理转过去 ──

/** 经 SOCKS5（用户名密码认证）连到 host:port，返回已握手好的连接 */
async function socks5Connect(proxy: URL, user: string, pass: string, host: string, port: number): Promise<net.Socket> {
  const sock = net.connect(Number(proxy.port), proxy.hostname);
  sock.setNoDelay(true);
  let buf = Buffer.alloc(0);
  let failed: Error | null = null;
  let wake: (() => void) | null = null;
  const onData = (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    wake?.();
  };
  const onFail = (e?: Error) => {
    failed ??= e ?? new Error("代理断开了连接");
    wake?.();
  };
  const onClose = () => onFail();
  sock.on("data", onData).on("error", onFail).on("close", onClose);
  const read = async (n: number) => {
    while (buf.length < n) {
      if (failed) throw failed;
      await new Promise<void>((r) => (wake = r));
      wake = null;
    }
    const out = buf.subarray(0, n);
    buf = buf.subarray(n);
    return out;
  };
  const timer = setTimeout(() => sock.destroy(new Error("代理握手超时")), 20_000);
  try {
    await new Promise<void>((resolve, reject) => {
      sock.once("connect", resolve);
      sock.once("error", reject);
    });
    sock.write(Buffer.from([5, 1, 2])); // 只用用户名密码认证
    const [ver, method] = await read(2);
    if (ver !== 5 || method !== 2) throw new Error("代理不接受用户名密码认证");
    const u = Buffer.from(user);
    const pw = Buffer.from(pass);
    sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([pw.length]), pw]));
    const [, auth] = await read(2);
    if (auth !== 0) throw new Error("代理用户名或密码不对");
    const h = Buffer.from(host);
    sock.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([port >> 8, port & 255])]));
    const head = await read(4);
    if (head[1] !== 0) throw new Error(`代理拒绝连接（代码 ${head[1]}）`);
    const alen = head[3] === 1 ? 4 : head[3] === 4 ? 16 : (await read(1))[0];
    await read(alen + 2);
  } catch (e) {
    sock.destroy();
    throw e;
  } finally {
    clearTimeout(timer);
  }
  sock.off("data", onData).off("error", onFail).off("close", onClose);
  sock.pause();
  if (buf.length) sock.unshift(buf);
  return sock;
}

/** 本机 127.0.0.1 上的 HTTP 代理（不要密码），流量经 SOCKS5 转出去 */
async function socksBridge(p: Proxy): Promise<{ server: string; close: () => void }> {
  const upstream = new URL(p.server);
  const dial = (host: string, port: number) => socks5Connect(upstream, p.username ?? "", p.password ?? "", host, port);
  const pipe = (a: net.Socket, b: net.Socket) => {
    a.on("error", () => b.destroy());
    b.on("error", () => a.destroy());
    a.pipe(b);
    b.pipe(a);
  };

  const server = http.createServer((req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    const port = Number(target.port || 80);
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const up = http.request({
      host: target.hostname,
      port,
      method: req.method,
      path: target.pathname + target.search,
      headers,
      createConnection: (_opts, cb) => {
        dial(target.hostname.replace(/^\[|\]$/g, ""), port).then(
          (s) => {
            cb(null, s);
            s.resume(); // 握手时暂停过，HTTP 客户端不会自己恢复
          },
          (e: Error) => cb(e, undefined as unknown as net.Socket),
        );
        return undefined;
      },
    });
    up.on("response", (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });

  server.on("connect", (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    let host = "";
    let port = 443;
    try {
      const t = new URL(`http://${req.url}`);
      host = t.hostname.replace(/^\[|\]$/g, "");
      port = Number(t.port || 443);
    } catch {}
    client.on("error", () => {});
    if (!host) return void client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    dial(host, port).then(
      (up) => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) up.write(head);
        pipe(client, up);
      },
      () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"),
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as net.AddressInfo;
  return {
    server: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
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
  let proxy = job.proxy;
  let bridge: Awaited<ReturnType<typeof socksBridge>> | null = null;
  if (new URL(proxy.server).protocol.startsWith("socks") && proxy.username) {
    bridge = await socksBridge(proxy);
    proxy = { server: bridge.server };
  }
  const ctx = await Camoufox({
    persistent_context: true,
    user_data_dir: dir,
    headless,
    os: targetOs,
    proxy,
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
  }).catch((e) => {
    bridge?.close();
    throw e;
  });
  if (bridge) ctx.on("close", bridge.close);
  log(`  环境已启动：${job.account.name}（出口 ${geo.ip} · ${geo.timezone}）`);
  return { ctx, fingerprint };
}

async function loggedIn(ctx: Ctx, platform: MatrixPlatformInfo) {
  const cookies = await ctx.cookies();
  const byCookie = platform.authCookies.some((a) =>
    cookies.some(
      (c) =>
        c.name === a.name &&
        c.value &&
        (!a.value || c.value === a.value) &&
        c.domain.replace(/^\./, "").endsWith(a.domain) &&
        (c.expires === -1 || c.expires * 1000 > Date.now()),
    ),
  );
  if (byCookie) return true;
  // 没有可靠登录 Cookie 的平台：停在后台地址下（没被跳去登录页）就算登录了
  const prefix = platform.loggedInUrl;
  return !!prefix && ctx.pages().some((p) => p.url().startsWith(prefix));
}

/** 导入的 Cookie 一条条写，个别格式不对的跳过 */
async function addCookies(ctx: Ctx, cookies: Cookie[]) {
  let ok = 0;
  for (const c of cookies) {
    try {
      await ctx.addCookies([c]);
      ok++;
    } catch (e) {
      log("  Cookie 写入失败", c.name, (e as Error).message.split("\n")[0]);
    }
  }
  log(`  写入 ${ok}/${cookies.length} 条 Cookie`);
  return ok;
}

/** 叫人：Mac 右上角弹通知 + 提示音 */
function notify(title: string, text: string) {
  if (process.platform !== "darwin") return;
  const esc = (s: string) => s.replace(/["\\]/g, "\\$&");
  execFile("osascript", ["-e", `display notification "${esc(text)}" with title "${esc(title)}" sound name "Glass"`], () => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ── 实时画面（无界面模式）：截图推给 CRM，顺便取回人在网页上的点击、按键 ──

type JobState = { canceled: boolean; idle?: boolean; timedOut?: boolean };
type Input =
  | { t: "click" | "dblclick"; x: number; y: number }
  | { t: "wheel"; dy: number }
  | { t: "type"; text: string }
  | { t: "key"; key: string }
  | { t: "back" }
  | { t: "resize"; w: number; h: number }
  | { t: "upload"; files: { id: string; name: string; type: string; size: number }[] };
type Page = import("playwright-core").Page;
type FileChooser = import("playwright-core").FileChooser;
type FilePayload = { name: string; mimeType: string; buffer: Buffer };

/** 下载网页上传给这个任务的文件 */
async function downloadFiles(jobId: string, files: { id: string; name: string; type: string }[]): Promise<FilePayload[]> {
  const out: FilePayload[] = [];
  for (const f of files) {
    const res = await fetch(`${CRM_URL}/api/matrix/runner/jobs/${jobId}/files/${f.id}`, {
      headers: { authorization: `Bearer ${TOKEN}`, "x-runner-id": RUNNER_ID },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`下载文件失败 HTTP ${res.status}`);
    out.push({ name: f.name, mimeType: f.type, buffer: Buffer.from(await res.arrayBuffer()) });
  }
  return out;
}

async function liveLoop(job: Job, ctx: Ctx, state: JobState, finished: () => boolean) {
  let page: Page = ctx.pages().at(-1) ?? (await ctx.newPage());
  /** 看画面的人的窗口大小（调过就套到新开的页面上） */
  let viewport: { width: number; height: number } | null = null;
  // 网页弹文件选择框：已经有上传好的文件就直接给，没有就记下来，让 CRM 提示人选文件
  // 在回调里赋值，TS 看不到，显式标注类型免得被收窄成 null
  let chooser = null as { fc: FileChooser; at: number } | null;
  let pending = null as FilePayload[] | null;
  const giveFiles = async (fc: FileChooser, files: FilePayload[]) => {
    await fc.setFiles(fc.isMultiple() ? files : files.slice(0, 1), { timeout: 30_000 });
    log(`  已上传 ${files.length} 个文件`);
  };
  const watch = (p: Page) =>
    p.on("filechooser", (fc) => {
      if (pending) {
        const files = pending;
        pending = null;
        void giveFiles(fc, files).catch((e) => log("  上传失败", (e as Error).message.split("\n")[0]));
      } else chooser = { fc, at: Date.now() };
    });
  ctx.pages().forEach(watch);
  // 弹出的新窗口（例如「用 Google 登录」）直接切过去
  ctx.on("page", (p) => {
    page = p;
    watch(p);
    if (viewport) void p.setViewportSize(viewport).catch(() => {});
    p.on("close", () => {
      if (page === p) page = ctx.pages().at(-1) ?? page;
    });
  });
  let lastHash = "";
  let lastSent = 0;
  let size = { w: 1280, h: 800, at: 0 };
  while (!finished() && !state.canceled) {
    let frame: Buffer | null = null;
    // 选择框 3 分钟没人管就算了
    if (chooser && (Date.now() - chooser.at > 180_000 || chooser.fc.page().isClosed())) chooser = null;
    try {
      if (Date.now() - size.at > 2000) {
        const vp = page.viewportSize();
        const [w, h] = vp ? [vp.width, vp.height] : await page.evaluate(() => [window.innerWidth, window.innerHeight]);
        size = { w, h, at: Date.now() };
      }
      const buf = await page.screenshot({ type: "jpeg", quality: 55, timeout: 5000 });
      const hash = createHash("md5").update(buf).digest("hex");
      // 画面没变就不重复传，最多 5 秒补一帧
      if (hash !== lastHash || Date.now() - lastSent > 5000) {
        frame = buf;
        lastHash = hash;
        lastSent = Date.now();
      }
    } catch {
      // 页面正在跳转，下一轮再截
    }
    let inputs: Input[] = [];
    try {
      const res = await fetch(`${CRM_URL}/api/matrix/runner/jobs/${job.id}/frame`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "x-runner-id": RUNNER_ID,
          "x-page-url": encodeURIComponent(page.url()),
          "x-page-size": `${size.w}x${size.h}`,
          "x-file-chooser": chooser ? "1" : "0",
          "content-type": "image/jpeg",
        },
        body: frame ? new Uint8Array(frame) : new Uint8Array(),
        signal: AbortSignal.timeout(10_000),
      });
      const d = (await res.json().catch(() => ({}))) as { inputs?: Input[]; canceled?: boolean; idle?: boolean };
      if (d.canceled) state.canceled = true;
      if (d.idle) state.idle = true;
      inputs = d.inputs ?? [];
    } catch {
      // CRM 暂时连不上，继续
    }
    for (const ev of inputs) {
      try {
        if (ev.t === "click") await page.mouse.click(ev.x * size.w, ev.y * size.h);
        else if (ev.t === "dblclick") await page.mouse.dblclick(ev.x * size.w, ev.y * size.h);
        else if (ev.t === "wheel") await page.mouse.wheel(0, ev.dy);
        else if (ev.t === "type") await page.keyboard.type(ev.text, { delay: 35 });
        else if (ev.t === "key") await page.keyboard.press(ev.key);
        else if (ev.t === "back") await page.goBack({ timeout: 15_000 }).catch(() => {});
        else if (ev.t === "resize") {
          // 不超过指纹里的屏幕大小
          const [sw, sh] = await page.evaluate(() => [screen.availWidth || 1920, screen.availHeight || 1080]);
          viewport = { width: Math.min(ev.w, sw), height: Math.min(ev.h, sh) };
          await page.setViewportSize(viewport);
          size = { w: viewport.width, h: viewport.height, at: Date.now() };
          lastHash = ""; // 马上推一帧新尺寸的
        } else if (ev.t === "upload") {
          const files = await downloadFiles(job.id, ev.files);
          if (chooser) {
            const fc = chooser.fc;
            chooser = null;
            await giveFiles(fc, files);
          } else {
            pending = files;
            log(`  收到 ${files.length} 个文件，等网页弹出选择框`);
          }
        }
      } catch (e) {
        log("  操作失败", ev.t, (e as Error).message.split("\n")[0]);
      }
    }
    await sleep(inputs.length ? 80 : 300);
  }
}

// ── 任务 ──

const running = new Map<string, JobState>();

async function runJob(job: Job, state: JobState) {
  const platform = matrixPlatform(job.account.platform);
  if (!platform) return report(job.id, { status: "failed", error: `不支持的平台 ${job.account.platform}` });
  log(`▶ ${job.kind} · ${platform.label} · ${job.account.name}`);
  const accId = job.account.id;
  const w = watchers.get(accId);
  // 常驻着的账号：收私信、发私信、检查登录直接在常驻页面上做，不另开浏览器
  if (w?.ready && (job.kind === "inbox" || job.kind === "reply" || job.kind === "check")) return runOnWatcher(job, w, platform);
  // 其它任务要独占环境目录（同一个目录不能被两个浏览器同时打开）：先停掉常驻，任务完了常驻会自己恢复
  busyAccounts.add(accId);
  try {
    if (w) {
      log("  先暂停常驻监听");
      await stopWatcher(w);
    }
    return await runJobExclusive(job, state, platform);
  } finally {
    busyAccounts.delete(accId);
  }
}

async function runJobExclusive(job: Job, state: JobState, platform: MatrixPlatformInfo) {
  let ctx: Ctx | null = null;
  let finished = false;
  /** 迁入：环境已经解开放好（之后出错不用重新登录） */
  let extracted = false;
  let live: Promise<void> | null = null;
  // 看门狗：任务超过时限就关掉浏览器（CRM 那边也会把任务标成超时）
  const limit = (JOB_TIMEOUT_MS[job.kind] ?? JOB_TIMEOUT_MS.login) - 30_000;
  const watchdog = setTimeout(() => {
    state.timedOut = true;
    state.canceled = true;
    log(`  任务超时（${Math.round(limit / 60_000)} 分钟），关闭环境`);
    void ctx?.close().catch(() => {});
  }, limit);
  try {
    if (job.kind === "export") {
      await report(job.id, { event: "export:start" });
      const result = await exportEnv(job, state);
      await report(job.id, { status: "done", result, event: "export:ok" });
      log(`  ✅ 环境已迁出：${job.account.name}`);
      return;
    }
    if (job.kind === "import") {
      await importEnv(job, state);
      extracted = true;
    }
    const background = job.kind === "check" || job.kind === "inbox" || job.kind === "reply" || job.kind === "import";
    const launched = await launch(job, background || HEADLESS);
    ctx = launched.ctx;
    if (job.cookies?.length) await addCookies(ctx, job.cookies);
    const fp = launched.fingerprint ? { fingerprint: launched.fingerprint } : {};
    let closed = false;
    ctx.on("close", () => (closed = true));
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    if (HEADLESS && !background) live = liveLoop(job, ctx, state, () => finished);

    // 同步私信 / 发私信：先看还在不在登录
    if (job.kind === "inbox" || job.kind === "reply") {
      await page.goto(platform.homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
      await sleep(3000);
      if (!(await loggedIn(ctx, platform))) {
        await report(job.id, {
          status: "failed",
          error: "账号登录已失效",
          account: { ...fp, status: "expired", statusNote: "同步私信时发现登录已失效，需要重新登录", checked: true },
          event: `${job.kind}:expired`,
        });
        log("  登录失效");
        return;
      }
      const dir = path.join(ROOT, job.account.id);
      if (job.kind === "inbox") {
        const threads = await syncInbox(ctx, page, job.account.platform, dir, log);
        if (!threads) {
          await report(job.id, { status: "failed", error: `${platform.label} 还不支持收私信`, account: fp });
          return;
        }
        const received = await reportInbox(job.id, threads);
        await snapshot(job.account.id, page);
        await report(job.id, { status: "done", result: { threads: threads.length, received }, account: { ...fp, checked: true }, event: "inbox:ok" });
        log(`  同步了 ${threads.length} 个会话，新消息 ${received} 条`);
        return;
      }
      const { results, threads } = await sendReplies(page, job.account.platform, job.replies ?? [], log);
      await reportInbox(job.id, threads).catch((e) => log("  ", (e as Error).message));
      const failed = results.filter((r) => !r.ok).length;
      await report(job.id, {
        status: "done",
        result: { replies: results },
        account: { ...fp, checked: true },
        event: failed ? `reply:failed ${failed}/${results.length}` : "reply:ok",
      });
      return;
    }

    // 迁入：解开后打开一次，确认登录状态还在
    if (job.kind === "import") {
      await page.goto(platform.homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
      await sleep(4000);
      await progress(job.id, "迁入：确认登录状态…");
      const ok = await stillLoggedIn(ctx, platform);
      await snapshot(job.account.id, page, true);
      await report(job.id, {
        status: "done",
        result: { loggedIn: ok, url: page.url() },
        account: { ...fp, status: ok ? "active" : "new", statusNote: ok ? null : "迁过来的登录状态失效了，需要重新登录", checked: true },
        event: ok ? "import:ok" : "import:expired",
      });
      log(`  ${ok ? "✅ 迁入完成，登录状态正常" : "迁入完成，但登录状态失效了"}`);
      return;
    }

    if (job.kind === "check") {
      await page.goto(platform.homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
      await sleep(4000);
      const ok = await loggedIn(ctx, platform);
      await snapshot(job.account.id, page, true);
      const imported = !!job.cookies?.length;
      await report(job.id, {
        status: "done",
        result: { loggedIn: ok, url: page.url(), ...(imported ? { cookieImport: true } : {}) },
        account: {
          ...fp,
          status: ok ? "active" : imported && job.account.status !== "active" ? "new" : "expired",
          statusNote: ok ? null : imported ? "导入的 Cookie 无效或已过期" : "登录已失效，需要重新登录",
          checked: true,
          ...(ok && imported ? { loggedIn: true } : {}),
        },
        event: ok ? (imported ? "cookie:ok" : "check:ok") : imported ? "cookie:invalid" : "check:expired",
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
      await snapshot(job.account.id, page, true);
      // 窗口开着就一直算运行中，人关掉窗口或在 CRM 点取消才结束；云端没人看画面也结束
      while (!closed && !state.canceled && !state.idle) await sleep(1000);
      await report(job.id, { status: "done", event: "close" });
      log(`  环境已关闭：${job.account.name}`);
      return;
    }

    // 登录：开窗口 → 叫人 → 每 2 秒看一眼登录 Cookie
    await page.goto(platform.loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    if (!(await loggedIn(ctx, platform))) {
      await report(job.id, { status: "waiting", account: fp, event: "login:waiting" });
      if (!HEADLESS) notify("社媒矩阵：需要你登录", `${platform.label} · ${job.account.name}，请在弹出的浏览器窗口里扫码或输入账号密码`);
      log(`  ⏳ 等你登录：${platform.label} · ${job.account.name}（${HEADLESS ? "在 CRM 里点「画面」操作" : "窗口已弹出"}，10 分钟内有效）`);
    }
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (true) {
      if (state.canceled) {
        if (state.timedOut) await report(job.id, { status: "failed", error: "任务超时", account: { status: "new" }, event: "login:timeout" });
        else if (stopping) await report(job.id, { status: "failed", error: "运行器退出了", account: { status: "new" } });
        log("  已取消");
        return;
      }
      if (closed) {
        await report(job.id, { status: "failed", error: "登录窗口被关掉了", account: { status: "new" }, event: "login:closed" });
        return;
      }
      if (state.idle) {
        await report(job.id, { status: "failed", error: "登录画面没人看，已结束", account: { status: "new" }, event: "login:idle" });
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
    await snapshot(job.account.id, page, true);
    await report(job.id, {
      status: "done",
      account: { ...fp, status: "active", statusNote: null, loggedIn: true },
      event: "login:ok",
    });
    notify("社媒矩阵：登录成功", `${platform.label} · ${job.account.name}`);
    log(`  ✅ 登录成功：${platform.label} · ${job.account.name}`);
  } catch (e) {
    const msg = state.timedOut ? "任务超时" : (e as Error).message.split("\n")[0].slice(0, 400);
    log("  ✖", msg);
    await report(job.id, {
      status: "failed",
      error: msg,
      ...(job.kind === "login" ? { account: { status: "new" as const } } : {}),
      ...(extracted ? { result: { extracted: true } } : {}),
      event: `${job.kind}:error`,
    });
  } finally {
    clearTimeout(watchdog);
    finished = true;
    await live?.catch(() => {});
    await ctx?.close().catch(() => {});
  }
}

// ── 迁移浏览器环境：打包 → AES-256-GCM 加密 → 分块传给 CRM（存 OSS）；迁入反过来 ──

/** 缓存、崩溃报告、锁文件不带（体积大、换台电脑没用） */
const ENV_EXCLUDES = [
  "cache2", "startupCache", "thumbnails", "shader-cache", "jumpListCache", "crashes", "minidumps",
  "datareporting", "saved-telemetry-pings", "safebrowsing", "lock", ".parentlock", "parent.lock", "*.tmp",
];

function tar(args: string[]) {
  return new Promise<void>((resolve, reject) =>
    execFile("tar", args, { maxBuffer: 16 * 1024 * 1024 }, (e, _o, err) => (e ? reject(new Error(`打包失败：${(err || e.message).trim().slice(0, 200)}`)) : resolve())),
  );
}

const bundleUrl = (jobId: string, part: number) => `${CRM_URL}/api/matrix/runner/jobs/${jobId}/bundle?part=${part}`;
const runnerHeaders = { authorization: `Bearer ${TOKEN}`, "x-runner-id": RUNNER_ID };

async function exportEnv(job: Job, state: JobState) {
  const dir = path.join(ROOT, job.account.id);
  if (!job.transferKey) throw new Error("缺少迁移密钥");
  if (!fs.existsSync(dir)) throw new Error("这里没有这个账号的浏览器环境");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-env-"));
  try {
    const tgz = path.join(tmp, "env.tgz");
    await progress(job.id, "迁出：打包浏览器环境…");
    await tar(["-czf", tgz, ...ENV_EXCLUDES.flatMap((e) => ["--exclude", e]), "-C", dir, "."]);
    const plain = fs.readFileSync(tgz);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", Buffer.from(job.transferKey, "base64"), iv);
    const enc = Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]);
    const parts = Math.ceil(enc.length / TRANSFER_PART_BYTES);
    if (parts > TRANSFER_MAX_PARTS) throw new Error(`浏览器环境太大（${Math.round(enc.length / 1048576)} MB）`);
    log(`  环境打包好了：${Math.round(enc.length / 1048576)} MB，分 ${parts} 块上传`);
    for (let i = 0; i < parts; i++) {
      if (state.canceled) throw new Error("已取消");
      await progress(job.id, `迁出：上传 ${i + 1}/${parts} 块（共 ${Math.max(1, Math.round(enc.length / 1048576))} MB）`);
      const body = enc.subarray(i * TRANSFER_PART_BYTES, (i + 1) * TRANSFER_PART_BYTES);
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(bundleUrl(job.id, i), {
          method: "PUT",
          headers: { ...runnerHeaders, "content-type": "application/octet-stream" },
          body: new Uint8Array(body),
          signal: AbortSignal.timeout(5 * 60_000),
        }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }) as const);
        if (res.ok) break;
        if (attempt >= 3) throw new Error(`上传第 ${i + 1} 块失败（${res.status || res.statusText}）`);
        await sleep(3000 * attempt);
      }
    }
    return { parts, size: enc.length, sha256: createHash("sha256").update(enc).digest("hex") };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function importEnv(job: Job, state: JobState) {
  const dir = path.join(ROOT, job.account.id);
  const parts = job.payload?.parts ?? 0;
  if (!job.transferKey || !parts || !job.payload?.sha256) throw new Error("迁移信息不完整");
  const chunks: Buffer[] = [];
  for (let i = 0; i < parts; i++) {
    if (state.canceled) throw new Error("已取消");
    await progress(job.id, `迁入：下载 ${i + 1}/${parts} 块`);
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(bundleUrl(job.id, i), { headers: runnerHeaders, signal: AbortSignal.timeout(5 * 60_000) }).catch(() => null);
      if (res?.ok) {
        chunks.push(Buffer.from(await res.arrayBuffer()));
        break;
      }
      if (attempt >= 3) throw new Error(`下载第 ${i + 1} 块失败（${res?.status ?? "连不上"}）`);
      await sleep(3000 * attempt);
    }
  }
  const enc = Buffer.concat(chunks);
  await progress(job.id, "迁入：校验、解密、解开…");
  if (createHash("sha256").update(enc).digest("hex") !== job.payload.sha256) throw new Error("压缩包校验不通过");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(job.transferKey, "base64"), enc.subarray(0, 12));
  d.setAuthTag(enc.subarray(enc.length - 16));
  const plain = Buffer.concat([d.update(enc.subarray(12, enc.length - 16)), d.final()]);
  const tmp = fs.mkdtempSync(path.join(ROOT, `.import-${job.account.id}-`));
  try {
    fs.writeFileSync(path.join(tmp, "env.tgz"), plain);
    const out = path.join(tmp, "env");
    fs.mkdirSync(out);
    await tar(["-xzf", path.join(tmp, "env.tgz"), "-C", out]);
    // 原来有旧环境就挪开，新的放好再删旧的
    const old = `${dir}.old-${Date.now()}`;
    if (fs.existsSync(dir)) fs.renameSync(dir, old);
    fs.renameSync(out, dir);
    fs.rmSync(old, { recursive: true, force: true });
    log(`  环境已迁入：${Math.round(plain.length / 1048576)} MB`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 常驻监听（桌面版）：账号的无界面浏览器一直停在私信页，几秒看一眼会话列表 ──

type WatchAccount = Job["account"] & { proxy: Proxy };
type Watcher = {
  acc: WatchAccount;
  ctx: Ctx | null;
  page: Page | null;
  /** 已登录、页面就绪 */
  ready: boolean;
  stop: boolean;
  /** 同一个页面一次只做一件事（监听一轮 / 发私信） */
  lock: <T>(fn: () => Promise<T>) => Promise<T>;
  done: Promise<void>;
};
const watchers = new Map<string, Watcher>();
/** 正在跑独占任务的账号（这期间不常驻） */
const busyAccounts = new Set<string>();
/** 常驻连续出错的账号：过一会儿再试 */
const watchBackoff = new Map<string, number>();
const EXPIRED = "常驻时发现登录已失效，需要重新登录";

function mutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(fn: () => Promise<T>) => {
    const r = tail.then(fn);
    tail = r.catch(() => {});
    return r;
  };
}

const watchReport = (id: string, body: { threads?: InboxThread[]; expired?: string; fingerprint?: Record<string, unknown> }) =>
  api<{ ok: boolean; received?: number }>(`/api/matrix/runner/watch/${id}`, {
    ...body,
    ...(body.threads ? { threads: body.threads.slice(0, 100).map((t) => ({ ...t, messages: t.messages.slice(-300) })) } : {}),
  });

/** 可以随时被 stop 打断的等待 */
async function nap(ms: number, w: Watcher) {
  const until = Date.now() + ms;
  while (!w.stop && !stopping && Date.now() < until) await sleep(Math.min(500, until - Date.now()));
}

async function stillLoggedIn(ctx: Ctx, platform: MatrixPlatformInfo) {
  if (await loggedIn(ctx, platform).catch(() => false)) return true;
  await sleep(5000); // Cookie 偶尔刷新慢一拍，再看一次
  return loggedIn(ctx, platform).catch(() => false);
}

async function watchLoop(w: Watcher) {
  const { acc } = w;
  const platform = matrixPlatform(acc.platform)!;
  const dir = path.join(ROOT, acc.id);
  const job = { id: "watch", kind: "inbox", account: acc, proxy: acc.proxy } as Job;
  let fails = 0;
  try {
    const l = await launch(job, true);
    w.ctx = l.ctx;
    l.ctx.on("close", () => (w.stop = true));
    if (w.stop) return;
    if (l.fingerprint) {
      acc.fingerprint = l.fingerprint;
      await watchReport(acc.id, { fingerprint: l.fingerprint }).catch(() => {});
    }
    const page = l.ctx.pages()[0] ?? (await l.ctx.newPage());
    w.page = page;
    await page.goto(platform.homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await sleep(3000);
    if (!(await stillLoggedIn(l.ctx, platform))) {
      await watchReport(acc.id, { expired: EXPIRED }).catch(() => {});
      log(`  常驻：${acc.name} 登录已失效`);
      return;
    }
    await watchHome(page, acc.platform);
    w.ready = true;
    log(`👂 开始实时收私信：${platform.label} · ${acc.name}`);
    await snapshot(acc.id, page, true);
    let deepAt = Date.now();
    let reloadAt = Date.now() + rand(30, 60) * 60_000;
    while (!w.stop && !stopping) {
      try {
        const threads = await w.lock(async () => {
          if (Date.now() > reloadAt) {
            // 页面开久了会越来越占内存，也可能漏推送：隔一阵刷新一次，顺便确认还登录着
            reloadAt = Date.now() + rand(30, 60) * 60_000;
            await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
            await sleep(3000);
            if (!(await stillLoggedIn(l.ctx, platform))) throw new Error(EXPIRED);
          }
          const deep = Date.now() - deepAt > 5 * 60_000;
          if (deep) deepAt = Date.now();
          return watchTick(page, acc.platform, dir, log, { deep });
        });
        fails = 0;
        await w.lock(() => snapshot(acc.id, page));
        // 报一次心跳也让 CRM 知道还在常驻（没新消息时由 refreshWatch 统一报）
        if (threads.length) {
          const r = await watchReport(acc.id, { threads });
          log(`  ${acc.name}：${threads.length} 个会话有新内容，新消息 ${r.received ?? 0} 条`);
        }
      } catch (e) {
        const msg = (e as Error).message.split("\n")[0];
        if (msg === EXPIRED) {
          await watchReport(acc.id, { expired: EXPIRED }).catch(() => {});
          log(`  常驻：${acc.name} 登录已失效`);
          return;
        }
        if (w.stop || stopping) break;
        fails++;
        log(`  常驻出错（${fails}/5）：${acc.name}`, msg);
        if (fails >= 5) {
          log(`  ${acc.name} 连续出错，10 分钟后再试`);
          watchBackoff.set(acc.id, Date.now() + 10 * 60_000);
          return;
        }
        await w.lock(() => watchHome(page, acc.platform)).catch(() => {});
      }
      await nap(rand(5000, 10_000), w);
    }
  } catch (e) {
    log(`  常驻启动失败：${acc.name}`, (e as Error).message.split("\n")[0]);
    watchBackoff.set(acc.id, Date.now() + 10 * 60_000);
  } finally {
    w.ready = false;
    await w.ctx?.close().catch(() => {});
    watchers.delete(acc.id);
    if (!stopping) log(`  停止常驻：${acc.name}`);
    watchStatus();
  }
}

function startWatcher(acc: WatchAccount) {
  const w = { acc, ctx: null, page: null, ready: false, stop: false, lock: mutex() } as unknown as Watcher;
  watchers.set(acc.id, w);
  w.done = watchLoop(w);
}

async function stopWatcher(w: Watcher) {
  w.stop = true;
  await w.done.catch(() => {});
}

/** 在常驻页面上跑任务（收私信 / 发私信 / 检查登录） */
async function runOnWatcher(job: Job, w: Watcher, platform: MatrixPlatformInfo) {
  const ctx = w.ctx!;
  const page = w.page!;
  const dir = path.join(ROOT, job.account.id);
  log("  在常驻页面上执行");
  try {
    await w.lock(async () => {
      const ok = await stillLoggedIn(ctx, platform);
      if (job.kind === "check" || !ok) {
        await report(job.id, {
          status: ok ? "done" : "failed",
          ...(ok ? { result: { loggedIn: true, url: page.url() } } : { error: "账号登录已失效" }),
          account: ok ? { status: "active", statusNote: null, checked: true } : { status: "expired", statusNote: EXPIRED, checked: true },
          event: ok ? "check:ok" : `${job.kind}:expired`,
        });
        if (!ok) w.stop = true;
        return;
      }
      try {
        if (job.kind === "inbox") {
          const threads = (await syncInbox(ctx, page, job.account.platform, dir, log)) ?? [];
          const received = await reportInbox(job.id, threads);
          await report(job.id, { status: "done", result: { threads: threads.length, received }, account: { checked: true }, event: "inbox:ok" });
          log(`  同步了 ${threads.length} 个会话，新消息 ${received} 条`);
        } else {
          const { results, threads } = await sendReplies(page, job.account.platform, job.replies ?? [], log);
          await reportInbox(job.id, threads).catch((e) => log("  ", (e as Error).message));
          const failed = results.filter((r) => !r.ok).length;
          await report(job.id, {
            status: "done",
            result: { replies: results },
            account: { checked: true },
            event: failed ? `reply:failed ${failed}/${results.length}` : "reply:ok",
          });
        }
      } finally {
        await watchHome(page, job.account.platform).catch(() => {});
      }
    });
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0].slice(0, 400);
    log("  ✖", msg);
    await report(job.id, { status: "failed", error: msg, event: `${job.kind}:error` });
  }
}

let lastStatus = "";
/** 给桌面外壳看的一行状态（菜单栏显示几个账号在实时收私信） */
function watchStatus() {
  const names = [...watchers.values()].filter((w) => w.ready).map((w) => w.acc.name);
  const line = `@@watch ${names.length} ${names.join("、")}`;
  if (line !== lastStatus) console.log((lastStatus = line));
}

/** 每 30 秒：报心跳，取回该常驻的账号，启停监听 */
async function refreshWatch() {
  if (!browserState().ready) return;
  const ready = [...watchers.values()].filter((w) => w.ready).map((w) => w.acc.id);
  const { accounts } = await api<{ accounts: WatchAccount[] }>("/api/matrix/runner/watch", { watching: ready });
  const want = new Map(accounts.filter((a) => watchSupported(a.platform)).map((a) => [a.id, a]));
  for (const [id, w] of watchers) if (!want.has(id) && !w.stop) void stopWatcher(w);
  for (const a of want.values()) {
    if (watchers.size >= MAX_WATCH) break;
    if (watchers.has(a.id) || busyAccounts.has(a.id) || (watchBackoff.get(a.id) ?? 0) > Date.now()) continue;
    startWatcher(a);
  }
  watchStatus();
}

async function watchMain() {
  let lastErr = "";
  while (!stopping) {
    try {
      await refreshWatch();
      lastErr = "";
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== lastErr && msg !== UNAUTHORIZED) log("常驻监听刷新失败：", msg);
      lastErr = msg;
    }
    for (let i = 0; i < 60 && !stopping; i++) await sleep(500);
  }
}

// ── 主循环 ──

let stopping = false;

async function poll() {
  const browser = browserState();
  const { canceled, job } = await api<{ canceled: string[]; job: Job | null }>("/api/matrix/runner/poll", {
    runnerId: RUNNER_ID,
    host: HOST,
    version: VERSION,
    running: [...running.keys()],
    free: stopping || !browser.ready ? 0 : MAX_JOBS - running.size,
    ...(browser.note ? { note: browser.note } : {}),
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
  if (DEVICE && MAX_WATCH) void watchMain();
  let lastErr = "";
  let busyAt = Date.now();
  while (!stopping) {
    if (running.size) busyAt = Date.now();
    if (IDLE_EXIT_MS && !running.size && Date.now() - busyAt > IDLE_EXIT_MS) {
      const r = await api<{ stay?: boolean }>("/api/matrix/runner/idle", { runnerId: RUNNER_ID }).catch(() => ({ stay: false }));
      if (r.stay) busyAt = Date.now();
      else {
        log("空闲太久，退出");
        process.exit(0);
      }
    }
    try {
      const got = await poll();
      if (lastErr) log("已重新连上 CRM");
      lastErr = "";
      if (got) continue; // 刚领到任务，马上看看还有没有
    } catch (e) {
      const msg = (e as Error).message;
      // 令牌失效（设备被移除、企业令牌重新生成）：退出码 3，桌面版据此重新配对，不再重试
      if (msg === UNAUTHORIZED) {
        log("运行器令牌已失效，退出");
        process.exit(3);
      }
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
  for (const w of watchers.values()) w.stop = true;
  const until = Date.now() + 10_000;
  while ((running.size || watchers.size) && Date.now() < until) await sleep(300);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// 浏览器关掉时 Playwright 偶尔会有没接住的 Promise，记一笔就行；真正的崩溃退出码 1，云端会自动重启
process.on("unhandledRejection", (e) => log("未处理的异常", e instanceof Error ? e.message.split("\n")[0] : e));
process.on("uncaughtException", (e) => {
  log("运行器崩溃：", e.stack ?? e.message);
  process.exit(1);
});

await main();
