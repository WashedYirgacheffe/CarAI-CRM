import "server-only";
import { aiToolStream, AiError, type ChatMessage, type ToolCall, type ToolSpec } from "@/server/ai";
import type { CurrentUser } from "@/server/auth";
import { customerPrefill, findCustomers, findOrders, findProducts, orderPrefill } from "@/server/trade-docs";
import {
  CERT_PRESETS,
  DOC_TYPES,
  FIELDS,
  FIELD_KEYS,
  ITEM_COLS,
  TEMPLATES,
  applyPatch,
  fieldLabel,
  isDocType,
  isFieldKey,
  missingFields,
  totals,
  type DocData,
  type DocPatch,
  type DocType,
  type FieldKey,
} from "@/lib/trade-docs/schema";

/*
 * AI 单据工作台的对话引擎。
 * - 模型（默认 DeepSeek V4.1 Flash）开高强度思考：核对 L/C 条款、合计、缺什么，都要推理。
 * - AI 不直接写单据文字，只通过 update_document 填字段；版式由 doc-render.tsx 按样本固定，所以格式不会走样。
 * - 缺资料时调用 ask_user 发一张填写卡片，这一轮就停下等用户填。
 */

const MODEL = process.env.AI_DOC_MODEL || undefined;
const MAX_STEPS = 8;

export type DocTurnInput = {
  type: DocType | null;
  data: DocData;
  message: string;
  history: { role: "user" | "assistant"; text: string }[];
};

export type CardField = { key: string; label: string; kind: string; options?: string[]; placeholder?: string; required?: boolean; value?: string };
export type DocCard = { title: string; note?: string; fields: CardField[] };

export type DocEvent =
  | { t: "thinking"; text: string }
  | { t: "text"; text: string }
  | { t: "status"; text: string }
  | { t: "type"; type: DocType }
  | { t: "patch"; patch: DocPatch }
  | { t: "card"; card: DocCard }
  | { t: "error"; message: string }
  | { t: "done" };

// ── 工具 ──

const fieldProps = Object.fromEntries(
  FIELD_KEYS.map((k) => {
    const f = FIELDS[k] as { label: string; kind: string; options?: readonly string[] };
    return [k, { type: "string", description: `${f.label}${f.kind === "date" ? "（YYYY-MM-DD）" : ""}` }];
  }),
);
const itemProps = Object.fromEntries(Object.entries(ITEM_COLS).map(([k, l]) => [k, { type: "string", description: l }]));

const TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "update_document",
      description:
        "填写或修改当前单据。只传要改的字段；传空字符串表示清空。items / charges 一旦传就是整张表替换，必须传完整列表。type 用来新建或切换单据类型（数据会保留）。",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...DOC_TYPES], description: "单据类型" },
          set: { type: "object", properties: fieldProps, additionalProperties: false },
          items: { type: "array", items: { type: "object", properties: itemProps, additionalProperties: false }, description: "产品明细（完整列表）" },
          charges: {
            type: "array",
            items: { type: "object", properties: { label: { type: "string" }, amount: { type: "string" } } },
            description: "附加费用行（FREIGHT、EXPRESS FEE…；折扣用负数），完整列表",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "缺少必需信息、又查不到时，给用户发一张填写卡片（一次问全，最多 8 项）。调用后这一轮结束，等用户填完再继续。能给选项的一定给 options 让用户点选。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "卡片标题，如「还差这些信息」" },
          note: { type: "string", description: "一句话说明为什么要这些" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: `字段名，必须是单据字段之一（${FIELD_KEYS.join(", ")}）；问产品明细用 items_text` },
                label: { type: "string", description: "给用户看的中文标签" },
                options: { type: "array", items: { type: "string" }, description: "可点选的候选值" },
                placeholder: { type: "string" },
                required: { type: "boolean" },
                value: { type: "string", description: "你推测的默认值（用户可改）" },
              },
              required: ["key"],
            },
          },
        },
        required: ["title", "fields"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_orders",
      description: "在 CRM 里按订单号或买方名称找销售订单",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "load_order",
      description: "把一张 CRM 订单（含买方、条款、明细、产品装箱资料、最近一票物流的船名提单柜号）一次性带入当前单据",
      parameters: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "find_customers",
      description: "在 CRM 里按名称找客户",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "load_customer",
      description: "把 CRM 客户的名称、地址、联系人带入买方信息",
      parameters: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "find_products",
      description: "在产品库里找产品（货号、中英文名、规格、单价、HS 编码、每箱数量、箱规、每箱毛净重、每箱体积）",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  },
];

