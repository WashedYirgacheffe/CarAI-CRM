import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/crm/empty-state";
import { SocialIcon } from "@/components/crm/social-icon";
import { StarRating } from "@/components/crm/bits";
import { Share2 } from "@/components/icons";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { ownedWhere } from "@/server/scope";
import { formatDateTime } from "@/lib/crm";
import { platformInfo } from "@/lib/social";
import { cn } from "@/lib/utils";
import { MarkAllRead, MarkRead, WatchStarSetting } from "./social-bits";

export const metadata: Metadata = { title: "社媒动态" };

/** 组件里不能读当前时间，放到外面算 */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** 重点客户的社媒更新：新视频 / 新文章 / 主页资料变化，按时间倒序 */
export default async function SocialFeedPage({ searchParams }: PageProps<"/social">) {
  const user = await requirePermission("customer.view");
  const { f } = await searchParams;
  const unreadOnly = f !== "all";
  const db = tenantDb(user.tenantId);
  const owned = await ownedWhere(user);
  const tenant = await db.tenant.findFirst({ where: { id: user.tenantId }, select: { socialWatchStar: true } });
  const watchStar = tenant?.socialWatchStar ?? 3;
  const since = daysAgo(7);

  const [posts, unread, week, watchedCustomers, accounts] = await Promise.all([
    db.socialPost.findMany({
      where: { customer: owned, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { publishedAt: "desc" },
      take: 100,
      include: {
        social: { select: { platform: true, handle: true, url: true } },
        customer: { select: { id: true, name: true, star: true, country: true } },
      },
    }),
    db.socialPost.count({ where: { customer: owned, readAt: null } }),
    db.socialPost.count({ where: { customer: owned, createdAt: { gte: since } } }),
    watchStar > 0 ? db.customer.count({ where: { ...owned, star: { gte: watchStar }, socials: { some: { watch: true } } } }) : 0,
    db.customerSocial.count({ where: { customer: owned } }),
  ]);

  return (
    <>
      <PageHeader
        title="社媒动态"
        description={watchStar ? `${watchStar} 星及以上的重点客户，社媒账号每 6 小时自动查一次更新` : "社媒跟踪已关闭"}
        actions={
          <>
            {can(user, "settings.business") && <WatchStarSetting value={watchStar} />}
            {unread > 0 && <MarkAllRead />}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="未读更新" value={unread} />
        <Stat label="近 7 天更新" value={week} />
        <Stat label="跟踪中的客户" value={watchedCustomers} href="/social/accounts" />
        <Stat label="已存社媒账号" value={accounts} href="/social/accounts" />
      </div>

      <div className="mb-3 flex items-center gap-1 text-sm">
        <FilterLink href="/social" active={unreadOnly}>
          未读
        </FilterLink>
        <FilterLink href="/social?f=all" active={!unreadOnly}>
          全部
        </FilterLink>
      </div>

      {posts.length === 0 ? (
        <section className="surface">
          <EmptyState icon={Share2}>
            {unreadOnly ? "没有未读的社媒更新。" : "还没有跟踪到更新。"}
            <br />
            在客户详情里添加社媒账号（或用 AI 穿透一键挖出来），并把重点客户标到 {watchStar || 3} 星以上。
          </EmptyState>
        </section>
      ) : (
        <ul className="surface divide-y divide-border/70">
          {posts.map((p) => (
            <li key={p.id} className="flex gap-3 px-4 py-3.5 md:px-5">
              <SocialIcon platform={p.social.platform} className="mt-0.5 size-9 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <Link href={`/customers/${p.customer.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                    {p.customer.name}
                  </Link>
                  <StarRating value={p.customer.star} size="sm" />
                  <span>
                    {platformInfo(p.social.platform).label}
                    {p.social.handle && ` · ${p.social.handle}`}
                  </span>
                  <span className="tabular-nums">{formatDateTime(p.publishedAt, user.timezone)}</span>
                  {p.kind === "profile" && <span className="rounded bg-muted px-1.5 py-px">主页资料</span>}
                </div>
                <a
                  href={p.url ?? p.social.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn("block text-sm leading-snug hover:text-primary hover:underline", !p.readAt && "font-medium")}
                >
                  {p.title}
                </a>
                {p.summary && <p className="line-clamp-2 text-[13px] text-muted-foreground">{p.summary}</p>}
              </div>
              {p.image && (
                // eslint-disable-next-line @next/next/no-img-element -- 平台的缩略图
                <img src={p.image} alt="" className="hidden h-16 w-28 shrink-0 rounded-md object-cover sm:block" loading="lazy" />
              )}
              {!p.readAt && <MarkRead id={p.id} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums">{value}</p>
    </>
  );
  return href ? (
    <Link href={href} className="surface block px-4 py-3 transition-colors hover:bg-muted/40">
      {body}
    </Link>
  ) : (
    <div className="surface px-4 py-3">{body}</div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn("rounded-md px-3 py-1 transition-colors", active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}
    >
      {children}
    </Link>
  );
}
