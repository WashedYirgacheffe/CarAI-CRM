import "server-only";
import { tenantDb } from "@/server/db";
import type { CurrentUser } from "@/server/auth";
import { aiConfigured, aiJson, clip } from "@/server/ai";
import { remember, visibleWhere, type MemoryCtx } from "@/server/ai-memory";

/*
 * 一轮对话结束后：用户像是在交代规矩、纠正 AI、说偏好，而 AI 当时没记，就在后台补记。
 * 普通的问答不额外调用模型。（从邮件 / WhatsApp 提炼客户记忆在 ai-extract.ts）
 */

// ── 对话结束后补记 ──

/** 像是在交代长期的事：规矩、纠正、偏好、自我介绍 */
const CUE =
  /(以后|今后|往后|每次|总是|一律|统一|默认|一般都|通常|别再|不要再|不要|别用|别给|记住|记得|记一下|我习惯|我喜欢|我不喜欢|我负责|我们公司|我们一般|我们家|应该是|不对|错了|搞错|改成|其实是|always|never|from now on|prefer)/i;

export type TurnDigest = {
  threadId?: string;
  message: string;
  userText: string;
  reply: string;
  outside: boolean;
  /** 这一轮 AI 已经调过 remember / update_memory / forget */
  touched: boolean;
  customerId: string | null;
};

const LEARN_SYSTEM = `你在回顾 CRM 助手和外贸业务员刚结束的一轮对话，判断里面有没有以后还用得上、应该记住的东西：
- 用户交代的做事规矩、偏好、纠正（「以后…」「别再…」「不对，应该…」）；
- 用户告诉你的关于自己的长期事实（负责的市场、常用的贸易条款）；
- 用户告诉你的关于当前客户的长期事实（决策人、付款方式、忌讳）。
不要记：一次性的请求、只对这次有效的内容、AI 自己说的话、已经记着的。
basis：用户在对话里亲口说的写 user_said；你从 AI 的回答或数据里推断的写 found（规则 rule 只能是 user_said）。
scope：只关于用户自己的 me；关于当前客户的 customer（只有给了当前客户时才能用）；用户明确说全公司都要这样的 team。
只返回 JSON：{"memories":[{"kind":"fact|preference|rule|decision|howto","title":"一句话","content":"细节","scope":"me|customer|team","basis":"user_said|found","keywords":"中英文检索词，逗号隔开"}]}，最多 3 条，没有就空数组。宁可不记，不要乱记。`;

/** 一轮对话结束后：值得学才跑一次模型，记下 AI 当时漏记的 */
export async function learnFromTurn(user: CurrentUser, t: TurnDigest) {
  if (!aiConfigured() || t.touched || t.message.trim().length < 6 || !CUE.test(t.message)) return 0;
  const db = tenantDb(user.tenantId);
  const [known, customer] = await Promise.all([
    db.aiMemory.findMany({
      where: { status: { in: ["active", "proposed"] }, AND: [await visibleWhere(user)] },
      orderBy: { updatedAt: "desc" },
      take: 60,
      select: { title: true },
    }),
    t.customerId ? db.customer.findFirst({ where: { id: t.customerId }, select: { name: true } }) : null,
  ]);
  let out: { kind?: string; title?: string; content?: string; keywords?: string; scope?: string; basis?: string }[] = [];
  try {
    const r = await aiJson<{ memories?: typeof out }>({
      system: LEARN_SYSTEM,
      messages: [
        {
          role: "user",
          content: `当前客户：${customer?.name ?? "（无）"}\n已经记着的：${known.map((k) => k.title).join("；") || "（无）"}\n\n用户最近说的：\n${clip(t.userText, 2500)}\n\nAI 的回答：\n${clip(t.reply, 2000)}`,
        },
      ],
      maxTokens: 600,
      temperature: 0.1,
      timeoutMs: 30_000,
    });
    out = Array.isArray(r.memories) ? r.memories.slice(0, 3) : [];
  } catch (e) {
    console.error("[ai-learn] turn", e instanceof Error ? e.message : e);
    return 0;
  }
  const ctx: MemoryCtx = { user, threadId: t.threadId, outside: t.outside, userText: t.userText };
  let n = 0;
  for (const x of out) {
    if (!x?.title) continue;
    // 客户的事没有当前客户就不记，免得挂到用户自己名下
    if (x.scope === "customer" && !t.customerId) continue;
    const scope = String(x.scope ?? "me");
    const r = await remember(ctx, {
      kind: String(x.kind ?? "fact"),
      title: String(x.title),
      content: typeof x.content === "string" ? x.content : undefined,
      scope,
      customerId: t.customerId ?? undefined,
      basis: x.basis === "user_said" ? "user_said" : "found",
      keywords: typeof x.keywords === "string" ? x.keywords : undefined,
      origin: `learn:${t.threadId ?? ""}`,
    });
    if ("ok" in r && r.op !== "merged") n++;
  }
  return n;
}