const STATUS: Record<string, string> = {
  update_document: "正在填写单据",
  ask_user: "整理需要你补充的信息",
  find_orders: "在 CRM 里找订单",
  load_order: "带入订单数据",
  find_customers: "在 CRM 里找客户",
  load_customer: "带入客户信息",
  find_products: "查产品库",
};

// ── 提示词 ──

const RULES = `
## 你的工作方式
1. 你是「车车 AI」的单据专员，精通 UCP600、ISBP745、Incoterms 2020 和中国出口单证实务。
2. 单据的版式由系统按公司样本固定渲染。你**只能通过 update_document 填字段**，绝不在回复里把单据写成文字或表格。
3. 单据内容一律英文大写（sellerNameCn 除外），日期一律 YYYY-MM-DD，数字不带千分位和币种符号。
4. **不编造事实**：L/C 号、提单号、船名、柜号、重量、体积、价格、数量、地址等都必须来自用户、CRM 或上下文。
   可以合理默认的：origin=CHINA；marks 没有时 N/M；packageUnit=CARTONS；CFR/CIF/CPT/CIP/DAP/DDP 运费 FREIGHT PREPAID，EXW/FOB/FCA 为 FREIGHT COLLECT；
   单据日期默认今天；L/C 项下 consignee 默认 TO THE ORDER OF + 开证行全称地址，notifyParty 默认申请人全称地址；汇票 drawee 默认开证行、draftTenor 照 42C。
   用了默认值要在回复里点明「按惯例默认了 xx，请核对」。
5. 缺必填信息时：先想能不能从 CRM 查到（订单号、客户名 → find_orders / load_order / find_customers / load_customer；产品 → find_products）；
   查不到再用 **ask_user** 一次问全（把同一类缺项放一张卡片，能给选项就给选项，能猜默认值就填 value）。不要在文字里罗列问题让用户打字回答。
6. 用户贴来 L/C（MT700）原文时，逐条解析并填入：
   20→lcNo；31C→lcDate；50→buyerName/buyerAddress（申请人）；59→核对卖方；32B→currency 与金额上限；42C→draftTenor；42A/42D→drawee；
   开证行（报文 Sender / 51A）→issuingBank（名称 + 地址）；43P/43T→partialShipment/transhipment；44E/44F→loadingPort/dischargePort；44C→latestShipDate；
   45A→goodsDesc（照抄品名规格，不改一个字）、tradeTerm/tradePlace、单价数量；
   45A 末尾 / 47A 要求每份单据显示的内容（如 "CFR ... AS PER PROFORMA INVOICE NO. ... OF THE BENEFICIARY"、"LC NO.:... DATE OF ISSUE:..."、HS / IRC / TIN / BIN）→ 合成 docRemark；
   46A 列出的单据 → 在回复里列出整套要做的单据清单（CI、PL、B/L、CO、各张受益人证明、装运通知、汇票），并说明每张的份数要求。
   每一项受益人证明（CERTIFICATE）单独一张，certText 把 L/C 条款改写成已完成的陈述（MUST BE → HAS BEEN / ARE）。
7. 交叉核对并主动提示不符点：金额不超 L/C、数量与单价乘积、发票日期 ≤ 提单日 ≤ 最迟装运日、CI/PL/提单/产地证的品名件数重量一致、
   L/C 要求的号码（L/C NO.、HS CODE、TIN、BIN 等）是否出现在需要的单据上。
8. 修改 items 时必须传完整明细列表；数量、单价、箱数、重量、体积按行填，合计由系统算，不要另填合计（除非用户给了整票总数而没有分行数据，则填 totalPackages / totalNw / totalGw / totalCbm）。
9. 用户没说要做哪种单据时，根据描述判断并用 update_document 的 type 设置；判断不了就 ask_user，用 options 列出单据类型名称。
10. 回复用简体中文，简短：做了什么 → 用了哪些默认值 → 还缺什么 / 有什么不符点 → 下一步建议（比如「要不要接着出 PL 和提单补料」）。
`.trim();

