"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser } from "@/server/auth";
import { encryptSecret } from "@/server/crypto";
import { checkProxy, enqueueMatrixJob, logMatrixEvent, onlineDeviceIds, rotateRunnerToken } from "@/server/matrix";
import { startTransfer } from "@/server/matrix-transfer";
import { cloudEnabledFor, kickCloud, legacyRunnerOnline } from "@/server/matrix-cloud";
import { bindAccountToCurrentDevice, currentDevice } from "@/server/matrix-device";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { isMatrixPlatform, JOB_KIND, MATRIX_PLATFORMS, matrixPlatform, PROXY_PROTOCOLS, type MatrixPlatform } from "@/lib/matrix";
import { parseCookies } from "@/lib/matrix-cookies";
import { parseTableText } from "@/lib/table-text";

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
  group: z.string().trim().max(40).optional(),
  tags: z.string().max(300).optional(),
  cookies: z.string().max(200_000).optional(),
});

/** 「a, b，c」→ 去重后的标签 */
const tagsOf = (raw: string | undefined) =>
  [...new Set((raw ?? "").split(/[,，;；、\n]/).map((t) => t.trim()).filter(Boolean))].slice(0, 10).map((t) => t.slice(0, 20));

/** 有交给云端的任务就拉起云端运行器（企业开了云端才会）。返回这个账号的任务是不是走云端 */
async function kickRunner(tenantId: string, accountId?: string) {
  return kickCloud(tenantId, accountId, (fn) => after(fn));
}

/**
 * 账号的任务现在能不能执行：归属的电脑在线；或者没有归属电脑，企业开了云端 / 有命令行运行器。
 * 返回 null = 能执行；否则是给用户看的原因。
 */
async function whyCannotRun(tenantId: string, deviceId: string | null) {
  if (deviceId) {
    if ((await onlineDeviceIds(tenantId)).has(deviceId)) return null;
    const d = await prisma.matrixDevice.findUnique({ where: { id: deviceId }, select: { name: true } });
    return `「${d?.name ?? "归属的电脑"}」不在线，打开那台电脑上的车车 CRM 桌面版后会自动执行`;
  }
  if ((await cloudEnabledFor(tenantId)) || (await legacyRunnerOnline(tenantId))) return null;
  return "这个账号还没有归属的电脑：请在车车 CRM 桌面版里操作（会自动归到那台电脑），或在「设置 → 社媒运行」里打开云端运行器";
}

/** 导入 Cookie：加密放进一个检查任务，运行器写进浏览器后检查登录 */
async function enqueueCookieImport(tenantId: string, accountId: string, userId: string, cookies: unknown[]) {
  await prisma.matrixJob.updateMany({
    where: { accountId, kind: "check", status: "queued" },
    data: { status: "canceled", finishedAt: new Date() },
  });
  await enqueueMatrixJob({ tenantId, accountId, kind: "check", userId, payload: { cookiesEnc: encryptSecret(JSON.stringify(cookies)) } });
  await prisma.matrixAccount.update({ where: { id: accountId }, data: { status: "pending", statusNote: "正在导入 Cookie" } });
  await logMatrixEvent({ tenantId, accountId, userId, action: "cookie:import" });
}

