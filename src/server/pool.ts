import "server-only";
import { prisma } from "@/server/db";
import { customerFilterWhere } from "@/server/customer-where";
import { pickSegmentFilters } from "@/lib/segments";
import type { Prisma } from "@/generated/prisma/client";

const DAY = 86_400_000;

type Field = "lastContactAt" | "lastFollowAt" | "lastMailRecvAt" | "lastMailSentAt" | "lastWaAt";

/**
 * 记录一次往来：把给定的时间字段推进到 at（只会往后推，不会倒退），并刷新下次进公海时间。
 * 邮件归档、WhatsApp、跟进都走这里。
 */
export async function touchCustomer(tenantId: string, customerId: string, at: Date, fields: Field[]) {
  const all = Array.from(new Set<Field>(["lastContactAt", ...fields]));
  for (const f of all) {
    await prisma.customer.updateMany({
      where: { tenantId, id: customerId, OR: [{ [f]: null }, { [f]: { lt: at } }] },
      data: { [f]: at },
    });
  }
  await refreshPoolDue(tenantId, [customerId]);
}

/** 按已归档的邮件、WhatsApp 和跟进记录重算客户的往来时间（关联会话、合并客户之后用） */
export async function syncCustomerTimes(tenantId: string, customerId: string) {
  const [follow, sent, recv, wa] = await Promise.all([
    prisma.activity.aggregate({ where: { tenantId, customerId, type: "FOLLOW_UP", event: null }, _max: { createdAt: true } }),
    prisma.mailMessage.aggregate({ where: { tenantId, customerId, folder: "SENT" }, _max: { date: true } }),
    prisma.mailMessage.aggregate({ where: { tenantId, customerId, folder: "INBOX" }, _max: { date: true } }),
    prisma.waMessage.aggregate({ where: { tenantId, chat: { customerId } }, _max: { timestamp: true } }),
  ]);
  const pairs: [Field, Date | null][] = [
    ["lastFollowAt", follow._max.createdAt],
    ["lastMailSentAt", sent._max.date],
    ["lastMailRecvAt", recv._max.date],
    ["lastWaAt", wa._max.timestamp],
  ];
  for (const [f, at] of pairs) {
    if (!at) continue;
    await prisma.customer.updateMany({ where: { tenantId, id: customerId, OR: [{ [f]: null }, { [f]: { lt: at } }] }, data: { [f]: at } });
    await prisma.customer.updateMany({
      where: { tenantId, id: customerId, OR: [{ lastContactAt: null }, { lastContactAt: { lt: at } }] },
      data: { lastContactAt: at },
    });
  }
  await refreshPoolDue(tenantId, [customerId]);
}

/**
 * 按公海规则算出每个私海客户的下次进公海时间：
 * 起点 = max(最近联系 或 最近跟进（看企业设置）, 分配时间)，天数 = 第一个匹配到的客群的 poolDays，没有就用企业默认值。
 * 传 ids 时只算这些客户。
 */
export async function refreshPoolDue(tenantId: string, ids?: string[]) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { poolRecycleDays: true, poolBasis: true, timezone: true },
  });
  if (!tenant) return;
  const base: Prisma.CustomerWhereInput = { tenantId, ownerId: { not: null }, ...(ids ? { id: { in: ids } } : {}) };
  const rows = await prisma.customer.findMany({
    where: base,
    select: { id: true, createdAt: true, assignedAt: true, lastContactAt: true, lastFollowAt: true, poolDueAt: true },
  });
  if (!rows.length) return;

  const days = new Map<string, number>();
  const segs = await prisma.customerSegment.findMany({
    where: { tenantId, poolDays: { not: null } },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    select: { filters: true, poolDays: true },
  });
  for (const s of segs) {
    const f = pickSegmentFilters((s.filters ?? {}) as Record<string, unknown>);
    if (f.follow === "soon") delete f.follow; // 依赖进公海时间本身，不能用来定规则
    const hit = await prisma.customer.findMany({
      where: { AND: [base, ...customerFilterWhere(f, tenant.timezone)] },
      select: { id: true },
    });
    for (const h of hit) if (!days.has(h.id)) days.set(h.id, s.poolDays!);
  }

  const updates: Prisma.PrismaPromise<unknown>[] = [];
  const postponed: string[] = [];
  for (const r of rows) {
    const d = days.get(r.id) ?? tenant.poolRecycleDays;
    let due: Date | null = null;
    if (d > 0) {
      const basis = tenant.poolBasis === "follow" ? r.lastFollowAt : r.lastContactAt;
      const start = Math.max(basis?.getTime() ?? 0, (r.assignedAt ?? r.createdAt).getTime());
      due = new Date(start + d * DAY);
    }
    if (due?.getTime() === r.poolDueAt?.getTime()) continue;
    const later = !due || !r.poolDueAt || due > r.poolDueAt;
    if (later && r.poolDueAt) postponed.push(r.id);
    updates.push(
      prisma.customer.updateMany({
        where: { tenantId, id: r.id },
        data: { poolDueAt: due, ...(later ? { poolWarnedAt: null } : {}) },
      }),
    );
  }
  for (let i = 0; i < updates.length; i += 200) await prisma.$transaction(updates.slice(i, i + 200));
  // 进公海时间推后了，之前的进公海提醒就不用再做
  if (postponed.length) {
    await prisma.task.updateMany({
      where: { tenantId, customerId: { in: postponed }, done: false, title: { endsWith: POOL_TASK_SUFFIX } },
      data: { done: true, doneAt: new Date() },
    });
  }
}

