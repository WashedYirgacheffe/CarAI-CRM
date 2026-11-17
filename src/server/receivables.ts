import "server-only";
import { prisma } from "@/server/db";
import { dayRange } from "@/lib/crm";
import { formatAmount, ORDER_NOT_COUNTED } from "@/lib/docs";
import { allocatePlans } from "@/lib/receivables";

const WEEK = 7 * 86_400_000;

/**
 * 逾期回款提醒（worker 每小时跑一次）：收款计划里到期没收齐的，给订单负责人建一条「payment」提醒；
 * 同一期 7 天内不重复提醒。
 */
export async function remindOverduePayments(log: (...a: unknown[]) => void = () => {}) {
  const now = new Date();
  const tenants = await prisma.tenant.findMany({
    where: { paymentPlans: { some: { dueDate: { lt: now } } } },
    select: { id: true, timezone: true },
  });
  let created = 0;
  for (const t of tenants) {
    const today = dayRange(t.timezone, now).start;
    const orders = await prisma.order.findMany({
      where: {
        tenantId: t.id,
        status: { notIn: [...ORDER_NOT_COUNTED] },
        plans: { some: { dueDate: { lt: today } } },
      },
      select: {
        id: true,
        no: true,
        currency: true,
        paidAmount: true,
        total: true,
        ownerId: true,
        customerId: true,
        customer: { select: { name: true } },
        plans: { select: { id: true, label: true, amount: true, dueDate: true, remindedAt: true } },
      },
      take: 2000,
    });
    for (const o of orders) {
      if (!o.ownerId || Number(o.paidAmount) >= Number(o.total)) continue;
      const sched = allocatePlans(
        o.plans.map((p) => ({ id: p.id, label: p.label, amount: Number(p.amount), dueDate: p.dueDate })),
        Number(o.paidAmount),
        today,
      );
      for (const p of sched) {
        if (p.state !== "overdue") continue;
        const plan = o.plans.find((x) => x.id === p.id)!;
        if (plan.remindedAt && now.getTime() - plan.remindedAt.getTime() < WEEK) continue;
        await prisma.$transaction([
          prisma.task.create({
            data: {
              tenantId: t.id,
              title: `催款：${o.customer.name} 订单 ${o.no}「${p.label}」逾期 ${p.overdueDays} 天`,
              note: `还欠 ${formatAmount(p.due, o.currency)}。确认客户是否已付款（要水单），已到账的到订单里登记收款。`,
              dueAt: now,
              kind: "payment_overdue",
              link: `/orders/${o.id}`,
              customerId: o.customerId,
              ownerId: o.ownerId,
            },
          }),
          prisma.paymentPlan.update({ where: { id: p.id }, data: { remindedAt: now } }),
        ]);
        created++;
      }
    }
  }
  if (created) log("[payment-remind]", `created ${created} reminders`);
}
