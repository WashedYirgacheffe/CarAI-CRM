import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Plus, Send } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { InsightCard, InsightRow } from "@/components/crm/insights";
import { StatusBadge } from "@/components/crm/bits";
import { Meter } from "@/components/dashboard/viz";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { scopeOwnerIds } from "@/server/scope";
import { sequenceStats } from "@/server/sequences";
import { daysAgo, formatDate } from "@/lib/crm";
import { SEQUENCE_PRESETS } from "@/lib/sequences";

export const metadata: Metadata = { title: "邮件营销" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function MarketingPage() {
  const user = await requirePermission("mail.use");
  const scope = await scopeOwnerIds(user);
  const since = daysAgo(30);

  const [sequences, accounts, oneToOne] = await Promise.all([
    prisma.mailSequence.findMany({
      where: { tenantId: user.tenantId, ...(scope ? { ownerId: { in: scope } } : {}) },
      orderBy: { updatedAt: "desc" },
      include: { account: { select: { email: true } }, _count: { select: { steps: true } } },
    }),
    prisma.mailAccount.count({ where: { tenantId: user.tenantId, userId: user.id } }),
    // 近 30 天一对一发出的邮件（不含群发），看平时开发信的打开情况
    prisma.mailMessage.findMany({
      where: {
        tenantId: user.tenantId,
        folder: "SENT",
        trackId: { not: null },
        enrollmentId: null,
        date: { gte: since },
        account: { userId: user.id },
      },
      select: { openCount: true, clickCount: true },
    }),
  ]);
  const stats = await sequenceStats(
    user.tenantId,
    sequences.map((s) => s.id),
  );
  const total = [...stats.values()].reduce(
    (t, s) => ({
      sent: t.sent + s.sent,
      opened: t.opened + s.opened,
      clicked: t.clicked + s.clicked,
      replied: t.replied + s.replied,
      bounced: t.bounced + s.bounced,
      unsubscribed: t.unsubscribed + s.unsubscribed,
      recipients: t.recipients + s.recipients,
      active: t.active + s.active,
    }),
    { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0, recipients: 0, active: 0 },
  );
  const oneOpened = oneToOne.filter((m) => m.openCount > 0).length;

  const newButton = accounts ? (
    <Button size="sm" asChild>
      <Link href="/marketing/new">
        <Plus /> 新建序列
      </Link>
    </Button>
  ) : (
    <Button size="sm" variant="outline" asChild>
      <Link href="/settings/mailboxes">先绑定邮箱</Link>
    </Button>
  );

  return (
    <>
      <PageHeader title="邮件营销" description="群发开发信、报价后自动跟进：按间隔天数依次发送，客户回复、退信或退订就自动停" actions={newButton} />

      <InsightRow>
        <InsightCard title="序列已发出" value={total.sent.toLocaleString()} hint={`${total.recipients} 位收件人 · ${total.active} 位进行中`} />
        <InsightCard title="打开率" value={pct(total.opened, total.sent)} hint={`点击率 ${pct(total.clicked, total.sent)}`}>
          <Meter value={total.opened} max={total.sent} label="打开率" />
        </InsightCard>
        <InsightCard title="回复率" value={pct(total.replied, total.recipients)} hint={`${total.replied} 位客户回复`}>
          <Meter value={total.replied} max={total.recipients} tone="var(--chart-2)" label="回复率" />
        </InsightCard>
        <InsightCard
          title="一对一邮件打开率 · 近 30 天"
          value={pct(oneOpened, oneToOne.length)}
          hint={oneToOne.length ? `${oneToOne.length} 封里 ${oneOpened} 封被打开` : "从邮件页发出的单封邮件"}
        >
          <Meter value={oneOpened} max={oneToOne.length} tone="var(--chart-3)" label="一对一邮件打开率" />
        </InsightCard>
      </InsightRow>

      {sequences.length === 0 ? (
        <section className="surface px-5 py-12 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Send className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-medium">还没有营销序列</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            从模板开始：写好几封邮件和间隔天数，选客户或线索加入，系统在工作时间自动发出，并追踪打开和回复。
          </p>
          {accounts ? (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SEQUENCE_PRESETS.map((p) => (
                <Button key={p.key} variant="outline" size="sm" asChild>
                  <Link href={`/marketing/new?preset=${p.key}`}>{p.name}</Link>
                </Button>
              ))}
            </div>
          ) : (
            <Button className="mt-5" size="sm" asChild>
              <Link href="/settings/mailboxes">
                <Mail /> 绑定邮箱后开始
              </Link>
            </Button>
          )}
        </section>
      ) : (
        <section className="surface overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,1fr))] gap-4 border-b border-border/70 px-5 py-2.5 text-xs text-muted-foreground md:grid">
            <span>序列</span>
            <span className="text-right">收件人</span>
            <span className="text-right">已发出</span>
            <span className="text-right">打开率</span>
            <span className="text-right">点击率</span>
            <span className="text-right">回复率</span>
          </div>
          <ul className="divide-y divide-border/70">
            {sequences.map((s) => {
              const st = stats.get(s.id);
              const cell = (label: string, v: string, sub?: string) => (
                <span className="flex flex-col md:items-end">
                  <span className="text-xs text-muted-foreground md:hidden">{label}</span>
                  <span className="font-medium tabular-nums">{v}</span>
                  {sub && <span className="text-xs text-muted-foreground tabular-nums">{sub}</span>}
                </span>
              );
              return (
                <li key={s.id}>
                  <Link
                    href={`/marketing/${s.id}`}
                    className="grid grid-cols-4 gap-x-3 gap-y-3 px-4 py-3.5 text-sm transition-colors hover:bg-muted/50 md:grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,1fr))] md:items-center md:px-5"
                  >
                    <span className="col-span-4 min-w-0 md:col-span-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{s.name}</span>
                        {s.status === "ACTIVE" ? <StatusBadge name="发送中" color="emerald" /> : <StatusBadge name="已暂停" color="amber" />}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {s._count.steps} 封 · {s.account.email} · {formatDate(s.updatedAt, user.timezone)}
                      </span>
                    </span>
                    {cell("收件人", String(st?.recipients ?? 0), st?.active ? `${st.active} 进行中` : undefined)}
                    {cell("已发出", String(st?.sent ?? 0), st?.bounced ? `${st.bounced} 退信` : undefined)}
                    {cell("打开率", pct(st?.opened ?? 0, st?.sent ?? 0))}
                    <span className="hidden md:contents">{cell("点击率", pct(st?.clicked ?? 0, st?.sent ?? 0))}</span>
                    {cell("回复率", pct(st?.replied ?? 0, st?.recipients ?? 0), st?.replied ? `${st.replied} 位` : undefined)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