export async function saveAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canManage(user)) return { ok: false, message: "需要「管理代理 IP 和全部社媒账号」权限" };
  const parsed = AccountSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const d = parsed.data;
  const db = tenantDb(user.tenantId);
  let cookies: unknown[] | null = null;
  if (d.cookies?.trim()) {
    const c = parseCookies(d.cookies, matrixPlatform(d.platform)!);
    if (!c.ok) return { ok: false, fieldErrors: { cookies: [c.error] } };
    cookies = c.cookies;
  }

  if (!(await db.matrixProxy.findFirst({ where: { id: d.proxyId }, select: { id: true } }))) return { ok: false, fieldErrors: { proxyId: ["代理不存在"] } };
  if (d.ownerId && !(await db.user.findFirst({ where: { id: d.ownerId }, select: { id: true } }))) return { ok: false, fieldErrors: { ownerId: ["成员不存在"] } };

  const data = {
    platform: d.platform,
    name: d.name,
    login: d.login || null,
    ownerId: d.ownerId || null,
    proxyId: d.proxyId,
    note: d.note || null,
    group: d.group || null,
    tags: tagsOf(d.tags),
    ...(d.password ? { passwordEnc: encryptSecret(d.password) } : {}),
  };

  if (d.id) {
    const acc = await db.matrixAccount.findFirst({ where: { id: d.id } });
    if (!acc) return { ok: false, message: "账号不存在" };
    // 指纹一旦生成就不改系统类型；换代理只提醒（时区等会跟着新代理变）
    await db.matrixAccount.update({ where: { id: d.id }, data: { ...data, ...(acc.fingerprint ? {} : { os: d.os }) } });
    const changes = [acc.proxyId !== d.proxyId && "换了代理", acc.ownerId !== (d.ownerId || null) && "换了负责人"].filter(Boolean).join("、");
    await logMatrixEvent({ tenantId: user.tenantId, accountId: d.id, userId: user.id, action: "edit", detail: changes || null });
    if (cookies) {
      await bindAccountToCurrentDevice(user, acc);
      await enqueueCookieImport(user.tenantId, d.id, user.id, cookies);
      await kickRunner(user.tenantId, d.id);
    }
  } else {
    const shared = await db.matrixAccount.count({ where: { proxyId: d.proxyId, platform: d.platform } });
    // 在桌面版里新建的账号直接归到这台电脑
    const here = await currentDevice(user);
    const acc = await db.matrixAccount.create({ data: { ...data, os: d.os, tenantId: user.tenantId, createdById: user.id, deviceId: here?.id ?? null } });
    await logMatrixEvent({ tenantId: user.tenantId, accountId: acc.id, userId: user.id, action: "create" });
    if (cookies) {
      await enqueueCookieImport(user.tenantId, acc.id, user.id, cookies);
      await kickRunner(user.tenantId, acc.id);
    }
    revalidatePath(PATH);
    const next = cookies ? "正在用 Cookie 登录，稍后自动检查结果" : "点「登录」开始登录";
    return {
      ok: true,
      message: shared ? `已添加，${next}。注意：这个代理上已经有同平台的账号，同一个 IP 登多个号容易被关联` : `已添加，${next}`,
    };
  }
  revalidatePath(PATH);
  return { ok: true, message: cookies ? "已保存，正在用 Cookie 登录" : "已保存" };
}

export async function deleteAccountAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!canManage(user)) return { ok: false, message: "没有权限" };
  await tenantDb(user.tenantId).matrixAccount.deleteMany({ where: { id } });
  revalidatePath(PATH);
  return { ok: true, message: "已删除（运行器上的浏览器数据目录需要手动清理）" };
}

/** 登录 / 打开环境 / 检查登录：管理员，或者账号负责人（有「使用」权限） */
export async function runAccountAction(
  id: string,
  kind: "login" | "open" | "check",
): Promise<ActionState & { jobId?: string; cloud?: boolean }> {
  const user = await requireUser();
  const acc = await tenantDb(user.tenantId).matrixAccount.findFirst({ where: { id } });
  if (!acc) return { ok: false, message: "账号不存在" };
  const allowed = canManage(user) || (can(user, "matrix.use") && acc.ownerId === user.id);
  if (!allowed) return { ok: false, message: "这个账号没有分配给你" };
  if (!acc.proxyId) return { ok: false, message: "先给账号绑一个代理 IP" };
  const deviceId = await bindAccountToCurrentDevice(user, acc);
  const reason = await whyCannotRun(user.tenantId, deviceId);
  if (reason) return { ok: false, message: reason };

  const job = await enqueueMatrixJob({ tenantId: user.tenantId, accountId: id, kind, userId: user.id });
  await logMatrixEvent({ tenantId: user.tenantId, accountId: id, userId: user.id, action: `request:${kind}` });
  if (kind === "login") await prisma.matrixAccount.update({ where: { id }, data: { status: "pending", statusNote: null } });
  revalidatePath(PATH);

  // 归属桌面版的账号在那台电脑上弹窗口；没有归属的交给云端（画面在网页里看、在网页里操作）
  const cloud = deviceId ? false : await kickRunner(user.tenantId, id);
  if (cloud) return { ok: true, jobId: job.id, cloud, message: `云端浏览器启动中：${JOB_KIND[kind]}` };
  return { ok: true, jobId: job.id, cloud, message: deviceId ? `已交给桌面版：${JOB_KIND[kind]}` : `已交给运行器：${JOB_KIND[kind]}` };
}

