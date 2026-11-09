import "server-only";
import { prisma } from "@/server/db";
import type { CurrentUser } from "@/server/auth";
import { asAddresses } from "@/server/mail/store";
import { AUTOMATED } from "@/server/mail/archive";
import { digitsOf } from "@/server/whatsapp/match";
import { extractDomain } from "@/lib/crm";

export type Suggestion = {
  key: string;
  kind: "mail" | "wa";
  /** 邮箱地址 或 WhatsApp 会话 id */
  ref: string;
  name: string | null;
  address: string;
  /** 建议的公司名 */
  company: string;
  count: number;
  inCount: number;
  lastAt: string;
  lastText: string;
};

const DAY = 86_400_000;

/** 用域名猜公司名：acme-tools.com → Acme Tools */
function companyFromDomain(domain: string) {
  const label = domain.split(".")[0] ?? domain;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * 建档建议：最近 180 天和我有邮件 / WhatsApp 往来、但还没有对应客户、联系人或线索的人。
 * 只看自己的邮箱和 WhatsApp 账号。
 */
export async function listSuggestions(user: CurrentUser): Promise<Suggestion[]> {
  const t = user.tenantId;
  const since = new Date(Date.now() - 180 * DAY);
  const [accounts, ignored, mails, chats] = await Promise.all([
    prisma.mailAccount.findMany({ where: { tenantId: t }, select: { email: true } }),
    prisma.suggestionIgnore.findMany({ where: { tenantId: t }, select: { key: true } }),
    prisma.mailMessage.findMany({
      where: { tenantId: t, customerId: null, leadId: null, account: { userId: user.id }, date: { gte: since } },
      orderBy: { date: "desc" },
      take: 3000,
      select: { folder: true, fromAddr: true, fromName: true, toList: true, subject: true, date: true },
    }),
    prisma.waChat.findMany({
      where: { tenantId: t, customerId: null, account: { userId: user.id }, lastMessageAt: { gte: since }, jid: { endsWith: "@s.whatsapp.net" } },
      orderBy: { lastMessageAt: "desc" },
      take: 500,
      select: { id: true, phone: true, name: true, jid: true, lastMessageAt: true, lastText: true, _count: { select: { messages: true } } },
    }),
  ]);
  const skip = new Set(ignored.map((i) => i.key));
  const ownAddrs = new Set(accounts.map((a) => a.email.toLowerCase()));
  const ownDomains = new Set(accounts.map((a) => extractDomain(a.email)).filter(Boolean) as string[]);

  // ── 邮件：按对方地址聚合 ──
  const byAddr = new Map<string, Suggestion>();
  for (const m of mails) {
    const peers =
      m.folder === "SENT"
        ? asAddresses(m.toList).map((a) => ({ address: a.address, name: a.name ?? null }))
        : [{ address: m.fromAddr, name: m.fromName }];
    for (const p of peers) {
      const addr = p.address?.trim().toLowerCase();
      if (!addr || !addr.includes("@") || ownAddrs.has(addr) || AUTOMATED.test(addr)) continue;
      const domain = extractDomain(addr);
      if (domain && ownDomains.has(domain)) continue; // 同事
      const key = `mail:${addr}`;
      if (skip.has(key)) continue;
      const s = byAddr.get(key);
      if (s) {
        s.count++;
        if (m.folder === "INBOX") s.inCount++;
        if (!s.name && p.name) s.name = p.name;
        continue;
      }
      byAddr.set(key, {
        key,
        kind: "mail",
        ref: addr,
        name: p.name || null,
        address: addr,
        company: domain ? companyFromDomain(domain) : p.name || addr.split("@")[0],
        count: 1,
        inCount: m.folder === "INBOX" ? 1 : 0,
        lastAt: m.date.toISOString(),
        lastText: m.subject || "(无主题)",
      });
    }
  }
  // 已经是联系人或线索的地址不再建议
  const addrs = [...byAddr.values()].map((s) => s.address);
  if (addrs.length) {
    const [contacts, leads] = await Promise.all([
      prisma.contact.findMany({ where: { tenantId: t, email: { in: addrs, mode: "insensitive" } }, select: { email: true } }),
      prisma.lead.findMany({ where: { tenantId: t, email: { in: addrs, mode: "insensitive" } }, select: { email: true } }),
    ]);
    for (const r of [...contacts, ...leads]) if (r.email) byAddr.delete(`mail:${r.email.toLowerCase()}`);
  }
  // 只发过一封、对方从没回过的，大多是群发开发信，不建议
  const mailOut = [...byAddr.values()].filter((s) => s.inCount > 0 || s.count >= 2);

  // ── WhatsApp：未关联客户的单聊 ──
  const phones = chats.map((c) => digitsOf(c.phone ?? c.jid.split("@")[0])).filter((d) => d.length >= 7);
  const leadPhones = phones.length
    ? new Set(
        (
          await prisma.lead.findMany({
            where: { tenantId: t, OR: [{ whatsapp: { not: null } }, { phone: { not: null } }] },
            select: { whatsapp: true, phone: true },
          })
        ).flatMap((l) => [digitsOf(l.whatsapp), digitsOf(l.phone)]),
      )
    : new Set<string>();
  const waOut: Suggestion[] = [];
  for (const c of chats) {
    const phone = digitsOf(c.phone ?? c.jid.split("@")[0]);
    if (phone.length < 7 || leadPhones.has(phone)) continue;
    const key = `wa:${phone}`;
    if (skip.has(key)) continue;
    waOut.push({
      key,
      kind: "wa",
      ref: c.id,
      name: c.name,
      address: `+${phone}`,
      company: c.name || `+${phone}`,
      count: c._count.messages,
      inCount: c._count.messages,
      lastAt: (c.lastMessageAt ?? new Date()).toISOString(),
      lastText: c.lastText ?? "",
    });
  }

  return [...mailOut, ...waOut].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 300);
}
