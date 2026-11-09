import { waMediaOf } from "@/components/crm/wa-media";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { can, requireUser } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getCustomerForUser } from "@/server/customers";
import { scopeMembers } from "@/server/scope";
import { customerOptions } from "@/server/customer-list";
import { asAddresses, asAttachments } from "@/server/mail/store";
import { CustomerDetail } from "./customer-detail";

export async function generateMetadata({ params }: PageProps<"/customers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const user = await requireUser();
  const found = await getCustomerForUser(user, id);
  return { title: found?.customer.name ?? "客户" };
}

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const found = await getCustomerForUser(user, id);
  if (!found) notFound();
  const { customer, access } = found;
  const db = tenantDb(user.tenantId);

  const [contacts, activities, opportunities, tasks, stages, options, members, quotations, orders] = await Promise.all([
    db.contact.findMany({ where: { customerId: id }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }),
    db.activity.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: { select: { name: true } }, opportunity: { select: { name: true } } },
    }),
    can(user, "opportunity.view")
      ? db.opportunity.findMany({
          where: { customerId: id },
          orderBy: { createdAt: "desc" },
          include: { stage: true, owner: { select: { name: true } } },
        })
      : [],
    db.task.findMany({ where: { customerId: id }, orderBy: [{ done: "asc" }, { dueAt: "asc" }], take: 50 }),
    db.stage.findMany({ orderBy: { sort: "asc" } }),
    customerOptions(user.tenantId),
    scopeMembers(user),
    can(user, "quotation.view")
      ? db.quotation.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 100 })
      : null,
    can(user, "order.view") ? db.order.findMany({ where: { customerId: id }, orderBy: { orderDate: "desc" }, take: 100 }) : null,
  ]);

  const canAi = can(user, "ai.use");
  const waEnabled = can(user, "whatsapp.use");
  const [mailAccounts, mails, waChats, insights] = await Promise.all([
    db.mailAccount.findMany({ where: { userId: user.id, status: { not: "PAUSED" } }, select: { id: true } }),
    db.mailMessage.findMany({
      where: { customerId: id },
      orderBy: { date: "desc" },
      take: 100,
      select: {
        id: true,
        folder: true,
        fromAddr: true,
        fromName: true,
        toList: true,
        subject: true,
        snippet: true,
        text: true,
        date: true,
        attachments: true,
        account: { select: { userId: true } },
      },
    }),
    db.waChat.findMany({ where: { customerId: id }, select: { id: true } }),
    canAi ? db.aiInsight.findMany({ where: { targetId: id, kind: { in: ["customer_brief", "customer_next"] } } }) : [],
  ]);
  const waMsgs = waChats.length
    ? await db.waMessage.findMany({
        where: { chatId: { in: waChats.map((x) => x.id) } },
        orderBy: { timestamp: "desc" },
        take: 200,
        include: { account: { select: { userId: true } } },
      })
    : [];
  const insight = (kind: string) => {
    const row = insights.find((x) => x.kind === kind);
    return row ? { content: row.content, createdAt: row.createdAt.toISOString() } : null;
  };

  return (
    <>
      <Link
        href={access.inPool ? "/customers/pool" : "/customers"}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        {access.inPool ? "公海客户" : "我的客户"}
      </Link>
      <CustomerDetail
        tz={user.timezone}
        access={access}
        perms={{
          transfer: can(user, "customer.transfer"),
          delete: can(user, "customer.delete"),
          claim: can(user, "pool.claim"),
          createOpportunity: can(user, "opportunity.create"),
          viewOpportunity: can(user, "opportunity.view"),
          createQuotation: can(user, "quotation.create"),
          createOrder: can(user, "order.create"),
        }}
        quotations={
          quotations?.map((q) => ({
            id: q.id,
            no: q.no,
            status: q.status,
            total: q.total.toString(),
            currency: q.currency,
            date: q.quoteDate.toISOString(),
          })) ?? null
        }
        orders={
          orders?.map((o) => ({
            id: o.id,
            no: o.no,
            status: o.status,
            total: o.total.toString(),
            currency: o.currency,
            date: o.orderDate.toISOString(),
            paid: o.paidAmount.toString(),
          })) ?? null
        }
        comms={{
          mailEnabled: mailAccounts.length > 0,
          waEnabled,
          ai: canAi ? { brief: insight("customer_brief"), next: insight("customer_next") } : null,
          mails: mails.map((m) => {
            const to = asAddresses(m.toList);
            return {
              id: m.id,
              folder: m.folder,
              peer: m.folder === "SENT" ? `致 ${to.map((a) => a.address).join(", ")}` : m.fromName ? `${m.fromName} <${m.fromAddr}>` : m.fromAddr,
              subject: m.subject,
              snippet: m.snippet,
              text: m.text ? m.text.slice(0, 20000) : null,
              date: m.date.toISOString(),
              attachments: asAttachments(m.attachments).map((a) => ({ id: a.id, filename: a.filename })),
              mine: m.account.userId === user.id,
            };
          }),
          wa: waMsgs.reverse().map((m) => ({
            id: m.id,
            fromMe: m.fromMe,
            body: m.body,
            media: waMediaOf(m),
            timestamp: m.timestamp.toISOString(),
            chatId: m.chatId,
            mine: m.account.userId === user.id,
          })),
        }}
        members={members}
        options={options}
        stages={stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, kind: s.kind }))}
        customer={{
          id: customer.id,
          name: customer.name,
          country: customer.country,
          website: customer.website,
          domain: customer.domain,
          address: customer.address,
          source: customer.source,
          customerType: customer.customerType,
          mainProducts: customer.mainProducts,
          annualVolume: customer.annualVolume,
          remark: customer.remark,
          statusId: customer.statusId,
          groupId: customer.groupId,
          star: customer.star,
          tags: customer.tags,
          statusName: customer.status?.name ?? null,
          statusColor: customer.status?.color ?? null,
          groupName: customer.group?.name ?? null,
          ownerName: customer.owner?.name ?? null,
          createdAt: customer.createdAt.toISOString(),
          assignedAt: customer.assignedAt?.toISOString() ?? null,
          lastContactAt: customer.lastContactAt?.toISOString() ?? null,
          lastFollowAt: customer.lastFollowAt?.toISOString() ?? null,
          lastMailRecvAt: customer.lastMailRecvAt?.toISOString() ?? null,
          lastMailSentAt: customer.lastMailSentAt?.toISOString() ?? null,
          lastWaAt: customer.lastWaAt?.toISOString() ?? null,
          nextFollowAt: customer.nextFollowAt?.toISOString() ?? null,
          poolReason: customer.poolReason,
          poolDueAt: customer.poolDueAt?.toISOString() ?? null,
          poolCount: customer.poolCount,
          poolEnteredAt: customer.poolEnteredAt?.toISOString() ?? null,
          prevOwnerName: customer.prevOwner?.name ?? null,
        }}
        contacts={contacts.map((c) => ({
          id: c.id,
          name: c.name,
          title: c.title,
          email: c.email,
          phone: c.phone,
          whatsapp: c.whatsapp,
          remark: c.remark,
          isPrimary: c.isPrimary,
        }))}
        activities={activities.map((a) => ({
          id: a.id,
          type: a.type,
          event: a.event,
          method: a.method,
          content: a.content,
          userName: a.user?.name ?? "系统",
          opportunityName: a.opportunity?.name ?? null,
          createdAt: a.createdAt.toISOString(),
        }))}
        opportunities={opportunities.map((o) => ({
          id: o.id,
          customerId: o.customerId,
          name: o.name,
          amount: o.amount.toString(),
          currency: o.currency,
          stageId: o.stageId,
          stageName: o.stage.name,
          stageKind: o.stage.kind,
          probability: o.stage.probability,
          ownerName: o.owner?.name ?? null,
          expectedCloseAt: o.expectedCloseAt?.toISOString() ?? null,
          remark: o.remark,
        }))}
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          dueAt: t.dueAt.toISOString(),
          done: t.done,
          customerId: t.customerId,
          customerName: customer.name,
        }))}
      />
    </>
  );
}
