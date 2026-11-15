import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/crm/empty-state";
import { SocialIcon } from "@/components/crm/social-icon";
import { StarRating } from "@/components/crm/bits";
import { Share2 } from "@/components/icons";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { ownedWhere } from "@/server/scope";
import { formatDateTime } from "@/lib/crm";
import { platformInfo } from "@/lib/social";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "跟踪名单" };

/** 数据范围内所有存了社媒的客户：哪些在跟踪、上次查到什么、哪些平台要登录才能看 */
export default async function SocialAccountsPage() {
  const user = await requirePermission("customer.view");
  const db = tenantDb(user.tenantId);
  const tenant = await db.tenant.findFirst({ where: { id: user.tenantId }, select: { socialWatchStar: true } });
  const watchStar = tenant?.socialWatchStar ?? 3;
  const customers = await db.customer.findMany({
    where: { ...(await ownedWhere(user)), socials: { some: {} } },
    orderBy: [{ star: "desc" }, { updatedAt: "desc" }],
    take: 300,
    select: {
      id: true,
      name: true,
      star: true,
      owner: { select: { name: true } },
      socials: { orderBy: { createdAt: "asc" } },
      _count: { select: { socialPosts: { where: { readAt: null } } } },
    },
  });
  const tz = user.timezone;

  return (
    <>
      <PageHeader
        title="跟踪名单"
        description={
          watchStar ? `星级 ≥ ${watchStar} 的客户自动跟踪；在客户详情里可以单独关掉某个账号` : "社媒跟踪已关闭，可在「社媒动态」里打开"
        }
      />
      {customers.length === 0 ? (
        <section className="surface">
          <EmptyState icon={Share2}>还没有客户存了社媒账号。打开客户详情，点「添加社媒」或用 AI 穿透一键挖出来。</EmptyState>
        </section>
      ) : (
        <ul className="surface divide-y divide-border/70">
          {customers.map((c) => {
            const watching = watchStar > 0 && c.star >= watchStar;
            return (
              <li key={c.id} className="grid gap-3 px-4 py-3.5 md:grid-cols-[16rem_minmax(0,1fr)] md:px-5">
                <div className="min-w-0">
                  <Link href={`/customers/${c.id}`} className="block truncate font-medium hover:text-primary hover:underline">
                    {c.name}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <StarRating value={c.star} size="sm" />
                    <span className={cn("rounded px-1.5 py-px", watching ? "bg-primary/10 text-primary" : "bg-muted")}>
                      {watching ? "跟踪中" : "星级不够"}
                    </span>
                    {c._count.socialPosts > 0 && <span className="text-destructive">{c._count.socialPosts} 条未读</span>}
                    {c.owner && <span className="truncate">{c.owner.name}</span>}
                  </div>
                </div>
                <ul className="flex min-w-0 flex-wrap gap-2">
                  {c.socials.map((s) => (
                    <li key={s.id} className="flex max-w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5">
                      <SocialIcon platform={s.platform} className="size-6 rounded-md" />
                      <div className="min-w-0">
                        <a href={s.url} target="_blank" rel="noreferrer noopener" className="block max-w-56 truncate text-sm hover:text-primary hover:underline">
                          {s.handle ?? platformInfo(s.platform).label}
                        </a>
                        <p className={cn("max-w-56 truncate text-[11px]", s.lastError ? "text-amber-600" : "text-muted-foreground")} title={s.lastError ?? undefined}>
                          {!s.watch
                            ? "已关闭跟踪"
                            : s.lastError
                              ? s.lastError
                              : s.changedAt
                                ? `${formatDateTime(s.changedAt, tz)} 有更新`
                                : s.checkedAt
                                  ? `${formatDateTime(s.checkedAt, tz)} 查过`
                                  : watching
                                    ? "等待第一次检查"
                                    : "未跟踪"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