function catalog() {
  return DOC_TYPES.map((t) => `- ${t}：${TEMPLATES[t].name}（${TEMPLATES[t].en}）——${TEMPLATES[t].desc}`).join("\n");
}

function fieldDictionary() {
  return FIELD_KEYS.map((k) => {
    const f = FIELDS[k] as { label: string; kind: string; options?: readonly string[]; hint?: string };
    const opts = f.options && k !== "certText" ? ` 可选：${f.options.join(" / ")}` : "";
    return `- ${k}：${f.label}${f.hint ? `（${f.hint}）` : ""}${opts}`;
  }).join("\n");
}

function compactData(d: DocData) {
  const o: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) if (d[k]) o[k] = d[k];
  if (d.items.length) o.items = d.items;
  if (d.charges.length) o.charges = d.charges;
  return JSON.stringify(o);
}

function systemPrompt(user: CurrentUser, type: DocType | null, data: DocData) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const t = type ? TEMPLATES[type] : null;
  const missing = type ? missingFields(type, data) : [];
  const tt = totals(data);
  return `${RULES}

## 可做的单据类型
${catalog()}

## 单据字段（update_document.set 的键）
${fieldDictionary()}
明细 items 每行的键：${Object.entries(ITEM_COLS)
    .map(([k, l]) => `${k}(${l})`)
    .join("、")}
受益人证明常用内容：
${CERT_PRESETS.map((s) => `- ${s}`).join("\n")}

## 当前状态
今天：${today}；操作人：${user.name}（${user.tenantName}）
当前单据类型：${t ? `${type} ${t.name}（${t.en}）` : "还没选"}
${
  t
    ? `这种单据的版式要点（照公司样本）：
${t.rules.map((r) => `- ${r}`).join("\n")}
必填：${t.required.map(fieldLabel).join("、")}
还缺：${missing.length ? missing.map(fieldLabel).join("、") : "无"}`
    : ""
}
系统算出的合计：金额 ${tt.total || 0}，数量 ${tt.qty || 0}${tt.qtyUnit ? ` ${tt.qtyUnit}` : ""}，件数 ${tt.packages || 0}，净重 ${tt.nw || 0}，毛重 ${tt.gw || 0}，体积 ${tt.cbm || 0}
当前单据数据（JSON）：
${compactData(data)}`;
}

// ── 执行 ──

type Ctx = { user: CurrentUser; type: DocType | null; data: DocData; emit: (e: DocEvent) => void; card: DocCard | null };

