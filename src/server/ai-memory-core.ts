import "server-only";
import { prisma, tenantDb } from "@/server/db";
import { aiConfigured, aiJson } from "@/server/ai";
import { cosine, embed, embedModel } from "@/server/ai-embed";
import { type MemoryKind, type MemoryScope, type MemorySource } from "@/lib/ai-memory";

/*
 * AI 记忆里不依赖登录用户的部分：守卫、相似度、写入（合并 / 更新 / 冲突）、后台维护。
 * worker 也引用这里，所以不能引入 auth、customers 这些连带页面代码的模块。
 * 和用户权限有关的（谁能看、谁能改、注入到对话）在 ai-memory.ts。
 */

const STALE_DAYS = 30;

// ── 守卫 ──

const SECRET = /(密码|口令|验证码|password|passwd|api[ _-]?key|secret|token|私钥|cvv|\bsk-[A-Za-z0-9]{12,}|\b\d{16,19}\b)/i;
const BYPASS = /(不用确认|无需确认|跳过确认|直接发送?出去|自动发送|不用审批|绕过|权限|ignore (all|previous) instructions)/i;

export function guard(text: string): string | null {
  if (SECRET.test(text)) return "密码、验证码、密钥、卡号这类信息不能记";
  if (BYPASS.test(text)) return "记忆不能改变确认流程或权限：发消息、发邮件等操作始终要用户在卡片上确认";
  return null;
}

// ── 相似度：中英混排都用字符二元组 ──

export function grams(s: string) {
  const t = s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}
export function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return n / (a.size + b.size - n);
}
/** a 有多少落在 b 里 */
export function covered(a: Set<string>, b: Set<string>) {
  if (!a.size) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return n / a.size;
}

const LATIN = /^[a-z0-9 ./&+-]+$/;
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** 一段要拿去匹配的文字（问题、新记忆），算一次多处用 */
export type Probe = { grams: Set<string>; lower: string; vec: number[] | null };
export const probe = (text: string, vec: number[] | null = null): Probe => ({ grams: grams(text), lower: text.toLowerCase(), vec });

type Scorable = {
  title: string;
  content: string;
  keywords: string;
  embedding: number[];
  embedModel: string | null;
  customer?: { name: string } | null;
};

/** 关键词命中了几个：中文按包含，英文按整词 */
function keywordHits(keywords: string, lower: string) {
  let n = 0;
  for (const raw of keywords.split(/[,，;；、|\n]+/)) {
    const t = raw.trim().toLowerCase();
    if (t.length < 2) continue;
    if (LATIN.test(t) ? new RegExp(`(^|[^a-z0-9])${esc(t)}([^a-z0-9]|$)`).test(lower) : lower.includes(t)) n++;
  }
  return n;
}

/** 一条记忆和这段文字有多相关（0 起，0.18 以上算相关） */
export function relevance(m: Scorable, p: Probe) {
  const lex = covered(grams(m.title), p.grams) * 0.6 + jaccard(grams(`${m.title} ${m.content}`), p.grams) * 0.4;
  const kw = Math.min(0.6, keywordHits(m.keywords, p.lower) * 0.2);
  const model = embedModel();
  const vec = p.vec && model && m.embedModel === model && m.embedding.length ? Math.max(0, cosine(p.vec, m.embedding) - 0.3) * 1.2 : 0;
  const name = m.customer && p.lower.includes(m.customer.name.toLowerCase()) ? 0.5 : 0;
  return lex + kw + vec + name;
}

export const embedText = (m: { title: string; content: string; keywords: string }) => `${m.title}\n${m.content}\n${m.keywords}`;

const FAMILY: Record<MemoryKind, string> = { fact: "k", decision: "k", preference: "p", rule: "p", howto: "h" };

// ── 写 ──

export type SaveResult =
  | { error: string }
  | { ok: true; op: "saved" | "merged" | "updated" | "disputed"; id: string; title: string; scope: MemoryScope; trusted: boolean; note: string };

/** 写记忆的人：后台提炼时没有登录用户，userId 是客户负责人或空 */
export type Actor = { tenantId: string; userId: string | null; admin: boolean };
export type StoreInput = {
  kind: MemoryKind;
  title: string;
  content: string;
  scope: MemoryScope;
  customerId: string | null;
  source: MemorySource;
  replaces?: string;
  keywords?: string;
  origin?: string;
  threadId?: string | null;
};

/** 记住：检查范围和权限，然后交给 store */
/** 后台从邮件 / WhatsApp 提炼的客户事实：一律算外部内容，只作参考 */
export async function rememberOutside(
  tenantId: string,
  creatorId: string | null,
  customerId: string,
  a: { kind: string; title: string; content?: string; keywords?: string; origin: string },
) {
  const kind = (["fact", "preference", "decision"].includes(a.kind) ? a.kind : "fact") as MemoryKind;
  const title = String(a.title ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!title) return { error: "title 不能为空" } as SaveResult;
  return store(
    { tenantId, userId: creatorId, admin: false },
    {
      kind,
      title,
      content:
        String(a.content ?? "")
          .trim()
          .slice(0, 800) || title,
      scope: "customer",
      customerId,
      source: "outside",
      keywords: a.keywords,
      origin: a.origin,
    },
  );
}

