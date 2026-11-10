import "server-only";
import { prisma, tenantDb } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { scopeOwnerIds } from "@/server/scope";
import { MetricError, canMetric, queryMetric, teamSummary } from "@/server/metrics";
import { aiToolStream, AiError, type ChatMessage, type ToolCall, type ToolSpec } from "@/server/ai";
import { countryName } from "@/lib/crm";
import { dateInput } from "@/lib/docs";
import { CHARTS, DIMENSIONS, METRICS, METRIC_DIMS, RANGES, isChart, isDim, isMetric, isRange, metricDef, rangeLabel } from "@/lib/metrics";
import { MAX_ITEMS, SIZES, WIDGETS, makeItem, sanitizeLayout, widgetDef, type CanvasItem, type CanvasLayout, type CanvasSize } from "@/lib/canvas";

/** 发给前端的事件（一行一个 JSON） */
export type CanvasEvent =
  | { t: "status"; text: string }
  | { t: "text"; text: string }
  | { t: "layout"; layout: CanvasLayout }
  | { t: "choice"; question: string; options: { label: string; detail?: string; reply: string }[] }
  | { t: "link"; label: string; href: string }
  | { t: "error"; message: string }
  | { t: "step" }
  | { t: "drop" }
  | { t: "done" };

export type CanvasTurn = { role: "user" | "assistant"; content: string };

const MAX_STEPS = 8;

const TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "search_entities",
      description: "按名字 / 公司 / 邮箱 / 电话搜索：客户公司、联系人、同事（员工）、WhatsApp 会话。找人时先调用它。",
      parameters: { type: "object", properties: { query: { type: "string", description: "要找的名字或关键词" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "customer_channels",
      description: "查某个客户能用的沟通渠道：已关联的 WhatsApp 会话、联系人邮箱",
      parameters: { type: "object", properties: { customerId: { type: "string" } }, required: ["customerId"] },
    },
  },
  {
    type: "function",
    function: {
      name: "query_metric",
      description: "查询业务指标的统计数据（用于分析、回答数字问题）。只能用指标库里的指标。",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string", enum: METRICS.map((m) => m.key) },
          by: { type: "string", enum: DIMENSIONS.map((d) => d.key) },
          range: { type: "string", enum: RANGES.map((r) => r.key) },
        },
        required: ["metric", "by", "range"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_summary",
      description: "团队每个成员的成交额、订单、报价、跟进、新客户、新询盘",
      parameters: { type: "object", properties: { range: { type: "string", enum: RANGES.map((r) => r.key) } }, required: ["range"] },
    },
  },
  {
    type: "function",
    function: {
      name: "update_canvas",
      description: "改工作台画布：clear=true 先清空再放；add 依次追加组件；remove / resize 按组件 id 操作现有组件。用户想看、打开、显示什么时调用。",
      parameters: {
        type: "object",
        properties: {
          clear: { type: "boolean", description: "是否先清空画布（新话题 true；用户说「也 / 一起 / 再加 / 旁边」时 false）" },
          add: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: WIDGETS.map((w) => w.type) },
                size: { type: "string", enum: [...SIZES] },
                params: { type: "object", description: "业务组件的参数，见组件目录", additionalProperties: { type: "string" } },
                position: { type: "string", enum: ["start", "end"], description: "放在最前还是最后，默认 end" },
              },
              required: ["type"],
            },
          },
          remove: { type: "array", items: { type: "string" }, description: "要移除的组件 id" },
          resize: {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" }, size: { type: "string", enum: [...SIZES] } }, required: ["id", "size"] },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_choice",
      description: "让用户从几个选项里选（找到多个同名的人、不确定是客户还是同事、要选沟通渠道时）。调用后本轮结束，等用户选择。",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "选项标题，如人名" },
                detail: { type: "string", description: "补充说明，如「客户 · 巴西 ACME」" },
                reply: { type: "string", description: "用户点选后代替用户发给你的话，必须带上需要的 id，如「选客户 Cindy Wang（customerId=xxx）」" },
              },
              required: ["label", "reply"],
            },
          },
        },
        required: ["question", "options"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_page",
      description: "给用户一个跳转按钮，打开 CRM 里的某个页面（画布上没有对应组件的功能用它）",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "站内路径，以 / 开头" }, label: { type: "string", description: "按钮文字" } },
        required: ["path", "label"],
      },
    },
  },
];

const PAGES = `/customers 客户列表；/customers/<id> 客户详情；/customers/pool 公海；/leads 询盘线索；/opportunities 商机看板；/quotations 报价单；/quotations/new 新建报价单；/orders 订单；/payments 回款；/products 产品；/mail 邮件；/mail/compose?to=<邮箱> 写邮件；/whatsapp WhatsApp；/marketing 邮件营销；/schedule 日程待办；/reports 团队数据；/settings 设置`;