const parseArgs = (call: ToolCall) => {
  try {
    return JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
};

function setType(ctx: Ctx, type: unknown) {
  if (isDocType(type) && type !== ctx.type) {
    ctx.type = type;
    ctx.emit({ t: "type", type });
  }
}

function patchDoc(ctx: Ctx, patch: DocPatch) {
  ctx.data = applyPatch(ctx.data, patch);
  ctx.emit({ t: "patch", patch });
}

/** 带入数据时：表里已经有的字段（用户填过的）不被空值覆盖 */
function prefillPatch(p: Partial<DocData>): DocPatch {
  const { items, charges, ...rest } = p;
  return { set: rest, ...(items?.length ? { items } : {}), ...(charges?.length ? { charges } : {}) };
}

async function runTool(ctx: Ctx, call: ToolCall): Promise<unknown> {
  const a = parseArgs(call);
  const q = typeof a.query === "string" ? a.query : "";
  switch (call.function.name) {
    case "update_document": {
      setType(ctx, a.type);
      const set = (a.set && typeof a.set === "object" ? a.set : {}) as Record<string, unknown>;
      const unknown = Object.keys(set).filter((k) => !isFieldKey(k));
      patchDoc(ctx, { set, items: a.items, charges: a.charges });
      const missing = ctx.type ? missingFields(ctx.type, ctx.data).map(fieldLabel) : [];
      return { ok: true, type: ctx.type, unknownFields: unknown.length ? unknown : undefined, stillMissing: missing, totals: totals(ctx.data) };
    }
    case "ask_user": {
      const fields = (Array.isArray(a.fields) ? a.fields : [])
        .slice(0, 10)
        .map((raw): CardField | null => {
          const f = (raw ?? {}) as Record<string, unknown>;
          const key = String(f.key ?? "");
          const def = isFieldKey(key) ? (FIELDS[key] as { label: string; kind: string; options?: readonly string[]; placeholder?: string }) : null;
          if (!def && key !== "items_text" && key !== "doc_type") return null;
          const options = Array.isArray(f.options) ? f.options.map(String).slice(0, 12) : def?.options && key !== "certText" ? [...def.options] : undefined;
          return {
            key,
            label: String(f.label || def?.label || (key === "items_text" ? "产品明细" : "单据类型")),
            kind: key === "items_text" ? "textarea" : (def?.kind ?? "text"),
            options: options?.length ? options : undefined,
            placeholder: typeof f.placeholder === "string" ? f.placeholder : (def?.placeholder ?? (key === "items_text" ? "每行一个产品：品名 / 规格 / 数量 / 单价 / 箱数 / 毛重 / 体积" : undefined)),
            required: f.required === true,
            value: typeof f.value === "string" ? f.value : ctx.data[key as FieldKey],
          };
        })
        .filter((f): f is CardField => !!f);
      if (!fields.length) return { ok: false, error: "fields 里没有合法字段名" };
      ctx.card = { title: String(a.title || "还差这些信息"), note: typeof a.note === "string" ? a.note : undefined, fields };
      ctx.emit({ t: "card", card: ctx.card });
      return { ok: true, note: "卡片已发给用户，这一轮到此为止" };
    }
    case "find_orders":
      return { orders: await findOrders(ctx.user, q) };
    case "load_order": {
      const p = await orderPrefill(ctx.user, String(a.order_id ?? ""));
      if (!p) return { ok: false, error: "找不到这张订单，或没有权限" };
      patchDoc(ctx, prefillPatch(p));
      return { ok: true, loaded: Object.keys(p), stillMissing: ctx.type ? missingFields(ctx.type, ctx.data).map(fieldLabel) : [] };
    }
    case "find_customers":
      return { customers: await findCustomers(ctx.user, q) };
    case "load_customer": {
      const p = await customerPrefill(ctx.user, String(a.customer_id ?? ""));
      if (!p) return { ok: false, error: "找不到这个客户，或没有权限" };
      patchDoc(ctx, prefillPatch(p));
      return { ok: true, loaded: p };
    }
    case "find_products":
      return { products: await findProducts(ctx.user, q) };
    default:
      return { ok: false, error: `没有这个工具：${call.function.name}` };
  }
}

export async function runDocTurn(user: CurrentUser, input: DocTurnInput, emit: (e: DocEvent) => void, signal?: AbortSignal) {
  const ctx: Ctx = { user, type: input.type, data: input.data, emit, card: null };
  const messages: ChatMessage[] = [
    ...input.history.slice(-16).map((m) => ({ role: m.role, content: m.text }) as ChatMessage),
    { role: "user", content: input.message },
  ];
  try {
    for (let step = 0; step < MAX_STEPS && !ctx.card; step++) {
      if (signal?.aborted) return;
      let text = "";
      let calls: ToolCall[] = [];
      let reasoning = "";
      for await (const ev of aiToolStream({
        system: systemPrompt(user, ctx.type, ctx.data),
        messages,
        tools: TOOLS,
        toolChoice: step === MAX_STEPS - 1 ? "none" : "auto",
        thinking: "high",
        model: MODEL,
        maxTokens: 16_000,
        timeoutMs: 240_000,
      })) {
        if (signal?.aborted) return;
        if (ev.type === "reasoning") emit({ t: "thinking", text: ev.text });
        else if (ev.type === "text") {
          text += ev.text;
          emit({ t: "text", text: ev.text });
        } else {
          calls = ev.calls;
          reasoning = ev.reasoning;
        }
      }
      if (!calls.length) break;
      if (text) emit({ t: "text", text: "\n\n" });
      messages.push({ role: "assistant", content: text || null, tool_calls: calls, ...(reasoning ? { reasoning_content: reasoning } : {}) });
      for (const call of calls) {
        emit({ t: "status", text: STATUS[call.function.name] ?? "处理中" });
        const result = await runTool(ctx, call).catch((e) => ({ ok: false, error: (e as Error).message }));
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12_000) });
      }
    }
  } catch (e) {
    console.error("[doc-ai]", e);
    emit({ t: "error", message: e instanceof AiError ? e.message : "AI 出错了，请重试" });
  }
  emit({ t: "done" });
}
