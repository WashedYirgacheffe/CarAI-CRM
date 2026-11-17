import "server-only";
import { tenantDb } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { inScope, scopeMembers, scopeOwnerIds } from "@/server/scope";
import {
  countryName,
  CURRENCIES,
  LEAD_INVALID_REASONS,
  LEAD_STATUSES,
} from "@/lib/crm";
import { ORDER_STATUSES, QUOTATION_STATUSES, formatAmount } from "@/lib/docs";
import type { ActionCard, AiActionKind } from "@/lib/ai-actions";

/*
 * AI 起草的改数据 / 删除类操作：这里只校验参数、把要改的内容摆到卡片上；
 * 用户确认后由 dashboard/ai-actions.ts 交给原有的业务动作执行，权限和页面上手动操作一样。
 */

type P = Record<string, unknown>;
const str = (v: unknown, max = 5000) =>
  v == null ? "" : String(v).trim().slice(0, max);
const has = (p: P, k: string) => k in p && p[k] != null;
const idList = (v: unknown, max = 200) =>
  (Array.isArray(v) ? v : str(v).split(","))
    .map((x) => str(x, 40))
    .filter(Boolean)
    .slice(0, max);
const nameList = (list: { name: string }[], unit = "个") =>
  list
    .slice(0, 8)
    .map((c) => c.name)
    .join("、") + (list.length > 8 ? ` 等 ${list.length} ${unit}` : "");
const yes = (v: unknown) => v === true || v === "true" || v === "on" || v === 1;

const CUSTOMER_TEXT: Record<string, { label: string; max: number }> = {
  name: { label: "名称", max: 200 },
  country: { label: "国家", max: 2 },
  website: { label: "官网", max: 300 },
  address: { label: "地址", max: 500 },
  source: { label: "来源", max: 100 },
  customerType: { label: "客户类型", max: 100 },
  mainProducts: { label: "主营产品", max: 500 },
  annualVolume: { label: "年采购额", max: 100 },
  remark: { label: "备注", max: 5000 },
};

function countryCode(v: string): string | null {
  const c = v.trim().toUpperCase();
  if (!c) return "";
  return c.length === 2 && countryName(c) !== c ? c : null;
}

/** 按名称找客户状态 / 分组；找不到时返回给模型看的可选项 */
async function refByName(
  user: CurrentUser,
  what: "status" | "group",
  name: string,
) {
  const db = tenantDb(user.tenantId);
  const rows =
    what === "status"
      ? await db.customerStatus.findMany({
          select: { id: true, name: true },
          orderBy: { sort: "asc" },
        })
      : await db.customerGroup.findMany({
          select: { id: true, name: true },
          orderBy: { sort: "asc" },
        });
  const hit =
    rows.find((r) => r.name === name) ??
    rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
  return (
    hit ??
    `没有「${name}」这个${what === "status" ? "客户状态" : "分组"}，可选：${rows.map((r) => r.name).join("、") || "（还没有设置）"}`
  );
}

/** 数据范围内、有负责人的客户 */
async function scopedCustomers(user: CurrentUser, ids: string[]) {
  if (!ids.length) return [];
  const scope = await scopeOwnerIds(user);
  return tenantDb(user.tenantId).customer.findMany({
    where: {
      id: { in: ids },
      ...(scope ? { ownerId: { in: scope } } : { ownerId: { not: null } }),
    },
    select: { id: true, name: true, owner: { select: { name: true } } },
  });
}

async function workableLead(user: CurrentUser, id: string) {
  if (!id) return null;
  const lead = await tenantDb(user.tenantId).lead.findFirst({ where: { id } });
  if (!lead) return null;
  return !lead.ownerId || (await inScope(user, lead.ownerId)) ? lead : null;
}
const leadName = (l: {
  companyName: string | null;
  contactName: string | null;
  email: string | null;
}) => l.companyName || l.contactName || l.email || "这条线索";

