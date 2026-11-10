import "server-only";
import { prisma } from "@/server/db";
import { sendMail } from "@/server/mail/send";
import { firstName, renderTemplate } from "@/lib/sequences";

const DAY = 86_400_000;

export type Recipient = {
  email: string;
  name?: string | null;
  company?: string | null;
  country?: string | null;
  customerId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 把收件人加进序列：去重、跳过退订 / 退信名单、跳过已在序列里的 */
export async function enroll(tenantId: string, sequenceId: string, list: Recipient[]) {
  const seq = await prisma.mailSequence.findFirst({
    where: { id: sequenceId, tenantId },
    include: { steps: { orderBy: { sort: "asc" }, take: 1 } },
  });
  if (!seq) return { added: 0, suppressed: 0, duplicate: 0, invalid: 0 };

  const seen = new Map<string, Recipient>();
  let invalid = 0;
  for (const r of list) {
    const email = r.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      invalid++;
      continue;
    }
    if (!seen.has(email)) seen.set(email, { ...r, email });
  }
  const emails = [...seen.keys()];
  const [blocked, existing] = await Promise.all([
    prisma.mailSuppression.findMany({ where: { tenantId, email: { in: emails } }, select: { email: true } }),
    prisma.mailEnrollment.findMany({ where: { sequenceId, email: { in: emails } }, select: { email: true } }),
  ]);
  const blockedSet = new Set(blocked.map((b) => b.email));
  const existingSet = new Set(existing.map((b) => b.email));
  const nextAt = new Date(Date.now() + (seq.steps[0]?.delayDays ?? 0) * DAY);
  const rows = [...seen.values()].filter((r) => !blockedSet.has(r.email) && !existingSet.has(r.email));
  const { count } = await prisma.mailEnrollment.createMany({
    data: rows.map((r) => ({
      tenantId,
      sequenceId,
      accountId: seq.accountId,
      email: r.email,
      name: r.name?.trim() || null,
      company: r.company?.trim() || null,
      country: r.country?.trim() || null,
      customerId: r.customerId ?? null,
      contactId: r.contactId ?? null,
      leadId: r.leadId ?? null,
      nextAt,
    })),
    skipDuplicates: true,
  });
  return { added: count, suppressed: blockedSet.size, duplicate: emails.length - blockedSet.size - count, invalid };
}

/** 企业时区的工作时间：周一到周五 9–18 点 */
function inWorkHours(tz: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  return wd !== "Sat" && wd !== "Sun" && hour >= 9 && hour < 18;
}

/** 每个邮箱每轮最多发几封（worker 每分钟一轮），避免短时间集中发信 */
const PER_ACCOUNT_PER_TICK = 3;

