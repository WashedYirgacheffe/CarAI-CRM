import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/crm/empty-state";
import { SocialIcon } from "@/components/crm/social-icon";
import { Globe, Share2 } from "@/components/icons";
import { can, requireUser } from "@/server/auth";
import { onlineRunners } from "@/server/matrix";
import { prisma, tenantDb } from "@/server/db";
import { appUrl } from "@/server/share";
import { formatDateTime } from "@/lib/crm";
import { ACCOUNT_STATUS, JOB_KIND, JOB_STATUS, matrixPlatform } from "@/lib/matrix";
import { cn } from "@/lib/utils";
import { AccountButton, AccountRowActions, AutoRefresh, ProxyButton, ProxyRowActions, RunnerSetupButton } from "./matrix-client";

export const metadata: Metadata = { title: "社媒矩阵" };

const TONE = {
  muted: "bg-muted text-muted-foreground",
  warn: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  ok: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  bad: "bg-destructive/10 text-destructive",
} as const;

/** 社媒矩阵：托管账号（固定指纹 + 代理）、代理 IP、环境运行器状态。方案见 docs/social-matrix-plan.md */
export default async function SocialMatrixPage({ searchParams }: PageProps<"/social/matrix">) {
  const user = await requireUser();
  const manage = can(user, "matrix.manage");
  if (!manage && !can(user, "matrix.use")) {
    return (
      <>
        <PageHeader title="社媒矩阵" />
        <section className="surface">
          <EmptyState icon={Share2}>没有社媒矩阵的权限，请联系管理员。</EmptyState>
        </section>
      </>
    );
  }
  const tab = (await searchParams).tab === "proxies" && manage ? "proxies" : "accounts";
  const db = tenantDb(user.tenantId);
  const tz = user.timezone;

  const crmUrl = appUrl();
  const [accounts, proxies, members, runners, tenant] = await Promise.all([
    db.matrixAccount.findMany({
      where: manage ? {} : { ownerId: user.id },
      orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
      include: {
        owner: { select: { name: true } },
        proxy: { select: { id: true, name: true, exitIp: true, country: true, countryCode: true, timezone: true, lastError: true } },
        jobs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.matrixProxy.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { accounts: true } } } }),
    manage ? db.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    onlineRunners(user.tenantId),
    manage ? prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { matrixRunnerTokenHash: true } }) : null,
  ]);
  const active = accounts.some((a) => a.jobs[0] && ["queued", "running", "waiting"].includes(a.jobs[0].status));
  const proxyOptions = proxies.map((p) => ({
    id: p.id,
    label: `${p.name}${p.exitIp ? ` · ${p.exitIp}` : ""}${p.country ? ` · ${p.country}` : ""}${p.lastError ? "（检测未通过）" : ""}`,
  }));

  return (
    <>
      <PageHeader
        title="社媒矩阵"
        description="每个账号一个固定指纹 + 一个代理 IP 的独立浏览器环境，由环境运行器在后台执行"
        actions={
          manage ? (
            tab === "proxies" ? (
              <ProxyButton />
            ) : (
              <AccountButton proxies={proxyOptions} members={members} defaultOwnerId={user.id} />
            )
          ) : null
        }
      />
      <AutoRefresh active={active} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
          <TabLink href="/social/matrix" on={tab === "accounts"}>
            账号 <span className="tabular-nums text-muted-foreground">{accounts.length}</span>
          </TabLink>
          {manage && (
            <TabLink href="/social/matrix?tab=proxies" on={tab === "proxies"}>
              代理 IP <span className="tabular-nums text-muted-foreground">{proxies.length}</span>
            </TabLink>
          )}
        </nav>
        <RunnerBadge runners={runners.map((r) => ({ host: r.host, busy: r.busy, shared: !r.tenantId }))} />
        {manage && <RunnerSetupButton crmUrl={crmUrl} hasToken={!!tenant?.matrixRunnerTokenHash} />}
      </div>

      {tab === "accounts" ? (
        accounts.length === 0 ? (
          <section className="surface">
            <EmptyState icon={Share2}>
              {manage
                ? proxies.length
                  ? "还没有账号。点右上角「添加账号」，选平台、绑一个代理 IP。"
                  : "先到「代理 IP」里添加代理，再添加账号。每个账号都要绑一个代理。"
                : "还没有分配给你的社媒账号。"}
            </EmptyState>
          </section>
        ) : (
          <ul className="surface divide-y divide-border/70">
            {accounts.map((a) => {
              const p = matrixPlatform(a.platform);
              const st = ACCOUNT_STATUS[a.status] ?? ACCOUNT_STATUS.new;
              const job = a.jobs[0];
              const jobActive = job && ["queued", "running", "waiting"].includes(job.status);
              return (
                <li key={a.id} className="grid items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <SocialIcon platform={a.platform} className="size-8" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p?.label ?? a.platform}
                        {a.login && ` · ${a.login}`}
                        {a.owner && ` · ${a.owner.name}`}
                      </p>
                    </div>
                  </div>
                  <div className="min-w-0 text-xs">
                    {a.proxy ? (
                      <>
                        <p className={cn("flex items-center gap-1 truncate", a.proxy.lastError && "text-destructive")}>
                          <Globe className="size-3 shrink-0" />
                          {a.proxy.exitIp ?? a.proxy.name}
                          {a.proxy.countryCode && <span className="text-muted-foreground">· {a.proxy.countryCode}</span>}
                        </p>
                        <p className="truncate text-muted-foreground">{a.proxy.lastError ?? a.proxy.timezone ?? "未检测"}</p>
                      </>
                    ) : (
                      <p className="text-destructive">没绑代理</p>
                    )}
                  </div>
                  <div className="min-w-0 text-xs">
                    <span className={cn("inline-block rounded px-1.5 py-px", TONE[st.tone])}>{st.label}</span>
                    {job && (
                      <p
                        className={cn(
                          "mt-1 truncate",
                          job.status === "waiting" ? "font-medium text-amber-700 dark:text-amber-400" : job.status === "failed" ? "text-destructive" : "text-muted-foreground",
                        )}
                        title={job.error ?? undefined}
                      >
                        {JOB_KIND[job.kind] ?? job.kind} · {JOB_STATUS[job.status] ?? job.status}
                        {job.status === "waiting" && "：去运行器电脑上的窗口里扫码或输入密码"}
                        {job.status === "failed" && job.error && `：${job.error}`}
                        {!jobActive && job.finishedAt && ` · ${formatDateTime(job.finishedAt, tz)}`}
                      </p>
                    )}
                  </div>
                  <AccountRowActions
                    account={{
                      id: a.id,
                      platform: a.platform,
                      name: a.name,
                      login: a.login,
                      ownerId: a.ownerId,
                      proxyId: a.proxyId,
                      os: a.os,
                      note: a.note,
                      hasPassword: !!a.passwordEnc,
                      locked: !!a.fingerprint,
                      status: a.status,
                    }}
                    activeJobId={jobActive ? job.id : null}
                    manage={manage}
                    proxies={proxyOptions}
                    members={members}
                  />
                </li>
              );
            })}
          </ul>
        )
      ) : proxies.length === 0 ? (
        <section className="surface">
          <EmptyState icon={Globe}>还没有代理 IP。点右上角「添加代理」，填地址、端口和账号密码，保存后会自动检测出口 IP 和所在国家。</EmptyState>
        </section>
      ) : (
        <ul className="surface divide-y divide-border/70">
          {proxies.map((p) => (
            <li key={p.id} className="grid items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto] md:px-5">
              <div className="min-w-0">
                <p className="truncate font-medium">{p.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {p.protocol}://{p.host}:{p.port}
                  {p.username && ` · ${p.username}`} · {p._count.accounts} 个账号
                </p>
              </div>
              <div className="min-w-0 text-xs">
                {p.lastError ? (
                  <p className="truncate text-destructive">检测未通过：{p.lastError}</p>
                ) : p.exitIp ? (
                  <>
                    <p className="truncate">
                      {p.exitIp} · {p.country} {p.city && <span className="text-muted-foreground">{p.city}</span>}
                      {p.hosting && <span className="ml-1.5 rounded bg-amber-500/12 px-1 text-amber-700 dark:text-amber-400">机房 IP</span>}
                    </p>
                    <p className="truncate text-muted-foreground">
                      {p.timezone} · {p.isp} · {p.latencyMs}ms
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">未检测</p>
                )}
                {p.checkedAt && <p className="text-muted-foreground">{formatDateTime(p.checkedAt, tz)} 检测</p>}
              </div>
              <ProxyRowActions
                proxy={{ id: p.id, name: p.name, protocol: p.protocol, host: p.host, port: p.port, username: p.username, note: p.note, hasPassword: !!p.passwordEnc }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TabLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn("rounded-md px-3 py-1", on ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
      {children}
    </Link>
  );
}

function RunnerBadge({ runners }: { runners: { host: string; busy: number; shared: boolean }[] }) {
  if (!runners.length)
    return (
      <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground" title="在要跑浏览器的电脑上执行：pnpm matrix-runner">
        <span className="size-1.5 rounded-full bg-muted-foreground/50" /> 运行器未启动（pnpm matrix-runner）
      </span>
    );
  return (
    <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      运行器在线：{runners.map((r) => `${r.host}${r.busy ? `（${r.busy} 个任务）` : ""}`).join("、")}
    </span>
  );
}