export async function prepareDataAction(
  user: CurrentUser,
  kind: AiActionKind,
  p: P,
): Promise<ActionCard | string> {
  const db = tenantDb(user.tenantId);
  switch (kind) {
    // ── 客户 ──
    case "create_customer": {
      if (!can(user, "customer.create")) return "用户没有新建客户的权限";
      const params: Record<string, string> = {};
      const fields: ActionCard["fields"] = [];
      for (const [k, { label, max }] of Object.entries(CUSTOMER_TEXT)) {
        let v = str(p[k], max);
        if (k === "country" && v) {
          const c = countryCode(str(p[k], 10));
          if (c == null) return "country 用两位国家代码，如 US、DE";
          v = c;
        }
        if (!v) continue;
        params[k] = v;
        if (k !== "remark")
          fields.push({ label, value: k === "country" ? countryName(v) : v });
      }
      if (str(params.name).length < 2) return "name（客户名称）至少 2 个字";
      if (has(p, "star"))
        params.star = String(
          Math.max(0, Math.min(5, Math.round(Number(p.star)) || 0)),
        );
      if (str(p.status)) {
        const s = await refByName(user, "status", str(p.status, 50));
        if (typeof s === "string") return s;
        params.statusId = s.id;
        fields.push({ label: "状态", value: s.name });
      }
      if (str(p.group)) {
        const g = await refByName(user, "group", str(p.group, 50));
        if (typeof g === "string") return g;
        params.groupId = g.id;
        fields.push({ label: "分组", value: g.name });
      }
      const contact: Record<string, string> = {
        contactName: str(p.contactName, 100),
        contactTitle: str(p.contactTitle, 100),
        contactEmail: str(p.contactEmail, 200),
        contactPhone: str(p.contactPhone, 50),
        contactWhatsapp: str(p.contactWhatsapp, 50),
      };
      for (const [k, v] of Object.entries(contact)) if (v) params[k] = v;
      const who = [
        contact.contactName,
        contact.contactTitle,
        contact.contactEmail,
        contact.contactWhatsapp || contact.contactPhone,
      ].filter(Boolean);
      if (who.length) fields.push({ label: "联系人", value: who.join(" · ") });
      return {
        kind,
        title: `新建客户 ${params.name}`,
        fields,
        edit: [
          { key: "name", label: "客户名称" },
          { key: "remark", label: "备注", multiline: true },
        ],
        params,
        confirm: "创建客户",
      };
    }
    case "update_customer": {
      const found = await getCustomerForUser(user, str(p.customerId));
      if (!found?.access.edit)
        return "customerId 无效，或只能改自己（或下属）负责的客户";
      const c = found.customer;
      const cur: Record<string, string> = {
        name: c.name,
        country: c.country ?? "",
        website: c.website ?? "",
        address: c.address ?? "",
        source: c.source ?? "",
        customerType: c.customerType ?? "",
        mainProducts: c.mainProducts ?? "",
        annualVolume: c.annualVolume ?? "",
        remark: c.remark ?? "",
        statusId: c.statusId ?? "",
        groupId: c.groupId ?? "",
        star: String(c.star),
        tags: c.tags.join(","),
      };
      const next = { ...cur };
      const changes: ActionCard["fields"] = [];
      for (const [k, { label, max }] of Object.entries(CUSTOMER_TEXT)) {
        if (!has(p, k)) continue;
        let v = str(p[k], max);
        if (k === "country") {
          const code = countryCode(str(p[k], 10));
          if (code == null)
            return "country 用两位国家代码，如 US、DE（清空就传空字符串）";
          v = code;
        }
        if (k === "remark" && yes(p.appendRemark) && v && cur.remark)
          v = `${cur.remark}\n${v}`.slice(0, 5000);
        if (v === cur[k]) continue;
        if (k === "name" && v.length < 2) return "客户名称至少 2 个字";
        next[k] = v;
        changes.push({
          label,
          value: v ? (k === "country" ? countryName(v) : v) : "（清空）",
        });
      }
      if (has(p, "star") && str(p.star) !== "") {
        const s = Math.round(Number(p.star));
        if (!(s >= 0 && s <= 5)) return "star 是 0～5 的整数";
        if (String(s) !== cur.star) {
          next.star = String(s);
          changes.push({ label: "星级", value: s ? "★".repeat(s) : "无星" });
        }
      }
      if (has(p, "status")) {
        const name = str(p.status, 50);
        const s = name ? await refByName(user, "status", name) : null;
        if (typeof s === "string") return s;
        if ((s?.id ?? "") !== cur.statusId) {
          next.statusId = s?.id ?? "";
          changes.push({ label: "状态", value: s?.name ?? "（清空）" });
        }
      }
      if (has(p, "group")) {
        const name = str(p.group, 50);
        const g = name ? await refByName(user, "group", name) : null;
        if (typeof g === "string") return g;
        if ((g?.id ?? "") !== cur.groupId) {
          next.groupId = g?.id ?? "";
          changes.push({ label: "分组", value: g?.name ?? "（清空）" });
        }
      }
      if (has(p, "tags") || has(p, "addTags") || has(p, "removeTags")) {
        let tags = has(p, "tags") ? idList(p.tags, 20) : [...c.tags];
        tags = [...new Set([...tags, ...idList(p.addTags, 20)])]
          .filter((t) => !idList(p.removeTags, 20).includes(t))
          .slice(0, 20);
        if (tags.join(",") !== cur.tags) {
          next.tags = tags.join(",");
          changes.push({ label: "标签", value: tags.join("、") || "（清空）" });
        }
      }
      if (!changes.length) return "没有要改的字段（给的值和现在一样）";
      return {
        kind,
        title: `修改客户 ${c.name}`,
        fields: changes,
        params: { id: c.id, ...next },
        confirm: "保存修改",
        alt: { label: "打开客户", href: `/customers/${c.id}` },
      };
    }
    case "delete_customer": {
      if (!can(user, "customer.delete"))
        return "用户没有删除客户的权限（需要管理员在角色里开「删除客户」）";
      const found = await getCustomerForUser(user, str(p.customerId));
      if (!found || (!found.access.edit && !found.access.inPool))
        return "customerId 无效，或没有权限删除这个客户";
      const c = found.customer;
      const [contacts, quotes, orders, opps] = await Promise.all([
        db.contact.count({ where: { customerId: c.id } }),
        db.quotation.count({ where: { customerId: c.id } }),
        db.order.count({ where: { customerId: c.id } }),
        db.opportunity.count({ where: { customerId: c.id } }),
      ]);
      const lost = [
        contacts && `${contacts} 个联系人`,
        quotes && `${quotes} 张报价单`,
        orders && `${orders} 张订单`,
        opps && `${opps} 个商机`,
        "全部跟进记录",
      ].filter(Boolean);
      return {
        kind,
        title: `删除客户 ${c.name}`,
        fields: [
          { label: "负责人", value: c.owner?.name ?? "公海" },
          { label: "会一起删掉", value: lost.join("、") },
        ],
        params: { customerId: c.id },
        confirm: "删除客户",
        danger: true,
      };
    }
    case "transfer_customer": {
      if (!can(user, "customer.transfer")) return "用户没有转移客户的权限";
      const members = await scopeMembers(user);
      const to = str(p.toUserId, 40) || str(p.toUser, 60);
      const target =
        members.find((m) => m.id === to) ?? members.find((m) => m.name === to);
      if (!target)
        return `toUserId 无效：只能转给数据范围内的在用成员（${members.map((m) => m.name).join("、")}）`;
      const rows = await scopedCustomers(user, idList(p.customerIds));
      if (!rows.length)
        return "customerIds 里没有可转移的客户（数据范围内、私海里的客户 id）";
      return {
        kind,
        title: `把 ${rows.length} 个客户转给 ${target.name}`,
        fields: [
          { label: "客户", value: nameList(rows) },
          {
            label: "原负责人",
            value: [...new Set(rows.map((r) => r.owner?.name ?? "—"))].join(
              "、",
            ),
          },
        ],
        params: {
          customerIds: rows.map((r) => r.id).join(","),
          toUserId: target.id,
        },
        confirm: "转移",
      };
    }
    case "release_customer": {
      if (!can(user, "customer.edit")) return "用户没有编辑客户的权限";
      const rows = await scopedCustomers(user, idList(p.customerIds));
      if (!rows.length) return "customerIds 里没有可放入公海的客户";
      return {
        kind,
        title: `把 ${rows.length} 个客户放入公海`,
        fields: [{ label: "客户", value: nameList(rows) }],
        edit: [{ key: "reason", label: "原因" }],
        params: {
          customerIds: rows.map((r) => r.id).join(","),
          reason: str(p.reason, 200) || "手动放入公海",
        },
        confirm: "放入公海",
      };
    }
    case "save_contact": {
      const found = await getCustomerForUser(user, str(p.customerId));
      if (!found?.access.edit)
        return "customerId 无效，或只能改自己（或下属）负责的客户";
      const old = str(p.contactId)
        ? await db.contact.findFirst({
            where: { id: str(p.contactId), customerId: found.customer.id },
          })
        : null;
      if (str(p.contactId) && !old)
        return "contactId 不是这个客户的联系人（用 customer_context 查联系人）";
      const KEYS: Record<string, string> = {
        name: "姓名",
        title: "职位",
        email: "邮箱",
        phone: "电话",
        whatsapp: "WhatsApp",
        remark: "备注",
      };
      const params: Record<string, string> = { customerId: found.customer.id };
      const fields: ActionCard["fields"] = [];
      for (const [k, label] of Object.entries(KEYS)) {
        const before = old ? str((old as Record<string, unknown>)[k]) : "";
        const v = has(p, k) ? str(p[k], k === "remark" ? 2000 : 200) : before;
        if (v) params[k] = v;
        if (v !== before) fields.push({ label, value: v || "（清空）" });
      }
      if (!params.name) return "name（联系人姓名）不能为空";
      const primary = has(p, "isPrimary") ? yes(p.isPrimary) : !!old?.isPrimary;
      if (primary) params.isPrimary = "on";
      if (primary !== !!old?.isPrimary)
        fields.push({ label: "主联系人", value: primary ? "是" : "否" });
      if (old) params.id = old.id;
      if (old && !fields.length) return "没有要改的内容";
      return {
        kind,
        title: old
          ? `修改联系人 ${old.name}（${found.customer.name}）`
          : `给 ${found.customer.name} 加联系人`,
        fields,
        params,
        confirm: old ? "保存" : "添加联系人",
      };
    }
    case "delete_contact": {
      const ct = await db.contact.findFirst({
        where: { id: str(p.contactId) },
        include: { customer: { select: { name: true } } },
      });
      if (!ct) return "contactId 无效（用 customer_context 查联系人）";
      const found = await getCustomerForUser(user, ct.customerId);
      if (!found?.access.edit)
        return "只能删除自己（或下属）负责的客户的联系人";
      return {
        kind,
        title: `删除联系人 ${ct.name}`,
        fields: [
          { label: "客户", value: ct.customer.name },
          ...(ct.email ? [{ label: "邮箱", value: ct.email }] : []),
        ],
        params: { contactId: ct.id },
        confirm: "删除联系人",
        danger: true,
      };
    }

    // ── 线索 ──
    case "update_lead": {
      if (!can(user, "lead.edit")) return "用户没有编辑线索的权限";
      const lead = await workableLead(user, str(p.leadId));
      if (!lead) return "leadId 无效，或这条线索不在你的数据范围里";
      const KEYS: Record<string, string> = {
        companyName: "公司",
        contactName: "联系人",
        email: "邮箱",
        phone: "电话",
        whatsapp: "WhatsApp",
        country: "国家",
        source: "来源",
        products: "意向产品",
        inquiry: "询盘内容",
      };
      const params: Record<string, string> = { id: lead.id };
      const fields: ActionCard["fields"] = [];
      for (const [k, label] of Object.entries(KEYS)) {
        const before = str((lead as Record<string, unknown>)[k]);
        let v = has(p, k) ? str(p[k], k === "inquiry" ? 10000 : 300) : before;
        if (k === "country" && has(p, k)) {
          const code = countryCode(v);
          if (code == null) return "country 用两位国家代码";
          v = code;
        }
        if (v) params[k] = v;
        if (v !== before)
          fields.push({ label, value: v ? clipText(v) : "（清空）" });
      }
      if (!fields.length) return "没有要改的字段";
      return {
        kind,
        title: `修改线索 ${leadName(lead)}`,
        fields,
        params,
        confirm: "保存修改",
        alt: { label: "看线索", href: "/leads" },
      };
    }
    case "set_lead_status": {
      if (!can(user, "lead.edit")) return "用户没有编辑线索的权限";
      const lead = await workableLead(user, str(p.leadId));
      if (!lead) return "leadId 无效，或这条线索不在你的数据范围里";
      if (lead.status === "CONVERTED")
        return "这条线索已经转成客户了，不能再改状态";
      const status = str(p.status).toUpperCase();
      if (!["NEW", "QUALIFYING", "CONTACTED", "INVALID"].includes(status))
        return "status 取 NEW / QUALIFYING / CONTACTED / INVALID";
      const reason = str(p.reason, 50);
      if (
        status === "INVALID" &&
        !(LEAD_INVALID_REASONS as readonly string[]).includes(reason)
      )
        return `标记无效要给 reason，取：${LEAD_INVALID_REASONS.join("、")}`;
      const label = LEAD_STATUSES.find((s) => s.value === status)!.label;
      return {
        kind,
        title: `线索 ${leadName(lead)} 改为「${label}」`,
        fields: status === "INVALID" ? [{ label: "原因", value: reason }] : [],
        edit:
          status === "INVALID"
            ? [{ key: "note", label: "补充说明" }]
            : undefined,
        params: {
          leadId: lead.id,
          status,
          reason: status === "INVALID" ? reason : "",
          note: str(p.note, 500),
        },
        confirm: "确认",
      };
    }
    case "convert_lead": {
      if (!can(user, "lead.edit")) return "用户没有编辑线索的权限";
      const lead = await workableLead(user, str(p.leadId));
      if (!lead) return "leadId 无效，或这条线索不在你的数据范围里";
      if (lead.status === "CONVERTED") return "这条线索已经转过客户了";
      const customerName =
        str(p.customerName, 200) || lead.companyName || lead.contactName || "";
      if (customerName.length < 2)
        return "给出 customerName（客户名称，至少 2 个字）";
      const withOpp = yes(p.withOpportunity);
      const currency = (CURRENCIES as readonly string[]).includes(
        str(p.currency).toUpperCase(),
      )
        ? str(p.currency).toUpperCase()
        : "USD";
      const amount = Math.max(0, Number(p.amount) || 0);
      return {
        kind,
        title: `把线索 ${leadName(lead)} 转为客户`,
        fields: [
          { label: "说明", value: "已有同名或同邮箱的客户时会并入老客户" },
          ...(withOpp
            ? [
                {
                  label: "同时建商机",
                  value: `${str(p.oppName, 100) || customerName}${amount ? `，${formatAmount(amount, currency)}` : ""}`,
                },
              ]
            : []),
        ],
        edit: [{ key: "customerName", label: "客户名称" }],
        params: {
          id: lead.id,
          customerName,
          ...(withOpp
            ? {
                withOpportunity: "on",
                oppName: str(p.oppName, 100),
                amount: String(amount),
                currency,
              }
            : {}),
        },
        confirm: "转为客户",
      };
    }
    case "delete_lead": {
      if (!can(user, "lead.delete")) return "用户没有删除线索的权限";
      const lead = await workableLead(user, str(p.leadId));
      if (!lead) return "leadId 无效，或这条线索不在你的数据范围里";
      return {
        kind,
        title: `删除线索 ${leadName(lead)}`,
        fields: [
          ...(lead.email ? [{ label: "邮箱", value: lead.email }] : []),
          ...(lead.inquiry
            ? [{ label: "询盘", value: clipText(lead.inquiry) }]
            : []),
        ],
        params: { leadId: lead.id },
        confirm: "删除线索",
        danger: true,
      };
    }

    // ── 日程 ──
    case "complete_task":
    case "delete_task": {
      const task = await db.task.findFirst({
        where: { id: str(p.taskId) },
        include: { customer: { select: { name: true } } },
      });
      if (!task || !(await inScope(user, task.ownerId)))
        return "taskId 无效（用 list_tasks 查）";
      const del = kind === "delete_task";
      return {
        kind,
        title: `${del ? "删除" : "完成"}日程：${task.title}`,
        fields: task.customer
          ? [{ label: "客户", value: task.customer.name }]
          : [],
        params: { taskId: task.id },
        confirm: del ? "删除" : "标记完成",
        danger: del,
      };
    }

    // ── 报价单 / 订单 ──
    case "set_quotation_status":
    case "delete_quotation": {
      const q = await db.quotation.findFirst({
        where: { id: str(p.quotationId) },
        include: { customer: { select: { name: true } } },
      });
      if (!q || !(await inScope(user, q.ownerId)))
        return "quotationId 无效（用 list_quotations 查）";
      const fields = [
        { label: "客户", value: q.customer.name },
        { label: "金额", value: formatAmount(q.total.toString(), q.currency) },
      ];
      if (kind === "delete_quotation")
        return {
          kind,
          title: `删除报价单 ${q.no}`,
          fields,
          params: { quotationId: q.id },
          confirm: "删除报价单",
          danger: true,
        };
      const st = QUOTATION_STATUSES.find(
        (s) =>
          s.value === str(p.status).toUpperCase() || s.label === str(p.status),
      );
      if (!st || st.value === "CONVERTED")
        return `status 取 ${QUOTATION_STATUSES.filter(
          (s) => s.value !== "CONVERTED",
        )
          .map((s) => `${s.value}=${s.label}`)
          .join("，")}`;
      return {
        kind,
        title: `报价单 ${q.no} 改为「${st.label}」`,
        fields,
        params: { quotationId: q.id, status: st.value },
        confirm: "确认",
      };
    }
    case "set_order_status":
    case "delete_order": {
      const o = await db.order.findFirst({
        where: { id: str(p.orderId) },
        include: { customer: { select: { name: true } } },
      });
      if (!o || !(await inScope(user, o.ownerId)))
        return "orderId 无效（用 list_orders 查）";
      const fields = [
        { label: "客户", value: o.customer.name },
        { label: "金额", value: formatAmount(o.total.toString(), o.currency) },
      ];
      if (kind === "delete_order")
        return {
          kind,
          title: `删除订单 ${o.no}`,
          fields,
          params: { orderId: o.id },
          confirm: "删除订单",
          danger: true,
        };
      const st = ORDER_STATUSES.find(
        (s) =>
          s.value === str(p.status).toUpperCase() || s.label === str(p.status),
      );
      if (!st)
        return `status 取 ${ORDER_STATUSES.map((s) => `${s.value}=${s.label}`).join("，")}`;
      return {
        kind,
        title: `订单 ${o.no} 改为「${st.label}」`,
        fields,
        params: { orderId: o.id, status: st.value },
        confirm: "确认",
      };
    }

    // ── 商机 ──
    case "move_opportunity":
    case "delete_opportunity": {
      const o = await db.opportunity.findFirst({
        where: { id: str(p.opportunityId) },
        include: {
          customer: { select: { name: true } },
          stage: { select: { name: true } },
        },
      });
      if (!o || !(await inScope(user, o.ownerId)))
        return "opportunityId 无效（用 list_opportunities 查）";
      const fields = [
        { label: "客户", value: o.customer.name },
        { label: "金额", value: formatAmount(o.amount.toString(), o.currency) },
      ];
      if (kind === "delete_opportunity") {
        if (!can(user, "opportunity.delete")) return "用户没有删除商机的权限";
        return {
          kind,
          title: `删除商机 ${o.name}`,
          fields,
          params: { opportunityId: o.id },
          confirm: "删除商机",
          danger: true,
        };
      }
      const stages = await db.stage.findMany({
        select: { id: true, name: true },
        orderBy: { sort: "asc" },
      });
      const want = str(p.stage, 60);
      const st = stages.find((s) => s.id === want || s.name === want);
      if (!st) return `stage 取：${stages.map((s) => s.name).join("、")}`;
      return {
        kind,
        title: `商机 ${o.name}：${o.stage.name} → ${st.name}`,
        fields,
        params: { opportunityId: o.id, stageId: st.id },
        confirm: "移动阶段",
      };
    }

    // ── 产品 ──
    case "delete_product": {
      const prod = await db.product.findFirst({
        where: { id: str(p.productId) },
      });
      if (!prod) return "productId 无效（先用 search_products）";
      return {
        kind,
        title: `删除产品 ${prod.nameEn || prod.name}`,
        fields: [
          { label: "SKU", value: prod.sku },
          { label: "说明", value: "已开出的报价单、订单里的明细不受影响" },
        ],
        params: { productId: prod.id },
        confirm: "删除产品",
        danger: true,
      };
    }
    default:
      return "未知操作";
  }
}

const clipText = (s: string, n = 80) =>
  s.length > n ? `${s.slice(0, n)}…` : s;