/**
 * 账号换运行位置：here = 归到当前这台桌面版电脑；否则取消归属（交给云端 / 命令行运行器）。
 * 浏览器环境（登录状态）留在原来的地方，换位置后要重新登录一次。
 */
export async function setAccountDeviceAction(id: string, here: boolean): Promise<ActionState> {
  const user = await requireUser();
  const acc = await tenantDb(user.tenantId).matrixAccount.findFirst({ where: { id }, select: { id: true, ownerId: true, deviceId: true } });
  if (!acc) return { ok: false, message: "账号不存在" };
  if (!canManage(user) && !(can(user, "matrix.use") && acc.ownerId === user.id)) return { ok: false, message: "这个账号没有分配给你" };
  const device = here ? await currentDevice(user) : null;
  if (here && !device) return { ok: false, message: "请在车车 CRM 桌面版里操作" };
  const deviceId = device?.id ?? null;
  if (deviceId === acc.deviceId) return { ok: true, message: "运行位置没有变化" };
  const busy = await prisma.matrixJob.count({ where: { accountId: id, status: { in: ["running", "waiting"] } } });
  if (busy) return { ok: false, message: "账号有任务正在执行，等它结束或先取消" };
  // 已登录、原来的位置在线：连同登录状态一起迁过去，不用重新登录
  const moving = await startTransfer({ tenantId: user.tenantId, accountId: id, userId: user.id, to: deviceId, toName: device?.name ?? "云端" });
  if (moving) {
    revalidatePath(PATH);
    return { ok: true, message: `正在把登录环境迁到「${device?.name ?? "云端"}」，迁完自动可用（原来的电脑请保持开着）` };
  }
  await prisma.$transaction([
    prisma.matrixJob.updateMany({ where: { accountId: id, status: "queued" }, data: { status: "canceled", finishedAt: new Date() } }),
    prisma.matrixAccount.update({
      where: { id },
      data: { deviceId, watchedAt: null, status: "new", statusNote: device ? `已移到「${device.name}」，需要重新登录` : "已取消归属电脑，需要重新登录" },
    }),
  ]);
  await logMatrixEvent({ tenantId: user.tenantId, accountId: id, userId: user.id, action: device ? "device:bind" : "device:unbind", detail: device?.name });
  revalidatePath(PATH);
  return { ok: true, message: device ? `已移到这台电脑「${device.name}」，点「登录」重新登录` : "已取消归属，点「登录」重新登录" };
}

export async function cancelJobAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  const job = await tenantDb(user.tenantId).matrixJob.findFirst({ where: { id }, include: { account: { select: { ownerId: true, status: true } } } });
  if (!job) return { ok: false, message: "任务不存在" };
  if (!canManage(user) && job.account.ownerId !== user.id) return { ok: false, message: "没有权限" };
  // 运行中的任务由运行器看到 canceled 后自己停下、关窗口
  await prisma.matrixJob.updateMany({ where: { id, status: { in: ["queued", "running", "waiting"] } }, data: { status: "canceled", finishedAt: new Date() } });
  if (job.kind === "login" && job.account.status === "pending") await prisma.matrixAccount.update({ where: { id: job.accountId }, data: { status: "new" } });
  // 迁移取消：迁出前取消账号留在原处；迁入时取消新位置没有环境，要重新登录
  if (job.kind === "export") await prisma.matrixAccount.update({ where: { id: job.accountId }, data: { statusNote: "迁移已取消" } });
  if (job.kind === "import") await prisma.matrixAccount.update({ where: { id: job.accountId }, data: { status: "new", statusNote: "迁入已取消，需要重新登录" } });
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

