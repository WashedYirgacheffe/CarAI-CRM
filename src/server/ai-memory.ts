import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, tenantDb } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { scopeOwnerIds } from "@/server/scope";
import { dateInput } from "@/lib/docs";
import { MEMORY_KINDS, type MemoryKind, type MemoryScope, type MemorySource } from "@/lib/ai-memory";
import { embed, embedModel } from "@/server/ai-embed";
import { covered, grams, jaccard, probe, relevance, store, PROMOTABLE, type SaveResult } from "@/server/ai-memory-core";

export { expireStaleMemories, retirePromoted, suggestTeamPromotions, embedPending, type SaveResult } from "@/server/ai-memory-core";

/*
 * AI 的记忆（参照 agentes 的做法）：
 * - 可信度看来源，由代码定：用户亲口说的可信；AI 自己发现的、从邮件 / WhatsApp / 网页读来的只当参考，不能当规则。
 * - 从不覆盖：改了就新建一版，旧的标「被取代」；AI 不能取代人写的，冲突时两条都留着、标「有争议」等人定。
 * - 注入有预算：个人规则 / 偏好、团队规则、置顶的每次都带；然后是当前客户的、和这句话相关的；其余只给标题。
 * - 相关度：字面相似 + 中英文关键词 +（配置了的话）向量；新记忆和旧的像但不确定是不是一回事时，让模型判断合并 / 更新 / 无关。
 */

const BUDGET = 3500;
const CORE_BUDGET = 1500;

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
  /** 中英文关键词，逗号隔开 */
  keywords?: string;
  origin?: string;
};
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
  let customerId: string | null = null;
  if (scope === "customer") {
    const c = a.customerId ? await getCustomerForUser(user, a.customerId) : null;
    if (!c) return { error: "要记到客户名下，需要一个你有权限的 customerId（先 search_entities）" };
    customerId = c.customer.id;
  }
  return store(
    { tenantId: user.tenantId, userId: user.id, admin: isMemoryAdmin(user) },
    {
      kind,
      title,
      content,
      scope,
      customerId,
      source: sourceOf(ctx, a.basis, `${title} ${content}`),
      replaces: a.replaces,
      keywords: a.keywords,
      origin: a.origin ?? (ctx.threadId ? `thread:${ctx.threadId}` : undefined),
      threadId: ctx.threadId,
    },
  );
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
const OLD_FACT_DAYS = 90;

function line(m: MemoryRow, tz: string, full = true) {
  const who = m.scope === "customer" && m.customer ? `客户 ${m.customer.name} · ` : m.scope === "team" ? "团队 · " : "";
  const tag = m.trusted ? (m.confirmedById && m.source !== "user_said" ? "已确认" : SOURCE_TAG.user_said) : SOURCE_TAG[m.source];
  const date = dateInput(tz, 0, m.updatedAt).slice(5);
  // 没人担保、又放了很久的事实：情况可能变了
  const old = !m.trusted && Date.now() - m.updatedAt.getTime() > OLD_FACT_DAYS * 86_400_000 ? "较旧，用前核实" : "";
  const flags = [m.disputed ? "有争议" : "", m.pinned ? "置顶" : "", old].filter(Boolean).join("，");
  const body = full && m.content !== m.title ? `：${m.content.slice(0, 300)}` : "";
  return `- [${who}${MEMORY_KINDS[m.kind as MemoryKind] ?? m.kind} · ${tag} · ${date}${flags ? ` · ${flags}` : ""}] ${m.title}${body}（#${m.id}）`;
}

const withCustomer = { customer: { select: { id: true, name: true } } } as const;

/** 这句话的检索探针：配置了向量就顺便算向量 */
async function queryProbe(text: string) {
  const vec = embedModel() ? ((await embed([text]))?.[0] ?? null) : null;
  return probe(text, vec);
}

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

  // 2. 当前客户的（可信的在前）
  const used: MemoryRow[] = [];
  if (input.customerId)
    for (const m of all
      .filter((x) => x.customerId === input.customerId && !taken.has(x.id))
      .sort((a, b) => Number(b.trusted) - Number(a.trusted))
      .slice(0, 12))
      if (push(m, BUDGET)) used.push(m);

  // 3. 和这句话相关的：字面 + 中英文关键词 + 向量
  const p = await queryProbe(input.message);
  const hits = all
    .filter((m) => !taken.has(m.id))
    .map((m) => ({ m, s: relevance(m, p) }))
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
  let hits = rows.slice(0, 30);
  if (query.trim()) {
    const p = await queryProbe(query);
    hits = rows
      .map((m) => ({ m, s: relevance(m, p) + covered(p.grams, grams(`${m.title} ${m.content} ${m.customer?.name ?? ""}`)) * 0.5 }))
      .filter((x) => x.s > 0.15)
      .sort((a, b) => b.s - a.s)
      .slice(0, 15)
      .map((x) => x.m);
  }
  if (hits.length)
    await db.aiMemory.updateMany({ where: { id: { in: hits.map((m) => m.id) } }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } });
  return { count: hits.length, memories: hits.map((m) => line(m, user.timezone)) };
}

/** 客户上下文里附带的客户记忆 */
export async function customerMemories(user: CurrentUser, customerId: string) {
  const rows = await tenantDb(user.tenantId).aiMemory.findMany({
    where: { customerId, status: "active" },
    include: withCustomer,
    orderBy: [{ trusted: "desc" }, { updatedAt: "desc" }],
    take: 15,
  });
  return rows.map((m) => line(m, user.timezone));
}

// ── 团队提升 ──

/** 把自己的一条规矩提议给全公司：管理员直接生效，其他人等管理员确认 */
export async function promoteMemory(user: CurrentUser, id: string): Promise<{ error: string } | { ok: true; active: boolean }> {
  const db = tenantDb(user.tenantId);
  const m = await db.aiMemory.findFirst({ where: { id, scope: "personal", userId: user.id, status: "active", trusted: true } });
  if (!m || !PROMOTABLE.includes(m.kind)) return { error: "只有你自己说过的规矩、偏好、做法能提议给全公司" };
  const team = await db.aiMemory.findMany({
    where: { scope: "team", status: { in: ["active", "proposed"] } },
    select: { title: true, content: true },
  });
  const g = grams(`${m.title} ${m.content}`);
  if (team.some((t) => jaccard(grams(`${t.title} ${t.content}`), g) >= 0.6)) return { error: "团队记忆里已经有差不多的一条了" };
  const admin = isMemoryAdmin(user);
  const t = await db.aiMemory.create({
    data: {
      tenantId: user.tenantId,
      scope: "team",
      userId: user.id,
      kind: m.kind,
      title: m.title,
      content: m.content,
      keywords: m.keywords,
      embedding: m.embedding,
      embedModel: m.embedModel,
      source: "user_said",
      trusted: true,
      createdByKind: "user",
      status: admin ? "active" : "proposed",
      confirmedById: admin ? user.id : null,
      origin: `promote:${m.id}`,
    },
  });
  // 生效了就不必再留个人那份
  if (admin) await db.aiMemory.updateMany({ where: { id: m.id }, data: { status: "superseded", supersededById: t.id, archivedAt: new Date() } });
  return { ok: true, active: admin };
}
