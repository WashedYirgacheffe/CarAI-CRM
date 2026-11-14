import "server-only";
import { createHmac } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * 文件存储：配置了 OSS_BUCKET 就存阿里云 OSS，否则存本地 UPLOAD_DIR。
 * key 形如 `<tenantId>/<name>`、`<tenantId>/mail/<id>.bin`、`<tenantId>/wa/<id>.jpg`，与本地目录结构一致，
 * 所以本地文件可以原样搬到 OSS（scripts/migrate-uploads-to-oss.mts）。
 *
 * 读取一律先过系统自己的权限校验（/api/files、/api/mail/attachments、/api/whatsapp/media），
 * 再 302 到有时效的 OSS 签名链接，Bucket 本身保持私有。
 */
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "storage/uploads");

const OSS = process.env.OSS_BUCKET
  ? {
      bucket: process.env.OSS_BUCKET,
      region: process.env.OSS_REGION || "cn-hongkong",
      id: process.env.OSS_ACCESS_KEY_ID || "",
      secret: process.env.OSS_ACCESS_KEY_SECRET || "",
      prefix: (process.env.OSS_PREFIX || "").replace(/^\/+|\/+$/g, ""),
      /** 服务器读写用（同地域可填内网 oss-cn-hongkong-internal.aliyuncs.com，免流量费） */
      endpoint: process.env.OSS_ENDPOINT || `oss-${process.env.OSS_REGION || "cn-hongkong"}.aliyuncs.com`,
      /** 浏览器访问用的公网域名 */
      publicEndpoint: `oss-${process.env.OSS_REGION || "cn-hongkong"}.aliyuncs.com`,
    }
  : null;

export const ossEnabled = !!OSS;

function checkKey(key: string) {
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)+$/.test(key) || key.includes("..")) throw new Error(`bad storage key: ${key}`);
}

const fullKey = (key: string) => (OSS?.prefix ? `${OSS.prefix}/${key}` : key);
const localPath = (key: string) => path.join(UPLOAD_DIR, key);
const sign = (s: string) => createHmac("sha1", OSS!.secret).update(s).digest("base64");
const encodeKey = (k: string) => k.split("/").map(encodeURIComponent).join("/");

/** OSS 签名 V1 的请求头（服务器直连 OSS 用） */
function ossRequest(method: "PUT" | "GET", key: string, headers: Record<string, string | number> = {}) {
  const o = OSS!;
  const k = fullKey(key);
  const date = new Date().toUTCString();
  const type = String(headers["Content-Type"] ?? "");
  const auth = `OSS ${o.id}:${sign(`${method}\n\n${type}\n${date}\n/${o.bucket}/${k}`)}`;
  return {
    host: `${o.bucket}.${o.endpoint}`,
    path: `/${encodeKey(k)}`,
    method,
    headers: { ...headers, Date: date, Authorization: auth },
  };
}

function send(opts: ReturnType<typeof ossRequest>, body?: Buffer | Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const data = Buffer.concat(chunks);
        if ((res.statusCode ?? 500) >= 300) {
          const code = /<Code>([^<]+)<\/Code>/.exec(data.toString())?.[1];
          reject(Object.assign(new Error(`OSS ${opts.method} ${res.statusCode} ${code ?? ""}`.trim()), { status: res.statusCode, code }));
        } else resolve(data);
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(10 * 60_000, () => req.destroy(new Error("OSS 请求超时")));
    if (!body) req.end();
    else if (Buffer.isBuffer(body)) req.end(body);
    else {
      body.on("error", (e) => req.destroy(e));
      body.pipe(req);
    }
  });
}

/** 保存文件。body 是流时必须给出 size（OSS 需要 Content-Length） */
export async function putObject(key: string, body: Buffer | Readable, opts: { contentType: string; size?: number }) {
  checkKey(key);
  const size = Buffer.isBuffer(body) ? body.length : opts.size;
  if (OSS) {
    if (size === undefined) throw new Error("size required for stream upload");
    await send(ossRequest("PUT", key, { "Content-Type": opts.contentType, "Content-Length": size }), body);
    return;
  }
  const p = localPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  if (Buffer.isBuffer(body)) await writeFile(p, body);
  else await pipeline(body, createWriteStream(p));
}