/** 给已有账号导入 Cookie（管理员，或者账号负责人） */
export async function importCookiesAction(id: string, text: string): Promise<ActionState> {
  const user = await requireUser();
  const acc = await tenantDb(user.tenantId).matrixAccount.findFirst({ where: { id } });
  if (!acc) return { ok: false, message: "账号不存在" };
  if (!canManage(user) && !(can(user, "matrix.use") && acc.ownerId === user.id)) return { ok: false, message: "这个账号没有分配给你" };
  if (!acc.proxyId) return { ok: false, message: "先给账号绑一个代理 IP" };
  const platform = matrixPlatform(acc.platform);
  if (!platform) return { ok: false, message: "不支持的平台" };
  const c = parseCookies(text.slice(0, 200_000), platform);
  if (!c.ok) return { ok: false, message: c.error };
  const deviceId = await bindAccountToCurrentDevice(user, acc);
  const reason = await whyCannotRun(user.tenantId, deviceId);
  if (reason) return { ok: false, message: reason };
  await enqueueCookieImport(user.tenantId, id, user.id, c.cookies);
  await kickRunner(user.tenantId, id);
  revalidatePath(PATH);
  return { ok: true, message: `已导入 ${c.cookies.length} 条 Cookie，正在检查登录` };
}

// ── 批量导入 ──

export type ImportResult = ActionState & { errors?: string[] };

const MAX_ROWS = 500;

/** 后台把新代理逐个检测一遍（5 个一批） */
function checkProxiesLater(ids: string[]) {
  if (!ids.length) return;
  after(async () => {
    for (let i = 0; i < ids.length; i += 5) await Promise.all(ids.slice(i, i + 5).map((id) => checkProxy(id).catch(() => null)));
  });
}

type NewProxy = { protocol: string; host: string; port: number; username: string | null; password: string };

/** 一行代理文本 → 代理；protocol 是没写协议时的默认值 */
function proxyFromLine(raw: string, protocol: string): NewProxy | string {
  const line = parseProxyLine(raw);
  const host = line.host.trim();
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes(".")) return `代理地址不对：${raw.slice(0, 60)}`;
  if (!line.port || line.port < 1 || line.port > 65535) return `缺少端口：${raw.slice(0, 60)}`;
  return { protocol: line.protocol ?? protocol, host, port: line.port, username: line.username || null, password: line.password || "" };
}

/** 找已有的同一个代理（地址 + 端口 + 账号相同），没有就建一个 */
async function upsertProxy(tenantId: string, userId: string, p: NewProxy, created: string[]) {
  const db = tenantDb(tenantId);
  const found = await db.matrixProxy.findFirst({ where: { host: p.host, port: p.port, username: p.username }, select: { id: true } });
  if (found) return found.id;
  const row = await db.matrixProxy.create({
    data: {
      tenantId,
      createdById: userId,
      name: `${p.host}:${p.port}`,
      protocol: p.protocol,
      host: p.host,
      port: p.port,
      username: p.username,
      passwordEnc: p.username && p.password ? encryptSecret(p.password) : null,
    },
  });
  created.push(row.id);
  return row.id;
}

