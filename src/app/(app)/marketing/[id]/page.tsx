import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { InsightCard, InsightRow } from "@/components/crm/insights";
import { StatusBadge } from "@/components/crm/bits";
import { Funnel, Meter } from "@/components/dashboard/viz";
import { Pager } from "@/components/crm/customer-filters";
import { requirePermission } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { inScope } from "@/server/scope";
import { sequenceStats } from "@/server/sequences";
import { cn } from "@/lib/utils";
import { ENROLLMENT_STATUS } from "@/lib/sequences";
import type { EnrollmentStatus } from "@/generated/prisma/client";
import { SequenceActions } from "./sequence-actions";
import { RecipientTable } from "./recipient-table";

export const metadata: Metadata = { title: "营销序列" };

const PAGE = 50;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function SequencePage({ params, searchParams }: PageProps<"/marketing/[id]">) {
  const user = await requirePermission("mail.use");
  const { id } = await params;
  const sp = await searchParams;
  const db = tenantDb(user.tenantId);
  const seq = await db.mailSequence.findFirst({
    where: { id },
    include: { steps: { orderBy: { sort: "asc" } }, account: { select: { email: true } } },
  });
  if (!seq || !(await inScope(user, seq.ownerId))) notFound();

  const status = typeof sp.status === "string" && sp.status in ENROLLMENT_STATUS ? (sp.status as EnrollmentStatus) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = { sequenceId: id, ...(status ? { status } : {}) };

  const [stats, counts, total, rows, msgs] = await Promise.all([
    sequenceStats(user.tenantId, [id]).then((m) => m.get(id)),
    prisma.mailEnrollment.groupBy({ by: ["status"], where: { sequenceId: id }, _count: true }),
    prisma.mailEnrollment.count({ where }),
    prisma.mailEnrollment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { email: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { messages: { orderBy: { date: "desc" }, take: 1, select: { id: true, openCount: true, clickCount: true, lastOpenAt: true } } },
    }),
    // 每一步的发出 / 打开：按收件人收到的先后顺序算第几封
    prisma.mailMessage.findMany({
      where: { enrollment: { sequenceId: id } },
      orderBy: { date: "asc" },
      select: { enrollmentId: true, openCount: true, clickCount: true },
    }),
  ]);
  const s = stats ?? { sent: 0, opened: 0, clicked: 0, bounced: 0, recipients: 0, active: 0, replied: 0, unsubscribed: 0 };
  const countOf = (k: string) => counts.find((c) => c.status === k)?._count ?? 0;
  const seen = new Map<string, number>();
  const perStep = seq.steps.map(() => ({ sent: 0, opened: 0 }));
  for (const m of msgs) {
    const i = seen.get(m.enrollmentId!) ?? 0;
    seen.set(m.enrollmentId!, i + 1);
    if (perStep[i]) {
      perStep[i].sent++;
      if (m.openCount > 0) perStep[i].opened++;
    }
  }
  const tabs = [
    { key: "", label: "全部", n: s.recipients },
    ...Object.entries(ENROLLMENT_STATUS)
      .map(([k, v]) => ({ key: k, label: v.label, n: countOf(k) }))
      .filter((t) => t.n > 0 || t.key === "ACTIVE"),
  ];

  return (
    <>
      <Link href="/marketing" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ChevronLeft className="size-4" /> 邮件营销
      </Link>
      <PageHeader
        title={seq.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {seq.status === "ACTIVE" ? <StatusBadge name="发送中" color="emerald" /> : <StatusBadge name="已暂停" color="amber" />}
            <span>
              {seq.steps.length} 封 · {seq.account.email} · 每天最多 {seq.dailyLimit} 封{seq.workHours ? " · 仅工作时间" : ""}
              {seq.stopOnReply ? " · 回复即停" : ""}
            </span>
          </span>
        }
        actions={<SequenceActions id={seq.id} active={seq.status === "ACTIVE"} />}
      />

      <InsightRow>
        <InsightCard title="发送进度" value={`${s.sent} 封`} hint={`${s.recipients} 位收件人 · ${s.active} 位进行中`}>
          <Meter value={s.recipients - s.active} max={s.recipients} label="已结束的收件人占比" />
          <p className="mt-2 text-xs text-muted-foreground">已结束 = 发完、回复、退信、退订或停止</p>
        </InsightCard>
        <InsightCard title="转化" hint="按封计打开、点击；按人计回复">
          <Funnel
            steps={[
              { label: "已发出", value: s.sent },
              { label: "已打开", value: s.opened },
              { label: "点击链接", value: s.clicked },
              { label: "回复", value: s.replied },
            ]}
          />
        </InsightCard>
        <InsightCard title="每封打开率" hint="第几封 · 发出数 · 打开率">
          <ul className="flex flex-col gap-2 text-xs">
            {perStep.map((p, i) => (
              <li key={i} className="grid grid-cols-[3rem_1fr_3.5rem] items-center gap-2 tabular-nums">
                <span className="text-muted-foreground">第 {i + 1} 封</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-[var(--chart-1)]" style={{ width: p.sent ? `${(p.opened / p.sent) * 100}%` : 0 }} />
                </span>
                <span className="text-right">
                  {pct(p.opened, p.sent)}
                  <span className="text-muted-foreground"> /{p.sent}</span>
                </span>
              </li>
            ))}
          </ul>
        </InsightCard>
        <InsightCard title="退信 / 退订" value={`${s.bounced} / ${s.unsubscribed}`} hint={`退信率 ${pct(s.bounced, s.sent)}，超过 5% 建议清理名单`}>
          <Meter value={s.bounced} max={s.sent} tone="var(--destructive)" label="退信率" />
        </InsightCard>
      </InsightRow>

      <section className="surface overflow-hidden">
        <nav aria-label="收件人状态" className="flex gap-1 overflow-x-auto border-b border-border/70 px-3 py-2 [scrollbar-width:none]">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.key ? `/marketing/${id}?status=${t.key}` : `/marketing/${id}`}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm",
                (status ?? "") === t.key ? "bg-accent font-medium text-accent-foreground" : "text-foreground/80 hover:bg-muted",
              )}
            >
              {t.label}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">{t.n}</span>
            </Link>
          ))}
        </nav>
        <RecipientTable
          sequenceId={id}
          totalSteps={seq.steps.length}
          tz={user.timezone}
          rows={rows.map((e) => ({
            id: e.id,
            email: e.email,
            name: e.name,
            company: e.company,
            country: e.country,
            customerId: e.customerId,
            status: e.status,
            step: e.step,
            nextAt: e.nextAt?.toISOString() ?? null,
            lastSentAt: e.lastSentAt?.toISOString() ?? null,
            error: e.error,
            lastMessageId: e.messages[0]?.id ?? null,
            opens: e.messages[0]?.openCount ?? 0,
            clicks: e.messages[0]?.clickCount ?? 0,
          }))}
        />
        <Pager
          path={`/marketing/${id}`}
          filters={{ status: status ?? "" }}
          page={page}
          pages={Math.max(1, Math.ceil(total / PAGE))}
          total={total}
          className="mt-0 border-t border-border/70 px-5 py-3"
        />
      </section>
    </>
  );
}