function systemPrompt(user: CurrentUser, layout: CanvasLayout) {
  const sizeNote = "尺寸 s=4 列（侧边长条）· m=6 列 · l=8 列 · xl=12 列（全宽）；一行 12 列，按顺序自动排，放不下就换行";
  const catalog = WIDGETS.map((w) => {
    const ps = w.params?.length ? `；参数 ${w.params.map((p) => `${p.key}${p.optional ? "(可选)" : ""}=${p.desc}`).join("，")}` : "";
    return `- ${w.type}：${w.label}，${w.desc}；可用尺寸 ${w.sizes.join("/")}，默认 ${w.size}${ps}`;
  }).join("\n");
  const metrics = METRICS.filter((m) => canMetric(user, m.key))
    .map((m) => `- ${m.key}：${m.label}（${m.desc}），可按 ${METRIC_DIMS[m.key].join("/")}`)
    .join("\n");
  const current = layout.length
    ? layout.map((it) => `- [${it.id}] ${it.type} ${it.size}${it.params ? ` ${JSON.stringify(it.params)}` : ""}`).join("\n")
    : "（空）";
  return `你是「车车外贸 CRM」工作台里的 AI 助手，帮外贸业务员把需要的东西摆到工作台画布上、查数据、做分析。今天是 ${dateInput(user.timezone)}，用户是 ${user.name}（${user.roleName}）。

## 画布
${sizeNote}。
组件目录：
${catalog}

当前画布（[组件 id] 类型 尺寸 参数）：
${current}

## 指标库（query_metric 和 chart 组件只能用这些）
${metrics || "（该用户没有任何统计权限）"}
维度：${DIMENSIONS.map((d) => `${d.key}=${d.label}`).join("，")}
时间范围：${RANGES.map((r) => `${r.key}=${r.label}`).join("，")}
图表类型：${CHARTS.map((c) => `${c.key}=${c.label}`).join("，")}（按时间用 bar；按成员 / 国家排名用 hbar；看占比用 donut）

## 做事规则
1. 用户想看、打开、显示什么，就调用 update_canvas 把组件摆出来，不要只用文字描述。需要的数据可以在同一步里并行调用多个查询工具；摆组件尽量一次 update_canvas 全部放好；摆完后直接用文字收尾，不要再反复查询。新话题用 clear=true；用户说「也、一起、再加、旁边、顺便」时 clear=false，保留现有组件，必要时用 resize 把主组件缩小腾位置。
2. 布局要好看：一行凑满 12 列。主组件用 l，辅助的长条组件用 s 跟在它后面就会在右侧；两个并列用 m+m；团队和总览类用 xl。
3. 找人：先 search_entities。只有一个明确结果就直接用；同名多个、或分不清是客户还是同事时，用 ask_choice 让用户选，reply 里写上 id。
4. 用户想和某个客户「聊天 / 沟通 / 联系」但没说渠道：先 customer_channels。WhatsApp 和邮箱都有时用 ask_choice 问用哪个；只有一种就直接用，不要再问。WhatsApp → update_canvas(clear=true) 放 whatsapp(l) + followups(s)。只有邮件 → update_canvas(clear=true) 放 customer(m) + followups(m)，并 open_page 给「给 <名字> 写邮件」按钮（/mail/compose?to=邮箱）。都没有就放 customer 组件并说明没有联系方式。同事没有内部聊天功能，如实说明。
5. 数据分析：先用 query_metric / team_summary 拿到真实数字，再用 update_canvas 放 chart 或 team 组件（chart 的 params 写 metric、by、range、chart，可加 title 作为图表标题），然后用 2～4 句话（不超过 150 字）给出最关键的结论，引用具体数字。明细已经在画布组件里，不要再用文字或表格列一遍。绝不编造数字；没有数据就说没有。
6. 画布上没有组件的功能（新建报价单、看订单列表、设置等）用 open_page 给跳转按钮。可用页面：${PAGES}。
7. 发送消息、删除、群发、改权限、导出等操作你不能直接执行，请用户在对应组件或页面里自己操作。
8. 全程只用简体中文，简短直接（一般 1～3 句）。调用工具之前不要说「我来查一下」之类的话，直接调用。输出纯文本：不要 Markdown（不要 **加粗**、标题、表格、列表符号），不要用 emoji，不要输出 id，不要复述工具返回的原始数据。`;
}

