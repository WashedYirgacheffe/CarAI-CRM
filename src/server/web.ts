import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * AI 联网：搜网页（DuckDuckGo 的纯 HTML 结果页，不需要密钥）和读网页（转成纯文本）。
 * 读网页只许访问公网地址，内网、本机、云厂商元数据地址一律拒绝。
 */

/** 读网页时用普通浏览器的身份 */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export type WebResult = { title: string; url: string; site: string; snippet: string };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const stripTags = (s: string) =>
  decodeEntities(s.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

/** 搜索结果的跳转链接 //duckduckgo.com/l/?uddg=<真实地址> */
function realUrl(href: string) {
  const h = decodeEntities(href);
  try {
    const u = new URL(h, "https://duckduckgo.com");
    if (u.hostname.endsWith("duckduckgo.com") && u.pathname.startsWith("/l/")) return u.searchParams.get("uddg") ?? "";
    return u.toString();
  } catch {
    return h;
  }
}

const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** 搜索引擎对「像浏览器又不执行脚本」的请求会出人机验证；用纯文本浏览器的身份拿到的是干净的 HTML 结果页 */
const SEARCH_UA = "Lynx/2.9.0 libwww-FM/2.14 SSL-MM/1.4.1";

export async function webSearch(query: string, opts: { lang?: string } = {}): Promise<WebResult[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const zh = opts.lang === "zh" || (!opts.lang && /[一-龥]/.test(q));
  const url = `https://html.duckduckgo.com/html/?${new URLSearchParams({ q, kl: zh ? "cn-zh" : "wt-wt" })}`;
  let html = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { "user-agent": SEARCH_UA, "accept-language": zh ? "zh-CN,zh;q=0.9,en;q=0.6" : "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(12_000),
    });
    // 202 是被限流后的验证页，稍等再试一次
    if (res.status === 200) {
      html = await res.text();
      break;
    }
    if (attempt) throw new Error(res.status === 202 ? "搜索服务暂时限流，请稍后再试" : `搜索服务返回 ${res.status}`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  const out: WebResult[] = [];
  for (const block of html.split(/<div class="result results_links/).slice(1)) {
    if (/result--ad/.test(block.slice(0, 200))) continue;
    const a =
      block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) ??
      block.match(/<a[^>]*href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const link = realUrl(a[1]);
    if (!/^https?:\/\//.test(link) || out.some((r) => r.url === link)) continue;
    const p = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ title: stripTags(a[2]).slice(0, 140), url: link, site: siteOf(link), snippet: p ? stripTags(p[1]).slice(0, 300) : "" });
    if (out.length >= 8) break;
  }
  return out;
}

// ── 读网页 ──

function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? privateIp(m[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // 198.18/15 是测试网段；本机开发时代理软件（fake-ip）会把所有域名解析到这里，放行
    (a === 198 && (b === 18 || b === 19) && process.env.NODE_ENV === "production") ||
    a >= 224
  );
}

async function assertPublic(u: URL) {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("只能打开 http / https 网页");
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("只能打开标准端口的网页");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("不能打开内网地址");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(privateIp)) throw new Error("不能打开内网地址");
}

/** 把 HTML 转成可读的纯文本：去掉脚本样式导航，块级元素换行 */
export function htmlToText(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1];
  let body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  body = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|table|ul|ol|blockquote|pre)>/gi, "\n")
    .replace(/<(td|th)[^>]*>/gi, " | ")
    .replace(/<li[^>]*>/gi, "- ");
  const text = decodeEntities(body.replace(/<[^>]+>/g, ""))
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { title: title ? stripTags(title) : "", description: desc ? decodeEntities(desc).trim() : "", text };
}

/** 打开公网网页拿原始 HTML（自己跟随跳转，每一跳都检查是不是公网） */
export async function fetchHtml(raw: string, timeoutMs = 15_000) {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("网址格式不对");
  }
  let res: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(u);
    res = await fetch(u, {
      redirect: "manual",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) break;
    u = new URL(loc, u);
    res = null;
  }
  if (!res) throw new Error("网页跳转太多次");
  if (!res.ok) throw new Error(`网页返回 ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/|html|xml|json/.test(type)) throw new Error(`这个网址不是网页（${type.split(";")[0] || "未知类型"}）`);
  // 最多读 2MB
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > 2_000_000) {
      await reader.cancel();
      break;
    }
  }
  const charset = type.match(/charset=([\w-]+)/i)?.[1];
  let html: string;
  try {
    html = new TextDecoder(charset || "utf-8").decode(Buffer.concat(chunks));
  } catch {
    html = new TextDecoder().decode(Buffer.concat(chunks));
  }
  return { url: u.toString(), site: siteOf(u.toString()), type, html };
}

/** 页面里的链接（绝对地址 + 链接文字），去重 */
export function pageLinks(html: string, base: string) {
  const out: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try {
      url = new URL(decodeEntities(m[1]), base).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, text: stripTags(m[2]).slice(0, 80) });
    if (out.length >= 400) break;
  }
  return out;
}

export async function readWebpage(raw: string, max = 8000) {
  const { url, site, type, html } = await fetchHtml(raw);
  const page = /html|xml/.test(type) ? htmlToText(html) : { title: "", description: "", text: html };
  const text = page.text.length > max ? `${page.text.slice(0, max)}\n…（网页太长，后面的内容已省略）` : page.text;
  return { url, site, title: page.title, description: page.description, text };
}
