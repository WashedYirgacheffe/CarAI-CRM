"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import { encryptSecret } from "@/server/crypto";
import { checkProxy, enqueueMatrixJob, logMatrixEvent, rotateRunnerToken } from "@/server/matrix";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { isMatrixPlatform, JOB_KIND, PROXY_PROTOCOLS } from "@/lib/matrix";

const PATH = "/social/matrix";

type User = Awaited<ReturnType<typeof requireUser>>;
const canManage = (u: User) => can(u, "matrix.manage");

/**
 * 「地址」一栏也接受整串粘贴：
 * user:pass@host:port、host:port:user:pass、socks5://user:pass@host:port
 */
function parseProxyLine(raw: string) {
  let v = raw.trim();
  let protocol: string | undefined;
  const m = /^(https?|socks5h?):\/\//i.exec(v);
  if (m) {
    protocol = m[1].toLowerCase().replace("socks5h", "socks5");
    v = v.slice(m[0].length);
  }
  v = v.replace(/\/+$/, "");
  let username: string | undefined;
  let password: string | undefined;
  let host = v;
  let port: number | undefined;
  if (v.includes("@")) {
    const [cred, addr] = [v.slice(0, v.lastIndexOf("@")), v.slice(v.lastIndexOf("@") + 1)];
    [username, password] = cred.split(":");
    [host, port] = splitHostPort(addr);
  } else {
    const parts = v.split(":");
    if (parts.length >= 4) {
      host = parts[0];
      port = Number(parts[1]);
      username = parts[2];
      password = parts.slice(3).join(":");
    } else [host, port] = splitHostPort(v);
  }
  return { protocol, host, port, username, password };
}

function splitHostPort(addr: string): [string, number | undefined] {
  const i = addr.lastIndexOf(":");
  if (i < 0) return [addr, undefined];
  const n = Number(addr.slice(i + 1));
  return Number.isInteger(n) ? [addr.slice(0, i), n] : [addr, undefined];
}

const ProxySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().max(60).optional(),
  protocol: z.enum(PROXY_PROTOCOLS),
  host: z.string().trim().min(1, "填一下代理地址").max(300),
  port: z.string().trim().optional(),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(300).optional(),
  note: z.string().trim().max(300).optional(),
});

/** 保存代理（新建或修改）；保存后马上检测一次 */
export async function saveProxyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canManage(user)) return { ok: false, message: "需要「管理代理 IP 和全部社媒账号」权限" };
  const parsed = ProxySchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const d = parsed.data;

  const line = parseProxyLine(d.host);
  const host = line.host.trim();
  const port = d.port ? Number(d.port) : line.port;
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes(".")) return { ok: false, fieldErrors: { host: ["地址不对，填 IP 或域名"] } };
  if (!port || !Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, fieldErrors: { port: ["端口在 1～65535 之间"] } };
  const protocol = line.protocol ?? d.protocol;
  const username = d.username || line.username || null;
  const password = d.password || line.password || "";

  const db = tenantDb(user.tenantId);
  const data = {
    name: d.name || `${host}:${port}`,
    protocol,
    host,
    port,
    username,
    note: d.note || null,
    // 修改时密码留空 = 不改
    ...(password ? { passwordEnc: encryptSecret(password) } : d.id ? {} : { passwordEnc: null }),
    ...(username ? {} : { passwordEnc: null }),
  };

  let id = d.id;
  if (id) {
    const own = await db.matrixProxy.findFirst({ where: { id }, select: { id: true } });
    if (!own) return { ok: false, message: "代理不存在" };
    await db.matrixProxy.update({ where: { id }, data: { ...data, exitIp: null, checkedAt: null, lastError: null } });
  } else {
    id = (await db.matrixProxy.create({ data: { ...data, tenantId: user.tenantId, createdById: user.id } })).id;
  }

  let message = "已保存";
  try {
    const p = await checkProxy(id);
    message = `已保存，出口 ${p.exitIp}（${p.country ?? "未知"}）${p.hosting ? "，注意：这是机房 IP，容易被平台识别" : ""}`;
  } catch (e) {
    message = `已保存，但检测没通过：${e instanceof Error ? e.message : "未知原因"}`;
  }
  revalidatePath(PATH);
  return { ok: true, message };
}

export async function checkProxyAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!canManage(user)) return { ok: false, message: "没有权限" };
  if (!(await tenantDb(user.tenantId).matrixProxy.findFirst({ where: { id }, select: { id: true } }))) return { ok: false, message: "代理不存在" };
  try {
    const p = await checkProxy(id);
    revalidatePath(PATH);
    return { ok: true, message: `通了：${p.exitIp} · ${p.country ?? ""} · ${p.latencyMs}ms` };
  } catch (e) {
    revalidatePath(PATH);
    return { ok: false, message: e instanceof Error ? e.message : "检测失败" };
  }
}

export async function deleteProxyAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!canManage(user)) return { ok: false, message: "没有权限" };
  const db = tenantDb(user.tenantId);
  const used = await db.matrixAccount.count({ where: { proxyId: id } });
  if (used) return { ok: false, message: `还有 ${used} 个账号绑着这个代理，先换掉再删` };
  await db.matrixProxy.deleteMany({ where: { id } });
  revalidatePath(PATH);
  return { ok: true, message: "已删除" };
}