type Ctx = { user: CurrentUser; layout: CanvasLayout; emit: (e: CanvasEvent) => void; stop: boolean };

const json = (x: unknown) => JSON.stringify(x);

async function searchEntities(user: CurrentUser, raw: string) {
  const q = raw.trim().slice(0, 60);
  if (!q) return { error: "query 不能为空" };
  const has = { contains: q, mode: "insensitive" as const };
  const db = tenantDb(user.tenantId);
  const ids = await scopeOwnerIds(user);
  const owned = ids ? { ownerId: { in: ids } } : { ownerId: { not: null } };
  const canCustomers = can(user, "customer.view");
  const wa = can(user, "whatsapp.use") ? await prisma.waAccount.findUnique({ where: { userId: user.id }, select: { id: true } }) : null;
  const [customers, contacts, employees, chats] = await Promise.all([
    canCustomers
      ? db.customer.findMany({
          where: { ...owned, OR: [{ name: has }, { domain: has }] },
          select: { id: true, name: true, country: true, owner: { select: { name: true } } },
          take: 6,
        })
      : [],
    canCustomers
      ? db.contact.findMany({
          where: { customer: owned, OR: [{ name: has }, { email: has }, { whatsapp: has }, { phone: has }] },
          select: { name: true, title: true, email: true, whatsapp: true, customer: { select: { id: true, name: true, country: true } } },
          take: 8,
        })
      : [],
    db.user.findMany({
      where: { status: "ACTIVE", OR: [{ name: has }, { email: has }] },
      select: { id: true, name: true, department: { select: { name: true } }, role: { select: { name: true } } },
      take: 5,
    }),
    wa
      ? db.waChat.findMany({
          where: { accountId: wa.id, OR: [{ name: has }, { phone: { contains: q.replace(/\D/g, "") || q } }, { customer: { name: has } }] },
          select: { id: true, name: true, phone: true, customer: { select: { id: true, name: true } } },
          orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
          take: 6,
        })
      : [],
  ]);
  return {
    customers: customers.map((c) => ({
      customerId: c.id,
      name: c.name,
      country: c.country ? countryName(c.country) : null,
      owner: c.owner?.name ?? null,
    })),
    contacts: contacts.map((c) => ({
      name: c.name,
      title: c.title,
      email: c.email,
      whatsapp: c.whatsapp,
      customerId: c.customer.id,
      company: c.customer.name,
      country: c.customer.country ? countryName(c.customer.country) : null,
    })),
    employees: employees.map((e) => ({
      userId: e.id,
      name: e.name,
      department: e.department?.name ?? null,
      role: e.role.name,
      isMe: e.id === user.id,
    })),
    whatsappChats: chats.map((c) => ({
      chatId: c.id,
      name: c.name || (c.phone ? `+${c.phone}` : null),
      customerId: c.customer?.id ?? null,
      company: c.customer?.name ?? null,
    })),
  };
}

async function customerChannels(user: CurrentUser, customerId: string) {
  const found = await getCustomerForUser(user, customerId);
  if (!found) return { error: "客户不存在或没有权限" };
  const db = tenantDb(user.tenantId);
  const wa = can(user, "whatsapp.use") ? await prisma.waAccount.findUnique({ where: { userId: user.id }, select: { id: true } }) : null;
  const [chats, contacts] = await Promise.all([
    wa ? db.waChat.findMany({ where: { accountId: wa.id, customerId }, select: { id: true, name: true, phone: true }, take: 5 }) : [],
    db.contact.findMany({ where: { customerId, email: { not: null } }, select: { name: true, email: true }, take: 5 }),
  ]);
  return {
    customer: { customerId, name: found.customer.name },
    whatsappChats: chats.map((c) => ({ chatId: c.id, name: c.name || (c.phone ? `+${c.phone}` : "WhatsApp") })),
    emails: contacts.map((c) => ({ name: c.name, email: c.email })),
    mailEnabled: can(user, "mail.use"),
    whatsappEnabled: !!wa,
  };
}

