import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, tenantDb } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { scopeOwnerIds } from "@/server/scope";
import { dateInput } from "@/lib/docs";
import { MEMORY_KINDS, type MemoryKind, type MemoryScope, type MemorySource } from "@/lib/ai-memory";

/*
 * AI 的记忆（参照 agentes 的做法）：
 * - 可信度看来源，由代码定：用户亲口说的可信；AI 自己发现的、从邮件 / WhatsApp / 网页读来的只当参考，不能当规则。
 * - 从不覆盖：改了就新建一版，旧的标「被取代」；AI 不能取代人写的，冲突时两条都留着、标「有争议」等人定。
 * - 注入有预算：个人规则 / 偏好、团队规则、置顶的每次都带；然后是当前客户的、和这句话相关的；其余只给标题。
 */

const BUDGET = 3500;
const CORE_BUDGET = 1500;
const STALE_DAYS = 30;

export type MemoryRow = Prisma.AiMemoryGetPayload<{ include: { customer: { select: { id: true; name: true } } } }>;

/** 本轮对话里和记忆有关的上下文 */
export type MemoryCtx = {
  user: CurrentUser;
  threadId?: string;
  /** 这一轮读过外部内容（邮件、WhatsApp、网页、右键带来的页面内容） */
  outside: boolean;
  /** 用户最近亲口说的话（本轮 + 前两轮），用来核对 user_said */
  userText: string;
};

export const isMemoryAdmin = (user: CurrentUser) => user.isOwner || can(user, "settings.company");

// ── 守卫 ──

const SECRET = /(密码|口令|验证码|password|passwd|api[ _-]?key|secret|token|私钥|cvv|\bsk-[A-Za-z0-9]{12,}|\b\d{16,19}\b)/i;
const BYPASS = /(不用确认|无需确认|跳过确认|直接发送?出去|自动发送|不用审批|绕过|权限|ignore (all|previous) instructions)/i;

function guard(text: string): string | null {
  if (SECRET.test(text)) return "密码、验证码、密钥、卡号这类信息不能记";
  if (BYPASS.test(text)) return "记忆不能改变确认流程或权限：发消息、发邮件等操作始终要用户在卡片上确认";
  return null;
}

// ── 相似度：中英混排都用字符二元组 ──

function grams(s: string) {
  const t = s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return n / (a.size + b.size - n);
}
/** a 有多少落在 b 里 */
function covered(a: Set<string>, b: Set<string>) {
  if (!a.size) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return n / a.size;
}

const FAMILY: Record<MemoryKind, string> = { fact: "k", decision: "k", preference: "p", rule: "p", howto: "h" };

// ── 谁能看、谁能改 ──

/** 当前用户能看到的记忆（不含状态条件） */
export async function visibleWhere(user: CurrentUser): Promise<Prisma.AiMemoryWhereInput> {
  const ids = await scopeOwnerIds(user);
  const custOr: Prisma.CustomerWhereInput[] = [];
  if (can(user, "customer.view")) custOr.push(ids ? { ownerId: { in: ids } } : { ownerId: { not: null } });
  if (can(user, "pool.view")) custOr.push({ ownerId: null });
  return {
    OR: [{ scope: "personal", userId: user.id }, { scope: "team" }, ...(custOr.length ? [{ scope: "customer", customer: { OR: custOr } }] : [])],
  };
}

export async function canEditMemory(user: CurrentUser, m: { scope: string; userId: string | null; customerId: string | null }) {
  if (m.scope === "personal") return m.userId === user.id;
  if (m.scope === "team") return isMemoryAdmin(user);
  if (m.scope === "customer" && m.customerId) return !!(await getCustomerForUser(user, m.customerId));
  return false;
}

// ── 写 ──

export type RememberInput = {
  kind: string;
  title: string;
  content?: string;
  scope: string;
  customerId?: string;
  basis?: string;
  replaces?: string;
};
export type SaveResult =
  | { error: string }
  | { ok: true; op: "saved" | "merged" | "updated" | "disputed"; id: string; title: string; scope: MemoryScope; trusted: boolean; note: string };