const AccountSchema = z.object({
  id: z.string().optional(),
  platform: z.string().refine(isMatrixPlatform, "选一个平台"),
  name: z.string().trim().min(1, "起个名字，方便认").max(60),
  login: z.string().trim().max(200).optional(),
  password: z.string().max(300).optional(),
  ownerId: z.string().optional(),
  proxyId: z.string().min(1, "每个账号都要绑一个代理 IP"),
  os: z.enum(["windows", "macos"]),
  note: z.string().trim().max(300).optional(),
});

export async function saveAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canManage(user)) return { ok: false, message: "需要「管理代理 IP 和全部社媒账号」权限" };
  const parsed = AccountSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const d = parsed.data;
  const db = tenantDb(user.tenantId);

  if (!(await db.matrixProxy.findFirst({ where: { id: d.proxyId }, select: { id: true } }))) return { ok: false, fieldErrors: { proxyId: ["代理不存在"] } };
  if (d.ownerId && !(await db.user.findFirst({ where: { id: d.ownerId }, select: { id: true } }))) return { ok: false, fieldErrors: { ownerId: ["成员不存在"] } };

  const data = {
    platform: d.platform,
    name: d.name,
    login: d.login || null,
    ownerId: d.ownerId || null,
    proxyId: d.proxyId,
    note: d.note || null,
    ...(d.password ? { passwordEnc: encryptSecret(d.password) } : {}),
  };

  if (d.id) {
    const acc = await db.matrixAccount.findFirst({ where: { id: d.id } });
    if (!acc) return { ok: false, message: "账号不存在" };
    // 指纹一旦生成就不改系统类型；换代理只提醒（时区等会跟着新代理变）
    await db.matrixAccount.update({ where: { id: d.id }, data: { ...data, ...(acc.fingerprint ? {} : { os: d.os }) } });
    const changes = [acc.proxyId !== d.proxyId && "换了代理", acc.ownerId !== (d.ownerId || null) && "换了负责人"].filter(Boolean).join("、");
    await logMatrixEvent({ tenantId: user.tenantId, accountId: d.id, userId: user.id, action: "edit", detail: changes || null });
  } else {
    const shared = await db.matrixAccount.count({ where: { proxyId: d.proxyId, platform: d.platform } });
    const acc = await db.matrixAccount.create({ data: { ...data, os: d.os, tenantId: user.tenantId, createdById: user.id } });
    await logMatrixEvent({ tenantId: user.tenantId, accountId: acc.id, userId: user.id, action: "create" });
    revalidatePath(PATH);
    return {
      ok: true,
      message: shared ? "已添加。注意：这个代理上已经有同平台的账号，同一个 IP 登多个号容易被关联" : "已添加，点「登录」开始登录",
    };
  }
  revalidatePath(PATH);
  return { ok: true, message: "已保存" };
}

export async function deleteAccountAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!canManage(user)) return { ok: false, message: "没有权限" };
  await tenantDb(user.tenantId).matrixAccount.deleteMany({ where: { id } });
  revalidatePath(PATH);
  return { ok: true, message: "已删除（运行器上的浏览器数据目录需要手动清理）" };
}

/** 登录 / 打开环境 / 检查登录：管理员，或者账号负责人（有「使用」权限） */
export async function runAccountAction(id: string, kind: "login" | "open" | "check"): Promise<ActionState> {
  const user = await requireUser();
  const acc = await tenantDb(user.tenantId).matrixAccount.findFirst({ where: { id } });
  if (!acc) return { ok: false, message: "账号不存在" };
  const allowed = canManage(user) || (can(user, "matrix.use") && acc.ownerId === user.id);
  if (!allowed) return { ok: false, message: "这个账号没有分配给你" };
  if (!acc.proxyId) return { ok: false, message: "先给账号绑一个代理 IP" };

  await enqueueMatrixJob({ tenantId: user.tenantId, accountId: id, kind, userId: user.id });
  await logMatrixEvent({ tenantId: user.tenantId, accountId: id, userId: user.id, action: `request:${kind}` });
  if (kind === "login") await prisma.matrixAccount.update({ where: { id }, data: { status: "pending", statusNote: null } });
  revalidatePath(PATH);
  return { ok: true, message: `已交给运行器：${JOB_KIND[kind]}` };
}

export async function cancelJobAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const job = await tenantDb(user.tenantId).matrixJob.findFirst({ where: { id }, include: { account: { select: { ownerId: true, status: true } } } });
  if (!job) return { ok: false, message: "任务不存在" };
  if (!canManage(user) && job.account.ownerId !== user.id) return { ok: false, message: "没有权限" };
  // 运行中的任务由运行器看到 canceled 后自己停下、关窗口
  await prisma.matrixJob.updateMany({ where: { id, status: { in: ["queued", "running", "waiting"] } }, data: { status: "canceled", finishedAt: new Date() } });
  if (job.kind === "login" && job.account.status === "pending") await prisma.matrixAccount.update({ where: { id: job.accountId }, data: { status: "new" } });
  revalidatePath(PATH);
  return { ok: true, message: "已取消" };
}

/** 生成运行器令牌（旧令牌立即失效），明文只在这次返回 */
export async function rotateRunnerTokenAction(): Promise<{ ok: boolean; message?: string; token?: string }> {
  const user = await requireUser();
  if (!canManage(user)) return { ok: false, message: "没有权限" };
  const token = await rotateRunnerToken(user.tenantId);
  return { ok: true, token };
}