/** 校验一个要添加的组件，补上标题；有问题返回错误说明（给模型看） */
async function prepareItem(user: CurrentUser, raw: { type?: unknown; size?: unknown; params?: unknown }): Promise<CanvasItem | string> {
  const def = typeof raw.type === "string" ? widgetDef(raw.type) : undefined;
  if (!def) return `未知组件 ${String(raw.type)}`;
  const params: Record<string, string> = {};
  if (raw.params && typeof raw.params === "object") {
    for (const [k, v] of Object.entries(raw.params as Record<string, unknown>)) if (v != null && v !== "") params[k] = String(v).slice(0, 200);
  }
  const size = (def.sizes as string[]).includes(String(raw.size)) ? (raw.size as CanvasSize) : def.size;
  switch (def.type) {
    case "customer":
    case "followups": {
      const found = params.customerId ? await getCustomerForUser(user, params.customerId) : null;
      if (!found) return `${def.type} 需要有效的 customerId（找不到或没有权限）`;
      return makeItem(def.type, size, { customerId: found.customer.id, title: found.customer.name });
    }
    case "whatsapp": {
      if (!can(user, "whatsapp.use")) return "用户没有 WhatsApp 权限";
      const wa = await prisma.waAccount.findUnique({ where: { userId: user.id }, select: { id: true } });
      const chat = wa && params.chatId ? await tenantDb(user.tenantId).waChat.findFirst({ where: { id: params.chatId, accountId: wa.id } }) : null;
      if (!chat) return "whatsapp 需要有效的 chatId（用户自己的会话）";
      return makeItem("whatsapp", size, { chatId: chat.id, title: chat.name || (chat.phone ? `+${chat.phone}` : "WhatsApp") });
    }
    case "team": {
      if (!can(user, "report.view")) return "用户没有查看团队数据的权限";
      return makeItem("team", size, { range: isRange(params.range) ? params.range : "month" });
    }
    case "chart": {
      if (!isMetric(params.metric)) return "chart 需要 metric（指标库里的 key）";
      if (!canMetric(user, params.metric)) return `用户没有查看 ${params.metric} 的权限`;
      const by = isDim(params.by) ? params.by : "time";
      if (!METRIC_DIMS[params.metric].includes(by)) return `${params.metric} 不支持按 ${by}`;
      const range = isRange(params.range) ? params.range : "30d";
      const chart = isChart(params.chart) ? params.chart : by === "time" ? "bar" : "hbar";
      const byLabel = by === "time" ? "走势" : DIMENSIONS.find((d) => d.key === by)!.label;
      const title = params.title?.slice(0, 40) || `${rangeLabel(range)}${metricDef(params.metric)!.label}${byLabel}`;
      return makeItem("chart", size, { metric: params.metric, by, range, chart, title });
    }
    default:
      return makeItem(def.type, size);
  }
}

async function updateCanvas(ctx: Ctx, args: Record<string, unknown>) {
  let layout = args.clear === true ? [] : [...ctx.layout];
  const notes: string[] = [];
  for (const id of Array.isArray(args.remove) ? args.remove : []) layout = layout.filter((it) => it.id !== id);
  for (const r of Array.isArray(args.resize) ? (args.resize as { id?: string; size?: string }[]) : []) {
    const it = layout.find((x) => x.id === r.id);
    const def = it && widgetDef(it.type);
    if (!it || !def) notes.push(`找不到组件 ${r.id}`);
    else if (!(def.sizes as string[]).includes(String(r.size))) notes.push(`${it.type} 不支持尺寸 ${r.size}，可用 ${def.sizes.join("/")}`);
    else layout = layout.map((x) => (x.id === it.id ? { ...x, size: r.size as CanvasSize } : x));
  }
  const adds = Array.isArray(args.add) ? (args.add as { type?: unknown; size?: unknown; params?: unknown; position?: unknown }[]) : [];
  const front: CanvasItem[] = [];
  for (const a of adds) {
    const item = await prepareItem(ctx.user, a);
    if (typeof item === "string") {
      notes.push(item);
      continue;
    }
    const def = widgetDef(item.type)!;
    // 同一张概览卡片 / 同一个对象的组件已经在画布上：只改尺寸，不重复放
    const same = layout.find((x) => x.type === item.type && (!def.multi || JSON.stringify(x.params) === JSON.stringify(item.params)));
    if (same) {
      layout = layout.map((x) => (x === same ? { ...x, size: item.size } : x));
      continue;
    }
    if (a.position === "start") front.push(item);
    else layout.push(item);
  }
  layout = sanitizeLayout([...front, ...layout]).slice(0, MAX_ITEMS);
  ctx.layout = layout;
  ctx.emit({ t: "layout", layout });
  return { ok: notes.length === 0, notes, canvas: layout.map((it) => ({ id: it.id, type: it.type, size: it.size, title: it.params?.title })) };
}

const STATUS: Record<string, (a: Record<string, unknown>) => string> = {
  search_entities: (a) => `正在查找「${String(a.query ?? "")}」…`,
  customer_channels: () => "正在查看沟通渠道…",
  query_metric: () => "正在统计数据…",
  team_summary: () => "正在汇总团队数据…",
  update_canvas: () => "正在摆放组件…",
};

