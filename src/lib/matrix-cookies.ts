/*
 * 导入 Cookie 建号：把用户粘贴 / 上传的 Cookie 转成浏览器（Playwright）能直接写入的格式。
 * 支持三种常见格式：
 *   1. JSON 数组（Cookie-Editor、EditThisCookie 等浏览器插件导出的）
 *   2. Netscape cookies.txt（制表符分隔，7 列）
 *   3. 请求头写法 name=value; name2=value2（没有域名，用平台的主域名）
 */
import type { MatrixPlatformInfo } from "@/lib/matrix";

export type BrowserCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

const sameSiteOf = (v: unknown): BrowserCookie["sameSite"] => {
  const s = String(v ?? "").toLowerCase();
  if (s === "strict") return "Strict";
  if (s === "none" || s === "no_restriction") return "None";
  return "Lax";
};

function fromJson(raw: unknown[], fallbackDomain: string): BrowserCookie[] {
  const out: BrowserCookie[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const c = r as Record<string, unknown>;
    const name = String(c.name ?? "").trim();
    if (!name) continue;
    const exp = Number(c.expirationDate ?? c.expires ?? c.expiry ?? -1);
    const sameSite = sameSiteOf(c.sameSite);
    out.push({
      name,
      value: String(c.value ?? ""),
      domain: String(c.domain ?? c.host ?? fallbackDomain) || fallbackDomain,
      path: String(c.path ?? "/") || "/",
      expires: Number.isFinite(exp) && exp > 0 ? Math.floor(exp > 1e11 ? exp / 1000 : exp) : -1,
      httpOnly: Boolean(c.httpOnly),
      // SameSite=None 的 Cookie 必须是 secure
      secure: Boolean(c.secure) || sameSite === "None",
      sameSite,
    });
  }
  return out;
}

function fromNetscape(text: string): BrowserCookie[] {
  const out: BrowserCookie[] = [];
  for (let line of text.split(/\r?\n/)) {
    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) {
      httpOnly = true;
      line = line.slice("#HttpOnly_".length);
    }
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 7) continue;
    const exp = Number(f[4]);
    out.push({
      domain: f[0],
      path: f[2] || "/",
      secure: f[3].toUpperCase() === "TRUE",
      expires: exp > 0 ? exp : -1,
      name: f[5],
      value: f.slice(6).join("\t"),
      httpOnly,
      sameSite: "Lax",
    });
  }
  return out;
}

function fromHeader(text: string, domain: string): BrowserCookie[] {
  const out: BrowserCookie[] = [];
  for (const part of text.replace(/^cookie:\s*/i, "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    out.push({
      name,
      value: part.slice(i + 1).trim(),
      domain: `.${domain}`,
      path: "/",
      // 没有过期时间的给一年
      expires: Math.floor(Date.now() / 1000) + 365 * 86_400,
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    });
  }
  return out;
}

/** 平台的主域名：取登录判断 Cookie 的第一个域名，没有就取首页域名 */
export function platformDomain(p: MatrixPlatformInfo) {
  return p.authCookies[0]?.domain ?? new URL(p.homeUrl).hostname.replace(/^www\./, "");
}

const belongs = (cookieDomain: string, d: string) => {
  const c = cookieDomain.replace(/^\./, "").toLowerCase();
  return c === d || c.endsWith(`.${d}`);
};

/**
 * 解析 Cookie 文本。只留这个平台相关域名下的 Cookie（别的网站的不带进去）。
 * 返回错误说明（没有登录凭证、格式认不出来）或者 Cookie 列表。
 */
export function parseCookies(text: string, platform: MatrixPlatformInfo): { ok: true; cookies: BrowserCookie[] } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) return { ok: false, error: "Cookie 是空的" };
  const domain = platformDomain(platform);
  let all: BrowserCookie[] = [];
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as unknown;
      const arr = Array.isArray(j) ? j : Array.isArray((j as { cookies?: unknown[] }).cookies) ? (j as { cookies: unknown[] }).cookies : [j];
      all = fromJson(arr, `.${domain}`);
    } catch {
      return { ok: false, error: "JSON 格式不对" };
    }
  } else if (t.includes("\t")) {
    all = fromNetscape(t);
  } else {
    all = fromHeader(t, domain);
  }
  if (!all.length) return { ok: false, error: "没认出 Cookie，支持 JSON、cookies.txt、name=value; 三种格式" };

  const domains = new Set([domain, ...platform.authCookies.map((a) => a.domain), new URL(platform.homeUrl).hostname.replace(/^www\./, "")]);
  const cookies = all.filter((c) => [...domains].some((d) => belongs(c.domain, d)));
  if (!cookies.length) return { ok: false, error: `Cookie 里没有 ${platform.label} 的（${[...domains].join("、")}）` };

  if (platform.authCookies.length) {
    const now = Date.now() / 1000;
    const has = platform.authCookies.some((a) =>
      cookies.some((c) => c.name === a.name && c.value && (!a.value || c.value === a.value) && belongs(c.domain, a.domain) && (c.expires === -1 || c.expires > now)),
    );
    if (!has) return { ok: false, error: `Cookie 里没有有效的登录凭证（${platform.authCookies.map((a) => a.name).join(" / ")}），可能已过期或没登录时导出的` };
  }
  return { ok: true, cookies: cookies.slice(0, 300) };
}