type Verdict = "same" | "refines" | "changed" | "contradicts" | "unrelated";

/** 拿不准新旧两条是不是一回事时问模型（字面像但没像到可以直接合并） */
async function judge(item: { title: string; content: string }, cands: { id: string; title: string; content: string }[]) {
  if (!cands.length || !aiConfigured()) return null;
  try {
    const r = await aiJson<{ id?: string; verdict?: Verdict }>({
      system:
        '你在整理 CRM 助手的记忆。判断「新记忆」和哪一条「已有记忆」说的是同一件事，只返回 JSON：{"id":"已有记忆的 id，都无关就空","verdict":"same|refines|changed|contradicts|unrelated"}。same=同一件事、没有新信息；refines=同一件事、新的更具体；changed=同一件事、情况变了；contradicts=同一件事、说法相反；unrelated=都不是同一件事。只是话题相近、两条可以同时成立的都算 unrelated：比如一条说定金比例、一条说币种；一条说采购对接人是谁、一条说老板 / 决策人是谁。只有新的那条让旧的不再成立时才是 changed 或 contradicts。拿不准就 unrelated。',
      messages: [
        {
          role: "user",
          content: `新记忆：${item.title}：${item.content.slice(0, 300)}\n\n已有记忆：\n${cands.map((c) => `- id=${c.id}｜${c.title}：${c.content.slice(0, 200)}`).join("\n")}`,
        },
      ],
      maxTokens: 120,
      temperature: 0,
      timeoutMs: 10_000,
    });
    const hit = cands.find((c) => c.id === r.id);
    return hit && r.verdict && r.verdict !== "unrelated" ? { id: hit.id, verdict: r.verdict } : null;
  } catch (e) {
    console.error("[ai-memory] judge", e instanceof Error ? e.message : e);
    return null;
  }
}

