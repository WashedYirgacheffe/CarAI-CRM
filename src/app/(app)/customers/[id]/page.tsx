import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { can, requireUser } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { getCustomerForUser } from "@/server/customers";
import { scopeMembers } from "@/server/scope";
import { customerOptions } from "@/server/customer-list";
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

  const [contacts, activities, opportunities, tasks, stages, options, members] = await Promise.all([
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
  ]);

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
          nextFollowAt: customer.nextFollowAt?.toISOString() ?? null,
          poolReason: customer.poolReason,
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
