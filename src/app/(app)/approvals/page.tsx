import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/crm/bits";
import { Pager } from "@/components/crm/customer-filters";
import { can, requireUser } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { APPROVAL_KINDS } from "@/server/approvals";
import type { Prisma } from "@/generated/prisma/client";
import { formatDateTime } from "@/lib/crm";
import { approvalStatus } from "@/lib/docs";
import { cn } from "@/lib/utils";
import { ReviewButtons, WithdrawButton } from "./review-buttons";

export const metadata: Metadata = { title: "审批" };

const PAGE_SIZE = 30;

function targetHref(kind: string, targetId: string | null, payload: unknown) {
  if (kind === "quotation" && targetId) return `/quotations/${targetId}`;
  if (kind === "order" && targetId) return `/orders/${targetId}`;
  const ids = (payload as { ids?: string[] } | null)?.ids ?? [];
  if (kind !== "customer_delete" && ids.length === 1) return `/customers/${ids[0]}`;
  if (kind === "customer_delete" && targetId) return `/customers/${targetId}`;
  return null;
}

export default async function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  const user = await requireUser();
  const reviewer = can(user, "approval.review");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tabs = reviewer
    ? ([
        { key: "todo", label: "待我审批" },
        { key: "done", label: "已处理" },
        { key: "mine", label: "我的申请" },
      ] as const)
    : ([{ key: "mine", label: "我的申请" }] as const);
  const tab = tabs.find((t) => t.key === str("tab"))?.key ?? tabs[0].key;
  const page = Math.max(1, Number(str("page")) || 1);
  const db = tenantDb(user.tenantId);

  const where: Prisma.ApprovalRequestWhereInput =
    tab === "todo" ? { status: "PENDING" } : tab === "done" ? { status: { in: ["APPROVED", "REJECTED"] } } : { requesterId: user.id };
  const [total, rows, members, pending] = await Promise.all([
    db.approvalRequest.count({ where }),
    db.approvalRequest.findMany({
      where,
      orderBy: tab === "done" ? { reviewedAt: "desc" } : { createdAt: tab === "todo" ? "asc" : "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.user.findMany({ select: { id: true, name: true } }),
    reviewer ? db.approvalRequest.count({ where: { status: "PENDING" } }) : 0,
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const tz = user.timezone;

  return (
    <>
      <PageHeader
        title="审批"
        description={
          reviewer
            ? "报价单 / 订单折扣超限、退公海、删除和转移客户的申请。通过后系统自动执行，结果会提醒申请人。"
            : "你提交的审批申请。审批规则由管理员在「设置 → 审批规则」里配置。"
        }
      />
      <div className="surface">
        <nav aria-label="审批视图" className="flex items-center gap-1 border-b border-border/70 px-3 py-3 md:px-4">
          <div className="inline-flex items-center rounded-full bg-muted p-0.5 ring-1 ring-border/60">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={t.key === tabs[0].key ? "/approvals" : `/approvals?tab=${t.key}`}
                aria-current={tab === t.key ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-[10px] px-3.5 text-sm font-medium transition-colors",
                  tab === t.key ? "bg-brand-soft text-brand-ink" : "text-foreground/60 hover:text-foreground",
                )}
              >
                {t.label}
                {t.key === "todo" && pending > 0 && <span className="text-xs tabular-nums text-rose-600">{pending}</span>}
              </Link>
            ))}
          </div>
        </nav>

        {rows.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">
            {tab === "todo" ? "没有待审批的申请" : tab === "done" ? "还没有处理过的审批" : "你还没有提交过审批"}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((r) => {
              const st = approvalStatus(r.status);
              const href = r.status === "APPROVED" && r.kind === "customer_delete" ? null : targetHref(r.kind, r.targetId, r.payload);
              return (
                <li key={r.id} className="flex flex-col gap-2 px-3 py-3.5 md:flex-row md:items-center md:gap-4 md:px-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-md bg-muted px-1.5 py-px text-xs font-medium text-foreground/70">{APPROVAL_KINDS[r.kind] ?? r.kind}</span>
                      {href ? (
                        <Link href={href} className="font-medium hover:text-primary hover:underline">
                          {r.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.title}</span>
                      )}
                      {tab !== "todo" && <StatusBadge name={st.label} color={st.color} />}
                    </p>
                    {r.reason && <p className="text-sm text-foreground/80">理由：{r.reason}</p>}
                    <p className="text-xs text-muted-foreground">
                      {nameOf.get(r.requesterId) ?? "已删除的成员"} 提交于 {formatDateTime(r.createdAt, tz)}
                      {r.reviewedAt && (
                        <>
                          {" · "}
                          {nameOf.get(r.reviewerId ?? "") ?? "—"} {r.status === "APPROVED" ? "通过" : "驳回"}于 {formatDateTime(r.reviewedAt, tz)}
                        </>
                      )}
                    </p>
                    {r.reviewNote && <p className="text-xs text-foreground/70">审批意见：{r.reviewNote}</p>}
                  </div>
                  {r.status === "PENDING" && (
                    <div className="flex shrink-0 items-center gap-2">
                      {reviewer && <ReviewButtons id={r.id} />}
                      {r.requesterId === user.id && <WithdrawButton id={r.id} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border/70 px-3 py-3 md:px-4 [&>div]:mt-0">
          <Pager
            path="/approvals"
            filters={{ tab: tab === tabs[0].key ? "" : tab }}
            page={page}
            pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            total={total}
          />
        </div>
      </div>
    </>
  );
}