const POOL_TASK_SUFFIX = "进入公海，请及时跟进";

/** 把客户放进公海：记下原负责人、进公海次数 +1、清空私海相关时间。返回实际放入的数量 */
export function moveToPoolQuery(tenantId: string, ids: string[], reason: string, at = new Date()) {
  return prisma.$executeRaw`
    UPDATE "Customer" SET
      "prevOwnerId" = "ownerId", "ownerId" = NULL, "assignedAt" = NULL, "nextFollowAt" = NULL,
      "poolEnteredAt" = ${at}, "poolReason" = ${reason}, "poolCount" = "poolCount" + 1,
      "poolDueAt" = NULL, "poolWarnedAt" = NULL, "updatedAt" = ${at}
    WHERE "tenantId" = ${tenantId} AND "id" = ANY(${ids}) AND "ownerId" IS NOT NULL`;
}

/**
 * 公海规则执行：刷新进公海时间 → 回收到期客户 → 给快到期的客户建提醒任务。
 * worker 每小时跑一次，公海页面加载时也会跑。
 */
export async function recyclePool(tenantId: string) {
  await refreshPoolDue(tenantId);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { poolBasis: true, poolWarnDays: true, timezone: true },
  });
  if (!tenant) return 0;
  const now = new Date();

  const due = await prisma.customer.findMany({
    where: { tenantId, ownerId: { not: null }, poolDueAt: { lte: now } },
    select: { id: true, owner: { select: { name: true } } },
    take: 1000,
  });
  if (due.length) {
    const reason = `超过公海规则期限未${tenant.poolBasis === "follow" ? "跟进" : "联系"}，自动回收`;
    await prisma.$transaction([
      moveToPoolQuery(
        tenantId,
        due.map((c) => c.id),
        reason,
        now,
      ),
      prisma.activity.createMany({
        data: due.map((c) => ({
          tenantId,
          customerId: c.id,
          type: "SYSTEM" as const,
          event: "recycled",
          content: `${reason}（原负责人：${c.owner?.name ?? "—"}）`,
        })),
      }),
    ]);
  }

  if (tenant.poolWarnDays > 0) {
    const soon = await prisma.customer.findMany({
      where: {
        tenantId,
        ownerId: { not: null },
        poolWarnedAt: null,
        poolDueAt: { gt: now, lte: new Date(now.getTime() + tenant.poolWarnDays * DAY) },
      },
      select: { id: true, name: true, ownerId: true, poolDueAt: true },
      take: 1000,
    });
    if (soon.length) {
      const fmt = new Intl.DateTimeFormat("zh-CN", { timeZone: tenant.timezone, month: "numeric", day: "numeric" });
      await prisma.$transaction([
        prisma.task.createMany({
          data: soon.map((c) => ({
            tenantId,
            title: `客户「${c.name}」将于 ${fmt.format(c.poolDueAt!)} ${POOL_TASK_SUFFIX}`,
            dueAt: c.poolDueAt!,
            customerId: c.id,
            ownerId: c.ownerId!,
          })),
        }),
        prisma.customer.updateMany({ where: { tenantId, id: { in: soon.map((c) => c.id) } }, data: { poolWarnedAt: now } }),
      ]);
    }
  }
  return due.length;
}