const cleanKeywords = (k: string | undefined) =>
  (k ?? "")
    .split(/[,，;；、|\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 40)
    .slice(0, 16)
    .join(", ");

export async function store(actor: Actor, s: StoreInput): Promise<SaveResult> {
  const { kind, scope, title, content, source } = s;
  const bad = guard(`${title}\n${content}`);
  if (bad) return { error: bad };
  const trusted = source === "user_said";
  if (kind === "rule" && !trusted) return { error: "规则只能记用户亲口说的话；这条可以记成事实（fact），只作参考" };
  if (scope === "team" && !trusted) return { error: "团队记忆只能记用户亲口说的话" };

  const db = tenantDb(actor.tenantId);
  const owner = scope === "personal" ? { userId: actor.userId } : scope === "customer" ? { customerId: s.customerId } : {};
  const status = scope === "team" && !actor.admin ? "proposed" : "active";
  const createdByKind = trusted ? "user" : "ai";
  const keywords = cleanKeywords(s.keywords);

  const peers = await db.aiMemory.findMany({
    where: { scope, status: "active", ...owner, kind: { in: (Object.keys(FAMILY) as MemoryKind[]).filter((k) => FAMILY[k] === FAMILY[kind]) } },
    orderBy: { updatedAt: "desc" },
    take: 60,
  });
  const model = embedModel();
  const vec = model ? ((await embed([embedText({ title, content, keywords })]))?.[0] ?? null) : null;

  const data = {
    tenantId: actor.tenantId,
    scope,
    userId: actor.userId,
    customerId: s.customerId,
    kind,
    title,
    content,
    source,
    trusted,
    createdByKind,
    status,
    keywords,
    origin: s.origin ?? null,
    threadId: s.threadId ?? null,
    ...(vec && model ? { embedding: vec, embedModel: model } : {}),
  };

  const merge = async (twin: (typeof peers)[number]) => {
    const up = trusted && !twin.trusted;
    const kw = cleanKeywords(`${twin.keywords}, ${keywords}`);
    await db.aiMemory.update({
      where: { id: twin.id },
      data: { recurrence: { increment: 1 }, keywords: kw, ...(up ? { trusted: true, source, createdByKind } : {}) },
    });
    return {
      ok: true,
      op: "merged",
      id: twin.id,
      title: twin.title,
      scope,
      trusted: up || twin.trusted,
      note: "这条已经记着了（合并进原来那条）",
    } as const;
  };

  // 1. 指明要替换哪条
  let old = s.replaces ? peers.find((p) => p.id === s.replaces?.replace(/^#/, "")) : undefined;
  if (!old) {
    // 2. 几乎一样的直接合并
    const p = probe(`${title} ${content} ${keywords}`, vec);
    const scored = peers.map((m) => ({ m, j: jaccard(grams(`${m.title} ${m.content}`), p.grams), r: relevance(m, p) }));
    const twin = scored.filter((x) => x.j >= 0.8).sort((x, y) => y.j - x.j)[0]?.m;
    if (twin) return merge(twin);
    // 3. 像但拿不准：问模型
    const cands = scored
      .filter((x) => x.r >= 0.3)
      .sort((x, y) => y.r - x.r)
      .slice(0, 4)
      .map((x) => x.m);
    const v = await judge({ title, content }, cands);
    if (v) {
      const hit = cands.find((c) => c.id === v.id)!;
      if (v.verdict === "same") return merge(hit);
      old = hit;
    }
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
    const m = await db.aiMemory.create({ data: { ...data, keywords: cleanKeywords(`${keywords}, ${old.keywords}`), pinned: old.pinned } });
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

// ── 团队提升、维护（worker 用）──

export const PROMOTABLE = ["rule", "preference", "howto"];

/** 团队记忆通过后：提议它的那些个人记忆让位 */
export async function retirePromoted(tenantId: string, teamId: string) {
  const db = tenantDb(tenantId);
  const t = await db.aiMemory.findFirst({ where: { id: teamId, scope: "team" }, select: { origin: true } });
  const ids = t?.origin?.startsWith("promote:") ? t.origin.slice(8).split(",").filter(Boolean) : [];
  if (ids.length)
    await db.aiMemory.updateMany({
      where: { id: { in: ids }, scope: "personal", status: "active" },
      data: { status: "superseded", supersededById: teamId, archivedAt: new Date() },
    });
}

/**
 * 每天：好几位同事各自让 AI 记了差不多的规矩 → 提议成团队记忆，等管理员确认。
 * 被驳回过的（同样内容的团队记忆已归档）不再提。
 */
export async function suggestTeamPromotions() {
  const tenants = await prisma.aiMemory.groupBy({ by: ["tenantId"], where: { scope: "personal", status: "active", trusted: true } });
  let made = 0;
  for (const { tenantId } of tenants) {
    const db = tenantDb(tenantId);
    const rows = await db.aiMemory.findMany({
      where: { scope: "personal", status: "active", trusted: true, kind: { in: PROMOTABLE } },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    const team = await db.aiMemory.findMany({ where: { scope: "team" }, select: { title: true, content: true } });
    const teamGrams = team.map((t) => grams(`${t.title} ${t.content}`));
    const model = embedModel();
    const g = rows.map((r) => grams(`${r.title} ${r.content}`));
    const close = (i: number, j: number) =>
      jaccard(g[i], g[j]) >= 0.5 ||
      (!!model && rows[i].embedModel === model && rows[j].embedModel === model && cosine(rows[i].embedding, rows[j].embedding) >= 0.88);
    const used = new Set<number>();
    for (let i = 0; i < rows.length; i++) {
      if (used.has(i)) continue;
      const group = [i];
      for (let j = i + 1; j < rows.length; j++)
        if (!used.has(j) && rows[j].userId !== rows[i].userId && rows[j].kind === rows[i].kind && close(i, j)) group.push(j);
      const people = new Set(group.map((k) => rows[k].userId));
      if (people.size < 2) continue;
      group.forEach((k) => used.add(k));
      if (teamGrams.some((t) => jaccard(t, g[i]) >= 0.5)) continue;
      const m = rows[i];
      await db.aiMemory.create({
        data: {
          tenantId,
          scope: "team",
          userId: null,
          kind: m.kind,
          title: m.title,
          content: m.content,
          keywords: m.keywords,
          embedding: m.embedding,
          embedModel: m.embedModel,
          source: "user_said",
          trusted: true,
          createdByKind: "ai",
          status: "proposed",
          origin: `promote:${group.map((k) => rows[k].id).join(",")}`,
        },
      });
      made++;
    }
  }
  return made;
}

// ── 维护 ──

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

/** 配置了向量模型：给还没向量（或换过模型）的记忆补上 */
export async function embedPending(limit = 64) {
  const model = embedModel();
  if (!model) return 0;
  const rows = await prisma.aiMemory.findMany({
    where: { status: { in: ["active", "proposed"] }, OR: [{ embedModel: null }, { embedModel: { not: model } }] },
    select: { id: true, title: true, content: true, keywords: true },
    take: limit,
  });
  if (!rows.length) return 0;
  const vecs = await embed(rows.map(embedText));
  if (!vecs) return 0;
  await prisma.$transaction(rows.map((r, i) => prisma.aiMemory.update({ where: { id: r.id }, data: { embedding: vecs[i], embedModel: model } })));
  return rows.length;
}