/** worker 定时调用：发到期的序列邮件 */
export async function runSequences(log: (...a: unknown[]) => void = () => {}) {
  const now = new Date();
  const due = await prisma.mailEnrollment.findMany({
    where: { status: "ACTIVE", nextAt: { lte: now }, sequence: { status: "ACTIVE" }, account: { status: { not: "PAUSED" } } },
    orderBy: { nextAt: "asc" },
    take: 300,
    include: {
      sequence: {
        include: {
          steps: { orderBy: { sort: "asc" } },
          tenant: { select: { timezone: true } },
          account: { select: { displayName: true, user: { select: { name: true } } } },
        },
      },
    },
  });
  if (!due.length) return;

  const sentToday = new Map<string, number>();
  const perAccount = new Map<string, number>();
  for (const e of due) {
    const seq = e.sequence;
    if ((perAccount.get(e.accountId) ?? 0) >= PER_ACCOUNT_PER_TICK) continue;
    if (seq.workHours && !inWorkHours(seq.tenant.timezone, now)) continue;
    if (!sentToday.has(seq.id)) {
      sentToday.set(
        seq.id,
        await prisma.mailMessage.count({ where: { enrollment: { sequenceId: seq.id }, date: { gte: new Date(now.getTime() - DAY) } } }),
      );
    }
    if (sentToday.get(seq.id)! >= seq.dailyLimit) continue;

    const step = seq.steps[e.step];
    if (!step) {
      await prisma.mailEnrollment.update({ where: { id: e.id }, data: { status: "COMPLETED", nextAt: null } });
      continue;
    }
    // 加入后才退订 / 退信的，在这里拦下
    const blocked = await prisma.mailSuppression.findFirst({ where: { tenantId: e.tenantId, email: e.email }, select: { reason: true } });
    if (blocked) {
      await prisma.mailEnrollment.update({
        where: { id: e.id },
        data: { status: blocked.reason === "bounce" ? "BOUNCED" : "UNSUBSCRIBED", nextAt: null },
      });
      continue;
    }

    const vars = {
      name: e.name,
      first_name: firstName(e.name),
      company: e.company,
      country: e.country,
      sender: seq.account.displayName || seq.account.user.name,
    };
    perAccount.set(e.accountId, (perAccount.get(e.accountId) ?? 0) + 1);
    sentToday.set(seq.id, sentToday.get(seq.id)! + 1);
    const r = await sendMail({
      accountId: e.accountId,
      to: [{ name: e.name, address: e.email }],
      cc: [],
      bcc: [],
      subject: renderTemplate(step.subject, vars),
      text: renderTemplate(step.body, vars),
      files: [],
      enrollmentId: e.id,
    });
    if (!r.ok) {
      await prisma.mailEnrollment.update({ where: { id: e.id }, data: { status: "FAILED", error: r.error, nextAt: null } });
      log("[sequence]", seq.name, e.email, r.error);
      continue;
    }
    const next = seq.steps[e.step + 1];
    // 状态可能在发送过程中被回复 / 退订改掉，只在仍是进行中时推进
    await prisma.mailEnrollment.updateMany({
      where: { id: e.id, status: "ACTIVE" },
      data: next
        ? { step: e.step + 1, lastSentAt: now, nextAt: new Date(now.getTime() + next.delayDays * DAY), error: null }
        : { step: e.step + 1, lastSentAt: now, nextAt: null, status: "COMPLETED", error: null },
    });
  }
}

/** 序列统计：发出、打开、点击、回复、退信 */
export async function sequenceStats(tenantId: string, sequenceIds: string[]) {
  if (!sequenceIds.length) return new Map<string, SequenceStats>();
  const [msgs, enrollments] = await Promise.all([
    prisma.mailMessage.findMany({
      where: { tenantId, enrollment: { sequenceId: { in: sequenceIds } } },
      select: { openCount: true, clickCount: true, bouncedAt: true, enrollment: { select: { sequenceId: true } } },
    }),
    prisma.mailEnrollment.groupBy({ by: ["sequenceId", "status"], where: { tenantId, sequenceId: { in: sequenceIds } }, _count: true }),
  ]);
  const map = new Map<string, SequenceStats>();
  const get = (id: string) => {
    let s = map.get(id);
    if (!s) map.set(id, (s = { sent: 0, opened: 0, clicked: 0, bounced: 0, recipients: 0, active: 0, replied: 0, unsubscribed: 0 }));
    return s;
  };
  for (const m of msgs) {
    const s = get(m.enrollment!.sequenceId);
    s.sent++;
    if (m.openCount > 0) s.opened++;
    if (m.clickCount > 0) s.clicked++;
    if (m.bouncedAt) s.bounced++;
  }
  for (const g of enrollments) {
    const s = get(g.sequenceId);
    s.recipients += g._count;
    if (g.status === "ACTIVE") s.active += g._count;
    if (g.status === "REPLIED") s.replied += g._count;
    if (g.status === "UNSUBSCRIBED") s.unsubscribed += g._count;
  }
  return map;
}

export type SequenceStats = {
  sent: number;
  opened: number;
  clicked: number;
  bounced: number;
  recipients: number;
  active: number;
  replied: number;
  unsubscribed: number;
};