/** 批量导入代理：一行一个，支持 host:port、host:port:user:pass、user:pass@host:port、socks5://… */
export async function importProxiesAction(text: string, protocol: string): Promise<ImportResult> {
  const user = await requireUser();
  if (!canManage(user)) return { ok: false, message: "需要「管理代理 IP 和全部社媒账号」权限" };
  const proto = (PROXY_PROTOCOLS as readonly string[]).includes(protocol) ? protocol : "http";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return { ok: false, message: "没有内容" };
  if (lines.length > MAX_ROWS) return { ok: false, message: `一次最多导入 ${MAX_ROWS} 行` };
  const errors: string[] = [];
  const created: string[] = [];
  let existed = 0;
  for (const [i, l] of lines.entries()) {
    const p = proxyFromLine(l, proto);
    if (typeof p === "string") {
      errors.push(`第 ${i + 1} 行：${p}`);
      continue;
    }
    const before = created.length;
    await upsertProxy(user.tenantId, user.id, p, created);
    if (created.length === before) existed++;
  }
  checkProxiesLater(created);
  revalidatePath(PATH);
  const msg = [`新增 ${created.length} 个代理`, existed && `${existed} 个已存在`, errors.length && `${errors.length} 行有问题`].filter(Boolean).join("，");
  return { ok: created.length > 0 || existed > 0, message: `${msg}${created.length ? "，正在后台检测出口 IP" : ""}`, errors };
}

const HEADERS: Record<string, string[]> = {
  platform: ["平台", "platform"],
  name: ["名称", "账号名", "名字", "name"],
  login: ["登录账号", "账号", "邮箱", "手机号", "login", "username", "email"],
  password: ["密码", "password"],
  proxy: ["代理", "代理ip", "proxy"],
  owner: ["负责人", "owner"],
  group: ["分组", "组", "group"],
  tags: ["标签", "tags", "tag"],
  note: ["备注", "note"],
  cookies: ["cookie", "cookies"],
  os: ["系统", "os"],
};

const PLATFORM_ALIASES: Record<string, MatrixPlatform> = { twitter: "x", 推特: "x", 领英: "linkedin", 脸书: "facebook", 油管: "youtube" };

function platformOf(v: string): MatrixPlatform | null {
  const k = v.trim().toLowerCase();
  if (!k) return null;
  if (isMatrixPlatform(k)) return k;
  if (PLATFORM_ALIASES[k]) return PLATFORM_ALIASES[k];
  return MATRIX_PLATFORMS.find((p) => p.label.toLowerCase() === k || p.label.toLowerCase().startsWith(k))?.key ?? null;
}

/**
 * 批量导入账号：第一行是表头（平台、名称、登录账号、密码、代理、负责人、分组、标签、备注、Cookie、系统）。
 * 代理一栏可以填代理串（没有就新建）、已有代理的名称或出口 IP；留空就自动分一个这个平台还没用过的代理（一号一代理）。
 */
