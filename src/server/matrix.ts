import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { socksDispatcher } from "fetch-socks";
import { prisma } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { decryptSecret } from "@/server/crypto";
import { RUNNER_STALE_MS } from "@/lib/matrix";

type ProxyRow = {
  id: string;
  protocol: string;
  host: string;
  port: number;
  username: string | null;
  passwordEnc: string | null;
};

export function proxyPassword(p: ProxyRow) {
  if (!p.passwordEnc) return null;
  try {
    return decryptSecret(p.passwordEnc);
  } catch {
    return null;
  }
}

/** Playwright / Camoufox 的代理格式 */
export function playwrightProxy(p: ProxyRow) {
  const scheme = p.protocol === "socks5" ? "socks5" : p.protocol === "https" ? "https" : "http";
  return {
    server: `${scheme}://${p.host}:${p.port}`,
    ...(p.username ? { username: p.username, password: proxyPassword(p) ?? "" } : {}),
  };
}

function dispatcherOf(p: ProxyRow): Dispatcher {
  const password = proxyPassword(p);
  if (p.protocol === "socks5") {
    return socksDispatcher({
      type: 5,
      host: p.host,
      port: p.port,
      ...(p.username ? { userId: p.username, password: password ?? "" } : {}),
    });
  }
  const scheme = p.protocol === "https" ? "https" : "http";
  return new ProxyAgent({
    uri: `${scheme}://${p.host}:${p.port}`,
    ...(p.username ? { token: `Basic ${Buffer.from(`${p.username}:${password ?? ""}`).toString("base64")}` } : {}),
  });
}

type IpInfo = {
  status: string;
  message?: string;
  query: string;
  country: string;
  countryCode: string;
  regionName: string;
  city: string;
  timezone: string;
  isp: string;
  hosting: boolean;
  proxy: boolean;
};

/** 通过代理访问 IP 查询服务，拿出口 IP、国家、时区；结果写回代理 */
export async function checkProxy(id: string) {
  const p = await prisma.matrixProxy.findUnique({ where: { id } });
  if (!p) throw new Error("代理不存在");
  const started = Date.now();
  const dispatcher = dispatcherOf(p);
  try {
    const res = await undiciFetch(
      "http://ip-api.com/json/?fields=status,message,query,country,countryCode,regionName,city,timezone,isp,hosting,proxy",
      { dispatcher, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = (await res.json()) as IpInfo;
    if (info.status !== "success") throw new Error(info.message || "查询失败");
    return await prisma.matrixProxy.update({
      where: { id },
      data: {
        exitIp: info.query,
        country: info.country,
        countryCode: info.countryCode,
        city: [info.city, info.regionName].filter(Boolean).join(", "),
        timezone: info.timezone,
        isp: info.isp,
        hosting: info.hosting,
        latencyMs: Date.now() - started,
        checkedAt: new Date(),
        lastError: null,
      },
    });
  } catch (e) {
    const msg = proxyError(e);
    await prisma.matrixProxy.update({ where: { id }, data: { checkedAt: new Date(), lastError: msg, latencyMs: null } });
    throw new Error(msg);
  } finally {
    await dispatcher.close().catch(() => {});
  }
}

function proxyError(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const code = err.cause?.code ?? "";
  const text = `${err.message ?? ""} ${err.cause?.message ?? ""}`;
  if (/407|auth/i.test(text)) return "代理账号或密码不对";
  if (code === "ECONNREFUSED") return "连不上代理（端口拒绝连接）";
  if (code === "ENOTFOUND") return "代理地址解析不到";
  if (/timeout|aborted/i.test(text) || code === "UND_ERR_CONNECT_TIMEOUT") return "连接代理超时";
  return (err.cause?.message || err.message || "检测失败").slice(0, 200);
}

/** 建任务：同一账号已经有没跑完的同类任务就不重复建 */
export async function enqueueMatrixJob(input: {
  tenantId: string;
  accountId: string;
  kind: "login" | "open" | "check";
  userId: string | null;
  payload?: Prisma.InputJsonValue;
}) {
  const existing = await prisma.matrixJob.findFirst({
    where: { accountId: input.accountId, kind: input.kind, status: { in: ["queued", "running", "waiting"] } },
  });
  if (existing) return existing;
  return prisma.matrixJob.create({
    data: {
      tenantId: input.tenantId,
      accountId: input.accountId,
      kind: input.kind,
      createdById: input.userId,
      ...(input.payload ? { payload: input.payload } : {}),
    },
  });
}

export function logMatrixEvent(input: {
  tenantId: string;
  accountId: string;
  userId?: string | null;
  action: string;
  detail?: string | null;
  runner?: string | null;
}) {
  return prisma.matrixEvent.create({ data: { ...input, userId: input.userId ?? null } });
}

/** 这个企业能用的运行器（自己的 + 服务器上公共的），最近 90 秒有心跳才算在线 */
export async function onlineRunners(tenantId: string) {
  return prisma.matrixRunner.findMany({
    where: { OR: [{ tenantId }, { tenantId: null }], lastSeenAt: { gte: new Date(Date.now() - RUNNER_STALE_MS) } },
    orderBy: { lastSeenAt: "desc" },
  });
}

// ── 运行器接口鉴权：每个企业一个令牌，库里只存 sha256 ──

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** 生成新令牌（旧的立即失效），明文只返回这一次 */
export async function rotateRunnerToken(tenantId: string) {
  const token = `mr_${randomBytes(24).toString("base64url")}`;
  await prisma.tenant.update({ where: { id: tenantId }, data: { matrixRunnerTokenHash: hashToken(token) } });
  return token;
}

/** 从请求头 Authorization: Bearer <令牌> 认出是哪个企业的运行器 */
export async function runnerTenant(req: Request): Promise<string | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m || !m[1].startsWith("mr_")) return null;
  const t = await prisma.tenant.findFirst({ where: { matrixRunnerTokenHash: hashToken(m[1]) }, select: { id: true } });
  return t?.id ?? null;
}