function sourceOf(ctx: MemoryCtx, basis: string | undefined, text: string): MemorySource {
  if (basis !== "user_said") return ctx.outside ? "outside" : "ai_found";
  // 读过外部内容的一轮：要真是用户自己说的话才算（防邮件里的「要求」混进来）
  if (ctx.outside && covered(grams(text), grams(ctx.userText)) < 0.3) return "outside";
  return "user_said";
}

const SCOPE_IN: Record<string, MemoryScope> = { me: "personal", personal: "personal", customer: "customer", team: "team" };

export async function remember(ctx: MemoryCtx, a: RememberInput): Promise<SaveResult> {
  const { user } = ctx;
  const kind = a.kind as MemoryKind;
  if (!(kind in MEMORY_KINDS)) return { error: "kind 只能是 fact / preference / rule / decision / howto" };
  const scope = SCOPE_IN[a.scope] ?? "personal";
  const title = a.title.replace(/\s+/g, " ").trim().slice(0, 80);
  const content = (a.content ?? "").trim().slice(0, 800) || title;
  if (!title) return { error: "title 不能为空" };
  const bad = guard(`${title}\n${content}`);
  if (bad) return { error: bad };

  const source = sourceOf(ctx, a.basis, `${title} ${content}`);
  const trusted = source === "user_said";
  if (kind === "rule" && !trusted) return { error: "规则只能记用户亲口说的话；这条可以记成事实（fact），只作参考" };
  if (scope === "team" && !trusted) return { error: "团队记忆只能记用户亲口说的话" };

  const db = tenantDb(user.tenantId);
  let customerId: string | null = null;
  if (scope === "customer") {
    const c = a.customerId ? await getCustomerForUser(user, a.customerId) : null;
    if (!c) return { error: "要记到客户名下，需要一个你有权限的 customerId（先 search_entities）" };
    customerId = c.customer.id;
  }
  const owner = scope === "personal" ? { userId: user.id } : scope === "customer" ? { customerId } : {};
  const status = scope === "team" && !isMemoryAdmin(user) ? "proposed" : "active";
  const createdByKind = trusted ? "user" : "ai";

  const peers = await db.aiMemory.findMany({
    where: { scope, status: "active", ...owner, kind: { in: (Object.keys(FAMILY) as MemoryKind[]).filter((k) => FAMILY[k] === FAMILY[kind]) } },
    orderBy: { updatedAt: "desc" },
    take: 60,
  });

  const data = {
    tenantId: user.tenantId,
    scope,
    userId: user.id,
    customerId,
    kind,
    title,
    content,
    source,
    trusted,
    createdByKind,
    status,
    threadId: ctx.threadId ?? null,
  };

  // 1. 指明要替换哪条
  const old = a.replaces ? peers.find((p) => p.id === a.replaces?.replace(/^#/, "")) : undefined;
  // 2. 没指明：几乎一样的就合并
  const twin = old
    ? undefined
    : peers
        .map((p) => ({ p, s: jaccard(grams(`${p.title} ${p.content}`), grams(`${title} ${content}`)) }))
        .filter((x) => x.s >= 0.8)
        .sort((x, y) => y.s - x.s)[0]?.p;

  if (twin) {
    const up = trusted && !twin.trusted;
    await db.aiMemory.update({
      where: { id: twin.id },
      data: { recurrence: { increment: 1 }, ...(up ? { trusted: true, source, createdByKind } : {}) },
    });
    return { ok: true, op: "merged", id: twin.id, title: twin.title, scope, trusted: up || twin.trusted, note: "这条已经记着了（合并进原来那条）" };
  }

  if (old) {
    // AI 自己的发现不能取代人写的：两条都留着，标有争议
    if (old.createdByKind === "user" && !trusted) {
      const m = await db.aiMemory.create({ data: { ...data, disputed: true } });
      await db.aiMemory.updateMany({ where: { id: old.id }, data: { disputed: true } });
      return {
        ok: true,
        op: "disputed",
        id: m.id,
        title,
        scope,
        trusted,
        note: `和用户之前说的「${old.title}」不一致，两条都留着了。请把记录里的说法告诉用户，问哪个对`,
      };
    }
    const m = await db.aiMemory.create({ data });
    await db.aiMemory.updateMany({
      where: { id: old.id },
      data: { status: "superseded", supersededById: m.id, archivedAt: new Date(), disputed: false },
    });
    return { ok: true, op: "updated", id: m.id, title, scope, trusted, note: `已更新（旧的「${old.title}」留作历史）` };
  }

  const m = await db.aiMemory.create({ data });
  const where = scope === "personal" ? "只对你自己" : scope === "customer" ? "记在这个客户名下，能看这个客户的同事也能用" : "全公司";
  return {
    ok: true,
    op: "saved",
    id: m.id,
    title,
    scope,
    trusted,
    note:
      status === "proposed" ? "团队记忆已提交，等管理员在「AI 记忆」里确认后生效" : `已记住（${where}${trusted ? "" : "，AI 自己的发现，只作参考"}）`,
  };
}

export async function updateMemory(ctx: MemoryCtx, id: string, a: { title?: string; content?: string; basis?: string }): Promise<SaveResult> {
  const db = tenantDb(ctx.user.tenantId);
  const old = await db.aiMemory.findFirst({ where: { id: id.replace(/^#/, ""), status: "active", AND: [await visibleWhere(ctx.user)] } });
  if (!old) return { error: "没有这条记忆" };
  return remember(ctx, {
    kind: old.kind,
    title: a.title?.trim() || old.title,
    content: a.content?.trim() || (a.title ? a.title : old.content),
    scope: old.scope,
    customerId: old.customerId ?? undefined,
    basis: a.basis,
    replaces: old.id,
  });
}

export async function forgetMemory(ctx: MemoryCtx, id: string, basis?: string): Promise<{ error: string } | { ok: true; title: string }> {
  const { user } = ctx;
  const db = tenantDb(user.tenantId);
  const m = await db.aiMemory.findFirst({
    where: { id: id.replace(/^#/, ""), status: { in: ["active", "proposed"] }, AND: [await visibleWhere(user)] },
  });
  if (!m) return { error: "没有这条记忆" };
  // AI 自己写的可以自己删；人写的要用户开口
  if (m.createdByKind === "user" && basis !== "user_said") return { error: "这条是用户说的，只有用户要求时才能忘掉" };
  if (!(await canEditMemory(user, m))) return { error: m.scope === "team" ? "团队记忆只有管理员能删" : "没有权限" };
  await db.aiMemory.updateMany({ where: { id: m.id }, data: { status: "archived", archivedAt: new Date() } });
  return { ok: true, title: m.title };
}

// ── 读 ──

const SOURCE_TAG: Record<string, string> = { user_said: "用户说的", ai_found: "AI 发现，只作参考", outside: "来自外部内容，只作参考" };

function line(m: MemoryRow, tz: string, full = true) {
  const who = m.scope === "customer" && m.customer ? `客户 ${m.customer.name} · ` : m.scope === "team" ? "团队 · " : "";
  const tag = m.trusted ? (m.confirmedById && m.source !== "user_said" ? "已确认" : SOURCE_TAG.user_said) : SOURCE_TAG[m.source];
  const date = dateInput(tz, 0, m.updatedAt).slice(5);
  const flags = [m.disputed ? "有争议" : "", m.pinned ? "置顶" : ""].filter(Boolean).join("，");
  const body = full && m.content !== m.title ? `：${m.content.slice(0, 300)}` : "";
  return `- [${who}${MEMORY_KINDS[m.kind as MemoryKind] ?? m.kind} · ${tag} · ${date}${flags ? ` · ${flags}` : ""}] ${m.title}${body}（#${m.id}）`;
}

const withCustomer = { customer: { select: { id: true, name: true } } } as const;

/** 本轮放进系统提示的记忆，以及哪些是这次匹配到的（给前端显示「参考了记忆」） */
export async function memoryBlock(user: CurrentUser, input: { message: string; customerId?: string | null }) {
  const db = tenantDb(user.tenantId);
  const vis = await visibleWhere(user);
  const all = await db.aiMemory.findMany({
    where: { status: "active", AND: [vis] },
    include: withCustomer,
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 400,
  });
  if (!all.length) return { text: "", used: [] as { id: string; title: string }[] };

  const tz = user.timezone;
  const out: string[] = [];
  const taken = new Set<string>();
  let size = 0;
  const push = (m: MemoryRow, cap: number) => {
    const l = line(m, tz);
    if (size + l.length > cap) return false;
    out.push(l);
    size += l.length;
    taken.add(m.id);
    return true;
  };

  // 1. 固定核心：本人的规则 / 偏好、团队规则 / 偏好、置顶的（可信的才算）
  const core = all.filter(
    (m) => m.trusted && (m.pinned || ((m.scope === "personal" || m.scope === "team") && (m.kind === "rule" || m.kind === "preference"))),
  );
  for (const m of core) push(m, CORE_BUDGET);

  // 2. 当前客户的
  const used: MemoryRow[] = [];
  if (input.customerId)
    for (const m of all.filter((x) => x.customerId === input.customerId && !taken.has(x.id)).slice(0, 12)) if (push(m, BUDGET)) used.push(m);

  // 3. 和这句话相关的
  const q = grams(input.message);
  const hits = all
    .filter((m) => !taken.has(m.id))
    .map((m) => ({
      m,
      s:
        covered(grams(m.title), q) * 0.6 +
        jaccard(grams(`${m.title} ${m.content}`), q) * 0.4 +
        (m.customer && input.message.includes(m.customer.name) ? 0.5 : 0),
    }))
    .filter((x) => x.s >= 0.18)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
  for (const { m } of hits) if (push(m, BUDGET)) used.push(m);

  // 4. 其余只给标题
  const rest = all
    .filter((m) => !taken.has(m.id) && m.scope !== "customer")
    .sort((a, b) => b.useCount - a.useCount)
    .slice(0, 12)
    .map((m) => `${m.title}（#${m.id}）`);

  if (used.length)
    await db.aiMemory.updateMany({ where: { id: { in: used.map((m) => m.id) } }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } });

  const text = [out.join("\n"), rest.length ? `还记得（需要细节用 recall）：${rest.join("；")}` : ""].filter(Boolean).join("\n");
  return { text, used: used.map((m) => ({ id: m.id, title: m.title })) };
}

/** recall 工具：按关键词 / 客户找记忆 */
export async function recallMemory(user: CurrentUser, query: string, customerId?: string) {
  const db = tenantDb(user.tenantId);
  const rows = await db.aiMemory.findMany({
    where: { status: "active", AND: [await visibleWhere(user)], ...(customerId ? { customerId } : {}) },
    include: withCustomer,
    orderBy: { updatedAt: "desc" },
    take: 400,
  });
  const q = grams(query);
  const hits = query.trim()
    ? rows
        .map((m) => ({ m, s: jaccard(grams(`${m.title} ${m.content} ${m.customer?.name ?? ""}`), q) + covered(q, grams(`${m.title} ${m.content}`)) }))
        .filter((x) => x.s > 0.15)
        .sort((a, b) => b.s - a.s)
        .slice(0, 15)
        .map((x) => x.m)
    : rows.slice(0, 30);
  if (hits.length)
    await db.aiMemory.updateMany({ where: { id: { in: hits.map((m) => m.id) } }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } });
  return { count: hits.length, memories: hits.map((m) => line(m, user.timezone)) };
}

/** 客户上下文里附带的客户记忆 */
export async function customerMemories(user: CurrentUser, customerId: string) {
  const rows = await tenantDb(user.tenantId).aiMemory.findMany({
    where: { customerId, status: "active" },
    include: withCustomer,
    orderBy: { updatedAt: "desc" },
    take: 15,
  });
  return rows.map((m) => line(m, user.timezone));
}

/** 每天：AI 自己发现、30 天没用过、没人确认的记忆自动归档（可在记忆页恢复）；用户说的永远不过期 */
export async function expireStaleMemories() {
  const before = new Date(Date.now() - STALE_DAYS * 86_400_000);
  const r = await prisma.aiMemory.updateMany({
    where: {
      status: "active",
      trusted: false,
      pinned: false,
      updatedAt: { lt: before },
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: before } }],
    },
    data: { status: "archived", archivedAt: new Date() },
  });
  return r.count;
}
