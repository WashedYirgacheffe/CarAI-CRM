import "server-only";
import { prisma } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { scopeOwnerIds } from "@/server/scope";
import { docScopeWhere } from "@/server/documents";
import type { Prisma } from "@/generated/prisma/client";
import { countryName } from "@/lib/crm";
import { orderStatus, quotationStatus } from "@/lib/docs";

export type SearchHit = { id: string; title: string; sub: string; href: string };
export type SearchGroup = { key: string; label: string; hits: SearchHit[] };

const TAKE = 5;

/** 顶栏全局搜索：只返回当前用户有权限看到的数据 */
export async function globalSearch(user: CurrentUser, raw: string): Promise<SearchGroup[]> {
  const q = raw.trim().slice(0, 100);
  if (!q) return [];
  const t = user.tenantId;
  const has = { contains: q, mode: "insensitive" as const };
  const ids = await scopeOwnerIds(user);
  const owned = ids ? { ownerId: { in: ids } } : { ownerId: { not: null } };

  // 能看到的客户：数据范围内的私海客户 + 公海（有公海查看权限时）
  const visible: Prisma.CustomerWhereInput[] = [];
  if (can(user, "customer.view")) visible.push(owned);
  if (can(user, "pool.view")) visible.push({ ownerId: null });
  const customerScope: Prisma.CustomerWhereInput | null = visible.length ? { OR: visible } : null;
  const docScope = await docScopeWhere(user);

  const [customers, contacts, leads, opps, quotes, orders, products] = await Promise.all([
    customerScope
      ? prisma.customer.findMany({
          where: { tenantId: t, AND: [customerScope, { OR: [{ name: has }, { domain: has }, { website: has }, { tags: { has: q } }] }] },
          select: { id: true, name: true, country: true, ownerId: true, owner: { select: { name: true } } },
          orderBy: { updatedAt: "desc" },
          take: TAKE,
        })
      : [],
    customerScope
      ? prisma.contact.findMany({
          where: { tenantId: t, customer: customerScope, OR: [{ name: has }, { email: has }, { phone: has }, { whatsapp: has }] },
          select: { id: true, name: true, email: true, customer: { select: { id: true, name: true } } },
          take: TAKE,
        })
      : [],
    can(user, "lead.view")
      ? prisma.lead.findMany({
          where: {
            tenantId: t,
            AND: [{ OR: [owned, { ownerId: null }] }, { OR: [{ companyName: has }, { contactName: has }, { email: has }, { whatsapp: has }] }],
          },
          select: { id: true, companyName: true, contactName: true, email: true, country: true },
          orderBy: { createdAt: "desc" },
          take: TAKE,
        })
      : [],
    can(user, "opportunity.view")
      ? prisma.opportunity.findMany({
          where: { tenantId: t, ...owned, OR: [{ name: has }, { customer: { name: has } }] },
          select: { id: true, name: true, customerId: true, customer: { select: { name: true } }, stage: { select: { name: true } } },
          orderBy: { updatedAt: "desc" },
          take: TAKE,
        })
      : [],
    can(user, "quotation.view")
      ? prisma.quotation.findMany({
          where: { tenantId: t, ...docScope, OR: [{ no: has }, { buyerName: has }, { title: has }] },
          select: { id: true, no: true, buyerName: true, status: true },
          orderBy: { createdAt: "desc" },
          take: TAKE,
        })
      : [],
    can(user, "order.view")
      ? prisma.order.findMany({
          where: { tenantId: t, ...docScope, OR: [{ no: has }, { buyerName: has }] },
          select: { id: true, no: true, buyerName: true, status: true },
          orderBy: { createdAt: "desc" },
          take: TAKE,
        })
      : [],
    can(user, "product.view")
      ? prisma.product.findMany({
          where: { tenantId: t, OR: [{ sku: has }, { name: has }, { nameEn: has }, { model: has }] },
          select: { id: true, sku: true, name: true },
          take: TAKE,
        })
      : [],
  ]);

  const groups: SearchGroup[] = [
    {
      key: "customers",
      label: "客户",
      hits: customers.map((c) => ({
        id: c.id,
        title: c.name,
        sub: [c.country && countryName(c.country), c.ownerId ? c.owner?.name : "公海"].filter(Boolean).join(" · "),
        href: `/customers/${c.id}`,
      })),
    },
    {
      key: "contacts",
      label: "联系人",
      hits: contacts.map((c) => ({
        id: c.id,
        title: c.name,
        sub: [c.customer.name, c.email].filter(Boolean).join(" · "),
        href: `/customers/${c.customer.id}`,
      })),
    },
    {
      key: "leads",
      label: "线索",
      hits: leads.map((l) => ({
        id: l.id,
        title: l.companyName ?? l.contactName ?? l.email ?? "线索",
        sub: [l.companyName && l.contactName, l.email, l.country && countryName(l.country)].filter(Boolean).join(" · "),
        href: `/leads?tab=all&q=${encodeURIComponent(l.email ?? l.companyName ?? l.contactName ?? q)}`,
      })),
    },
    {
      key: "opportunities",
      label: "商机",
      hits: opps.map((o) => ({ id: o.id, title: o.name, sub: `${o.customer.name} · ${o.stage.name}`, href: `/customers/${o.customerId}` })),
    },
    {
      key: "quotations",
      label: "报价单",
      hits: quotes.map((x) => ({ id: x.id, title: x.no, sub: `${x.buyerName} · ${quotationStatus(x.status).label}`, href: `/quotations/${x.id}` })),
    },
    {
      key: "orders",
      label: "订单",
      hits: orders.map((x) => ({ id: x.id, title: x.no, sub: `${x.buyerName} · ${orderStatus(x.status).label}`, href: `/orders/${x.id}` })),
    },
    {
      key: "products",
      label: "产品",
      hits: products.map((p) => ({ id: p.id, title: p.name, sub: p.sku, href: `/products?q=${encodeURIComponent(p.sku)}&status=ALL` })),
    },
  ];
  return groups.filter((g) => g.hits.length);
}
