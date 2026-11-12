import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { tenantDb } from "@/server/db";
import type { CurrentUser } from "@/server/auth";
import { aiComplete, aiConfigured } from "@/server/ai";

/*
 * AI 对话存库：换电脑、换手机都能接着聊。
 * 对话长了以后，模型只带最近 KEEP 轮原文，更早的在后台压成一段摘要（对话停下来后才做，不让用户等）。
 */

const MAX_THREADS = 30;
const MAX_TURNS = 60;
/** 单段对话存库的上限（缩略图太多就去掉） */
const MAX_BYTES = 600_000;
/** 模型每轮带的最近轮数（和前端 historyOf 一致） */
export const KEEP = 10;
/** 没压缩的旧轮次攒够这么多再压 */
const COMPACT_AFTER = 6;

type RawTurn = {
  role?: string;
  text?: string;
  media?: { kind?: string; name?: string; thumb?: string }[];
  snippet?: { label?: string; text?: string };
  visuals?: unknown[];
  cards?: { card?: { title?: string } }[];
};

export const validThreadId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9]{6,32}$/i.test(id);

function shrink(turns: unknown[]) {
  let t = turns.slice(-MAX_TURNS);
  if (JSON.stringify(t).length > MAX_BYTES)
    t = t.map((x) => {
      const r = x as RawTurn;
      return r.media ? { ...r, media: r.media.map((m) => ({ ...m, thumb: "" })) } : x;
    });
  return JSON.stringify(t).length > MAX_BYTES ? null : t;
}

export async function listThreads(user: CurrentUser) {
  const rows = await tenantDb(user.tenantId).aiThread.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: MAX_THREADS,
    select: { id: true, turns: true, updatedAt: true },
  });
  return rows.map((r) => ({ id: r.id, turns: r.turns, at: r.updatedAt.getTime() }));
}

export async function saveThread(user: CurrentUser, id: string, turns: unknown[]) {
  const kept = shrink(turns);
  if (!kept) return { error: "对话太大，没有同步" };
  const first = (kept as RawTurn[]).find((t) => t.role === "user")?.text ?? "";
  const title = first.replace(/\s+/g, " ").slice(0, 40) || "新对话";
  const db = tenantDb(user.tenantId);
  const own = await db.aiThread.findFirst({ where: { id }, select: { userId: true, summaryUpTo: true } });
  if (own && own.userId !== user.id) return { error: "无权访问" };
  const json = kept as Prisma.InputJsonValue;
  if (own) await db.aiThread.updateMany({ where: { id, userId: user.id }, data: { turns: json, title } });
  else
    await db.aiThread.create({ data: { id, tenantId: user.tenantId, userId: user.id, turns: json, title } }).catch(async (e: { code?: string }) => {
      // 同一段对话的两次保存同时到达：后到的改成更新
      if (e?.code !== "P2002") throw e;
      await db.aiThread.updateMany({ where: { id, userId: user.id }, data: { turns: json, title } });
    });
  // 超出的旧对话删掉
  const extra = await db.aiThread.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, skip: MAX_THREADS, select: { id: true } });
  if (extra.length) await db.aiThread.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
  return { ok: true as const, needsCompact: kept.length - KEEP - (own?.summaryUpTo ?? 0) >= COMPACT_AFTER };
}

export async function deleteThread(user: CurrentUser, id: string) {
  await tenantDb(user.tenantId).aiThread.deleteMany({ where: { id, userId: user.id } });
}

function plain(t: RawTurn) {
  if (t.role === "user") {
    const extra = [
      t.media?.length ? `（发了${t.media.map((m) => `${m.kind === "video" ? "视频" : "图片"}「${m.name}」`).join("、")}）` : "",
      t.snippet ? `（右键给 AI 看了「${t.snippet.label}」）` : "",
    ];
    return `用户：${[t.text ?? "", ...extra].filter(Boolean).join(" ").slice(0, 1500)}`;
  }
  const cards = (t.cards ?? []).map((c) => c.card?.title).filter(Boolean);
  return `AI：${(t.text ?? "").slice(0, 1500)}${cards.length ? `（起草了：${cards.join("、")}）` : ""}`;
}

/** 把最近 KEEP 轮之前、还没压缩的部分并进摘要 */
export async function compactThread(user: CurrentUser, id: string) {
  if (!aiConfigured()) return;
  const db = tenantDb(user.tenantId);
  const t = await db.aiThread.findFirst({ where: { id, userId: user.id } });
  if (!t) return;
  const turns = (Array.isArray(t.turns) ? t.turns : []) as RawTurn[];
  const upTo = turns.length - KEEP;
  if (upTo - t.summaryUpTo < COMPACT_AFTER) return;
  const fresh = turns.slice(t.summaryUpTo, upTo).map(plain).join("\n");
  const summary = await aiComplete({
    system:
      "你在给一段 CRM 助手和外贸业务员的对话写备忘摘要，供 AI 之后接着聊时参考。用简体中文，分条写：用户想做的事、已经查到的关键事实和数字（客户、金额、日期）、做过的决定和起草过的东西、还没做完的事。只写对话里出现过的内容，不超过 600 字。",
    messages: [{ role: "user", content: `${t.summary ? `之前的摘要：\n${t.summary}\n\n接下来的对话：\n` : ""}${fresh}` }],
    maxTokens: 900,
    temperature: 0.2,
  }).catch((e) => {
    console.error("[ai-threads] compact", e instanceof Error ? e.message : e);
    return null;
  });
  if (summary)
    await db.aiThread.updateMany({ where: { id, summaryUpTo: t.summaryUpTo }, data: { summary: summary.slice(0, 4000), summaryUpTo: upTo } });
}

/** 这段对话更早部分的摘要（模型只带最近几轮原文时用） */
export async function threadSummary(user: CurrentUser, id: string | undefined) {
  if (!id) return null;
  const t = await tenantDb(user.tenantId).aiThread.findFirst({ where: { id, userId: user.id }, select: { summary: true } });
  return t?.summary ?? null;
}
