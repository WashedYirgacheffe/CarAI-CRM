"use server";

import { can, requireUser } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { getCustomerForUser } from "@/server/customers";
import { scopeOwnerIds } from "@/server/scope";
import { MetricError, queryMetric, teamSummary } from "@/server/metrics";
import { countryName, followMethodLabel } from "@/lib/crm";
import { isChart, isDim, isMetric, isRange, type ChartKey, type MetricResult, type RangeKey, type TeamRow } from "@/lib/metrics";

export type CustomerCard = {
  id: string;
  name: string;
  country: string | null;
  status: string | null;
  owner: string | null;
  source: string | null;
  tags: string[];
  lastContactAt: string | null;
  nextFollowAt: string | null;
  inPool: boolean;
  contacts: { name: string; title: string | null; email: string | null; whatsapp: string | null }[];
  chats: { id: string; name: string }[];
  stats: { opps: number; quotes: number; orders: number };
};

export type FollowItem = { id: string; follow: boolean; method: string; content: string; at: string; user: string | null };

export type WidgetData =
  | { ok: false; message: string }
  | { ok: true; type: "customer"; customer: CustomerCard }
  | { ok: true; type: "followups"; customer: { id: string; name: string; canEdit: boolean }; items: FollowItem[] }
  | { ok: true; type: "team"; range: RangeKey; rows: TeamRow[]; from: string; to: string }
  | { ok: true; type: "chart"; chart: ChartKey; result: MetricResult };

/** 工作台业务组件的数据（按当前用户的权限和数据范围） */
export async function loadWidgetAction(type: string, params: Record<string, string> = {}): Promise<WidgetData> {
  const user = await requireUser();
  try {
    if (type === "customer" || type === "followups") {
      const found = params.customerId ? await getCustomerForUser(user, params.customerId) : null;
      if (!found) return { ok: false, message: "客户不存在，或你没有权限查看" };
      const c = found.customer;
      const db = tenantDb(user.tenantId);
      if (type === "followups") {
        const acts = await db.activity.findMany({
          where: { customerId: c.id },
          orderBy: { createdAt: "desc" },
          take: 40,
          include: { user: { select: { name: true } } },
        });
        return {
          ok: true,
          type,
          customer: { id: c.id, name: c.name, canEdit: found.access.edit },
          items: acts.map((a) => ({
            id: a.id,
            follow: a.type === "FOLLOW_UP",
            method: followMethodLabel(a.method),
            content: a.content,
            at: a.createdAt.toISOString(),
            user: a.user?.name ?? null,
          })),
        };
      }
      const wa = can(user, "whatsapp.use") ? await prisma.waAccount.findUnique({ where: { userId: user.id }, select: { id: true } }) : null;
      const [contacts, chats, opps, quotes, orders] = await Promise.all([
        db.contact.findMany({ where: { customerId: c.id }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 6 }),
        wa ? db.waChat.findMany({ where: { accountId: wa.id, customerId: c.id }, select: { id: true, name: true, phone: true }, take: 5 }) : [],
        can(user, "opportunity.view") ? db.opportunity.count({ where: { customerId: c.id } }) : 0,
        can(user, "quotation.view") ? db.quotation.count({ where: { customerId: c.id } }) : 0,
        can(user, "order.view") ? db.order.count({ where: { customerId: c.id } }) : 0,
      ]);
      return {
        ok: true,
        type,
        customer: {
          id: c.id,
          name: c.name,
          country: c.country ? countryName(c.country) : null,
          status: c.status?.name ?? null,
          owner: c.owner?.name ?? null,
          source: c.source,
          tags: c.tags,
          lastContactAt: c.lastContactAt?.toISOString() ?? null,
          nextFollowAt: c.nextFollowAt?.toISOString() ?? null,
          inPool: found.access.inPool,
          contacts: contacts.map((x) => ({ name: x.name, title: x.title, email: x.email, whatsapp: x.whatsapp })),
          chats: chats.map((x) => ({ id: x.id, name: x.name || (x.phone ? `+${x.phone}` : "WhatsApp") })),
          stats: { opps, quotes, orders },
        },
      };
    }
    if (type === "team") {
      const range = isRange(params.range) ? params.range : "month";
      const r = await teamSummary(user, range);
      return { ok: true, type, range, ...r };
    }
    if (type === "chart") {
      if (!isMetric(params.metric)) return { ok: false, message: "图表的指标无效" };
      const result = await queryMetric(user, params.metric, isDim(params.by) ? params.by : "time", isRange(params.range) ? params.range : "30d");
      return { ok: true, type, chart: isChart(params.chart) ? params.chart : result.by === "time" ? "bar" : "hbar", result };
    }
    return { ok: false, message: "未知组件" };
  } catch (e) {
    if (e instanceof MetricError) return { ok: false, message: e.message };
    throw e;
  }
}

export type TargetHit = { id: string; title: string; sub: string };

/** 「添加组件」里挑对象：客户（数据范围内）或我的 WhatsApp 会话 */
export async function searchTargetsAction(kind: "customer" | "chat", raw: string): Promise<TargetHit[]> {
  const user = await requireUser();
  const q = raw.trim().slice(0, 60);
  const has = { contains: q, mode: "insensitive" as const };
  const db = tenantDb(user.tenantId);
  if (kind === "chat") {
    if (!can(user, "whatsapp.use")) return [];
    const wa = await prisma.waAccount.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!wa) return [];
    const chats = await db.waChat.findMany({
      where: {
        accountId: wa.id,
        lastMessageAt: { not: null },
        ...(q ? { OR: [{ name: has }, { phone: { contains: q.replace(/\D/g, "") || q } }, { customer: { name: has } }] } : {}),
      },
      orderBy: { lastMessageAt: "desc" },
      take: 8,
      select: { id: true, name: true, phone: true, customer: { select: { name: true } } },
    });
    return chats.map((c) => ({
      id: c.id,
      title: c.name || (c.phone ? `+${c.phone}` : "未知号码"),
      sub: c.customer?.name ?? (c.phone ? `+${c.phone}` : ""),
    }));
  }
  if (!can(user, "customer.view")) return [];
  const ids = await scopeOwnerIds(user);
  const customers = await db.customer.findMany({
    where: {
      ...(ids ? { ownerId: { in: ids } } : { ownerId: { not: null } }),
      ...(q ? { OR: [{ name: has }, { contacts: { some: { name: has } } }] } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: { id: true, name: true, country: true, owner: { select: { name: true } } },
  });
  return customers.map((c) => ({
    id: c.id,
    title: c.name,
    sub: [c.country ? countryName(c.country) : null, c.owner?.name].filter(Boolean).join(" · "),
  }));
}