export async function importAccountsAction(text: string): Promise<ImportResult> {
  const user = await requireUser();
  if (!canManage(user)) return { ok: false, message: "需要「管理代理 IP 和全部社媒账号」权限" };
  const rows = parseTableText(text);
  if (rows.length < 2) return { ok: false, message: "至少要有表头和一行数据" };
  if (rows.length - 1 > MAX_ROWS) return { ok: false, message: `一次最多导入 ${MAX_ROWS} 行` };
  const here = await currentDevice(user);

  const head = rows[0].map((h) => h.replace(/\s+/g, "").toLowerCase());
  const col: Partial<Record<keyof typeof HEADERS, number>> = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    const i = head.findIndex((h) => names.includes(h));
    if (i >= 0) col[key as keyof typeof HEADERS] = i;
  }
  if (col.platform === undefined || col.name === undefined) return { ok: false, message: "表头里要有「平台」和「名称」两列" };

  const db = tenantDb(user.tenantId);
  const [members, proxies, used] = await Promise.all([
    db.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, email: true } }),
    db.matrixProxy.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, exitIp: true, lastError: true } }),
    db.matrixAccount.findMany({ select: { proxyId: true, platform: true } }),
  ]);
  /** 代理 → 已经用它的平台 */
  const usage = new Map<string, Set<string>>();
  for (const u of used) if (u.proxyId) (usage.get(u.proxyId) ?? usage.set(u.proxyId, new Set()).get(u.proxyId)!).add(u.platform);
  const take = (proxyId: string, platform: string) => (usage.get(proxyId) ?? usage.set(proxyId, new Set()).get(proxyId)!).add(platform);
  /** 自动分代理：优先完全没用过的，其次这个平台没用过的；检测没通过的不分 */
  const freeProxy = (platform: string) =>
    proxies.find((p) => !p.lastError && !usage.get(p.id)?.size) ?? proxies.find((p) => !p.lastError && !usage.get(p.id)?.has(platform));

  const errors: string[] = [];
  const createdProxies: string[] = [];
  let added = 0;
  let withCookies = 0;
  const cell = (r: string[], k: keyof typeof HEADERS) => (col[k] === undefined ? "" : (r[col[k]!] ?? "").trim());

  for (const [i, r] of rows.slice(1).entries()) {
    const at = `第 ${i + 2} 行`;
    const platform = platformOf(cell(r, "platform"));
    if (!platform) {
      errors.push(`${at}：平台「${cell(r, "platform")}」不认识`);
      continue;
    }
    const name = cell(r, "name").slice(0, 60);
    if (!name) {
      errors.push(`${at}：缺少名称`);
      continue;
    }

    let proxyId: string | undefined;
    const px = cell(r, "proxy");
    if (px) {
      const known = proxies.find((p) => p.name === px || p.exitIp === px);
      if (known) proxyId = known.id;
      else {
        const p = proxyFromLine(px, "http");
        if (typeof p === "string") {
          errors.push(`${at}：${p}`);
          continue;
        }
        proxyId = await upsertProxy(user.tenantId, user.id, p, createdProxies);
        if (!proxies.some((x) => x.id === proxyId)) proxies.push({ id: proxyId, name: `${p.host}:${p.port}`, exitIp: null, lastError: null });
      }
    } else {
      proxyId = freeProxy(platform)?.id;
      if (!proxyId) {
        errors.push(`${at}：没有空闲的代理可以分，先导入代理或在「代理」一栏填上`);
        continue;
      }
    }

    let cookies: unknown[] | null = null;
    const ck = cell(r, "cookies");
    if (ck) {
      const c = parseCookies(ck, matrixPlatform(platform)!);
      if (!c.ok) {
        errors.push(`${at}：Cookie 不能用（${c.error}），账号照样建了`);
      } else cookies = c.cookies;
    }

    const ownerName = cell(r, "owner").toLowerCase();
    const owner = ownerName ? members.find((m) => m.name.toLowerCase() === ownerName || m.email.toLowerCase() === ownerName) : undefined;
    if (ownerName && !owner) errors.push(`${at}：负责人「${cell(r, "owner")}」不是企业成员，先不分配`);
    const password = cell(r, "password");

    const acc = await db.matrixAccount.create({
      data: {
        tenantId: user.tenantId,
        createdById: user.id,
        deviceId: here?.id ?? null,
        platform,
        name,
        login: cell(r, "login").slice(0, 200) || null,
        ...(password ? { passwordEnc: encryptSecret(password.slice(0, 300)) } : {}),
        proxyId,
        ownerId: owner?.id ?? (ownerName ? null : user.id),
        os: /mac/i.test(cell(r, "os")) ? "macos" : "windows",
        group: cell(r, "group").slice(0, 40) || null,
        tags: tagsOf(cell(r, "tags")),
        note: cell(r, "note").slice(0, 300) || null,
      },
    });
    take(proxyId, platform);
    await logMatrixEvent({ tenantId: user.tenantId, accountId: acc.id, userId: user.id, action: "create", detail: "批量导入" });
    if (cookies) {
      await enqueueCookieImport(user.tenantId, acc.id, user.id, cookies);
      withCookies++;
    }
    added++;
  }

  checkProxiesLater(createdProxies);
  if (withCookies) await kickRunner(user.tenantId);
  revalidatePath(PATH);
  const msg = [
    `导入 ${added} 个账号`,
    createdProxies.length && `新建 ${createdProxies.length} 个代理`,
    withCookies && `${withCookies} 个正在用 Cookie 登录`,
    errors.length && `${errors.length} 条提示`,
  ]
    .filter(Boolean)
    .join("，");
  return { ok: added > 0, message: msg, errors };
}