async function runTool(ctx: Ctx, call: ToolCall): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
  } catch {
    return { error: "参数不是合法 JSON" };
  }
  const st = STATUS[call.function.name];
  if (st) ctx.emit({ t: "status", text: st(args) });
  const { user } = ctx;
  try {
    switch (call.function.name) {
      case "search_entities":
        return await searchEntities(user, String(args.query ?? ""));
      case "customer_channels":
        return await customerChannels(user, String(args.customerId ?? ""));
      case "query_metric": {
        if (!isMetric(args.metric) || !isDim(args.by) || !isRange(args.range)) return { error: "metric / by / range 取值无效" };
        const r = await queryMetric(user, args.metric, args.by, args.range);
        return {
          title: r.title,
          unit: r.unit === "cny" ? "人民币元" : "个",
          total: Math.round(r.total),
          points: r.points.slice(0, 40).map((p) => [p.label, Math.round(p.value)]),
        };
      }
      case "team_summary": {
        const r = await teamSummary(user, isRange(args.range) ? args.range : "month");
        return {
          from: r.from,
          to: r.to,
          members: r.rows.map((x) => ({
            name: x.name,
            deal: Math.round(x.deal),
            orders: x.orders,
            quotes: x.quotes,
            followups: x.followups,
            customers: x.customers,
            leads: x.leads,
          })),
        };
      }
      case "update_canvas":
        return await updateCanvas(ctx, args);
      case "ask_choice": {
        const options = (Array.isArray(args.options) ? args.options : [])
          .slice(0, 8)
          .map((o: { label?: unknown; detail?: unknown; reply?: unknown }) => ({
            label: String(o.label ?? "").slice(0, 60),
            detail: o.detail ? String(o.detail).slice(0, 80) : undefined,
            reply: String(o.reply ?? o.label ?? "").slice(0, 300),
          }))
          .filter((o) => o.label && o.reply);
        if (!options.length) return { error: "options 不能为空" };
        ctx.emit({ t: "choice", question: String(args.question ?? "请选择").slice(0, 120), options });
        ctx.stop = true;
        return { ok: true, note: "已展示选项，等待用户选择" };
      }
      case "open_page": {
        const path = String(args.path ?? "");
        if (!path.startsWith("/") || path.startsWith("//")) return { error: "path 必须是站内路径" };
        ctx.emit({ t: "link", label: String(args.label ?? "打开").slice(0, 30), href: path.slice(0, 300) });
        return { ok: true };
      }
      default:
        return { error: `未知工具 ${call.function.name}` };
    }
  } catch (e) {
    if (e instanceof MetricError) return { error: e.message };
    throw e;
  }
}

/** 一轮对话：模型可以多步调工具（查数据 → 摆组件 → 总结），事件实时推给前端 */
export async function runCanvasTurn(
  user: CurrentUser,
  input: { message: string; history: CanvasTurn[]; layout: unknown },
  emit: (e: CanvasEvent) => void,
  signal?: AbortSignal,
) {
  const ctx: Ctx = { user, layout: sanitizeLayout(input.layout), emit, stop: false };
  const messages: ChatMessage[] = [
    ...input.history.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }) as ChatMessage),
    { role: "user", content: input.message.slice(0, 2000) },
  ];
  try {
    for (let step = 0; step < MAX_STEPS && !ctx.stop; step++) {
      if (signal?.aborted) return;
      let text = "";
      let calls: ToolCall[] = [];
      emit({ t: "step" });
      // 系统提示每步重建：画布可能刚被改过
      for await (const ev of aiToolStream({
        system: systemPrompt(user, ctx.layout),
        messages,
        tools: TOOLS,
        // 最后一步不许再调工具，必须用文字收尾
        toolChoice: step === MAX_STEPS - 1 ? "none" : "auto",
        maxTokens: 1500,
        temperature: 0.3,
      })) {
        if (ev.type === "text") {
          text += ev.text;
          emit({ t: "text", text: ev.text });
        } else calls = ev.calls;
      }
      if (!calls.length) break;
      // 调工具前的过渡话（「我来查一下」）不留在界面上
      if (text) emit({ t: "drop" });
      messages.push({ role: "assistant", content: text || null, tool_calls: calls });
      for (const call of calls) {
        const result = await runTool(ctx, call);
        messages.push({ role: "tool", tool_call_id: call.id, content: json(result).slice(0, 12_000) });
      }
    }
  } catch (e) {
    emit({ t: "error", message: e instanceof AiError ? e.message : "AI 出错了，请重试" });
    if (!(e instanceof AiError)) console.error("[canvas-ai]", e);
  }
  emit({ t: "done" });
}