/** 读出整个文件（发邮件时带附件等） */
export async function getObject(key: string): Promise<Buffer> {
  checkKey(key);
  if (OSS) return send(ossRequest("GET", key));
  return readFile(localPath(key));
}

const DAY = 86_400;
/** 文件存进去就不再改（文件名随机、按消息 id、头像带版本号），浏览器可以一直用缓存 */
const IMMUTABLE = "private, max-age=31536000, immutable";

/**
 * 有时效的 OSS 下载链接。过期时间取到后天 UTC 零点（有效 1～2 天），同一天内链接不变；
 * 并让 OSS 回 Cache-Control，浏览器第二次打开直接用缓存，不再连 OSS。
 */
function signedUrl(key: string, opts: { filename?: string; download?: boolean }) {
  const o = OSS!;
  const k = fullKey(key);
  const expires = (Math.floor(Date.now() / 1000 / DAY) + 2) * DAY;
  const sub: [string, string][] = [["response-cache-control", IMMUTABLE]];
  if (opts.filename || opts.download) {
    const name = opts.filename || path.basename(key);
    sub.push(["response-content-disposition", `${opts.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`]);
  }
  // Content-Type 上传时已写在对象上（OSS 不允许在这里覆盖）
  sub.sort(([a], [b]) => a.localeCompare(b));
  const resource = `/${o.bucket}/${k}${sub.length ? `?${sub.map(([a, b]) => `${a}=${b}`).join("&")}` : ""}`;
  const q = new URLSearchParams({ OSSAccessKeyId: o.id, Expires: String(expires), Signature: sign(`GET\n\n\n${expires}\n${resource}`) });
  for (const [a, b] of sub) q.set(a, b);
  return { url: `https://${o.bucket}.${o.publicEndpoint}/${encodeKey(k)}?${q}`, expires };
}

/** 服务器从 OSS 读出文件流（同地域走内网） */
function openOss(key: string): Promise<IncomingMessage> {
  const opts = ossRequest("GET", key);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(opts, (res) => {
      if ((res.statusCode ?? 500) < 300) return resolve(res);
      res.resume();
      reject(Object.assign(new Error(`OSS GET ${res.statusCode}`), { status: res.statusCode }));
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("OSS 请求超时")));
    req.end();
  });
}

/**
 * 把文件返回给浏览器（调用方已做完权限校验）：
 * - 图片：服务器直接转发。浏览器不用再跳一次、再和 OSS 建一条连接（网络差时每条新连接要几秒）
 * - 视频、语音、附件：302 到签名链接（视频可直接拖动播放，大文件不占服务器带宽）
 * - 本地模式：直接读盘返回
 * `cache` 默认长期缓存；内容可能变、地址又不带版本号的（如没带 v 的头像）传短一些的。
 */
export async function serveObject(key: string, opts: { contentType: string; filename?: string; download?: boolean; cache?: string }) {
  checkKey(key);
  const cache = opts.cache ?? IMMUTABLE;
  const disposition =
    opts.filename || opts.download
      ? `${opts.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(opts.filename || path.basename(key))}`
      : null;
  const headers: Record<string, string> = { "Content-Type": opts.contentType, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" };
  if (disposition) headers["Content-Disposition"] = disposition;

  if (OSS) {
    if (opts.contentType.startsWith("image/") && !opts.download) {
      const res = await openOss(key).catch((e: { status?: number }) => {
        if (e.status === 404) return null;
        throw e;
      });
      if (!res) return new Response("Not found", { status: 404 });
      if (res.headers["content-length"]) headers["Content-Length"] = res.headers["content-length"];
      if (res.headers["content-type"]?.startsWith("image/")) headers["Content-Type"] = res.headers["content-type"];
      return new Response(Readable.toWeb(res) as ReadableStream, { headers });
    }
    const { url, expires } = signedUrl(key, opts);
    // 跳转本身也缓存到签名过期前一小时，同一个文件第二次打开不用再问服务器
    const maxAge = opts.cache ? 0 : Math.max(0, expires - Math.floor(Date.now() / 1000) - 3600);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": maxAge ? `private, max-age=${maxAge}` : "private, no-cache" } });
  }
  const p = localPath(key);
  const info = await stat(p).catch(() => null);
  if (!info?.isFile()) return new Response("Not found", { status: 404 });
  headers["Content-Length"] = String(info.size);
  return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, { headers });
}
