"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ExternalLink, Loader2, TriangleAlert, UserPlus, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { runAction } from "@/hooks/use-action-form";
import { cn } from "@/lib/utils";
import { countryName, extractDomain } from "@/lib/crm";
import {
  CONFIDENCE_LABELS,
  RESEARCH_STEPS,
  SECTION_LABELS,
  SUGGEST_FIELDS,
  researchLinks,
  sourceLabel,
  type ResearchFact,
  type ResearchReport,
  type ResearchStep,
  type SuggestField,
  type TradeStat,
} from "@/lib/ai-research";
import {
  addResearchContactAction,
  applyResearchFieldAction,
  researchProgressAction,
  startCustomerResearchAction,
} from "@/app/(app)/customers/research-actions";
import { Panel } from "./detail-ui";

export type ResearchView = {
  id: string;
  status: string;
  steps: ResearchStep[];
  error: string | null;
  report: ResearchReport | null;
  date: string;
  stale: boolean;
};

type Current = Partial<Record<SuggestField, string | null>>;

/** 建议值和现在的一样（官网只比域名）就不再提示 */
function same(key: SuggestField, value: string, cur: string | null | undefined) {
  if (!cur) return false;
  if (key === "website") return extractDomain(value) === extractDomain(cur);
  return value.trim().toLowerCase() === cur.trim().toLowerCase();
}

const POTENTIAL = { high: "高", medium: "中", low: "低" } as const;

/** 客户详情：AI 穿透报告（官网、搜索、域名、注册库、联合国进口统计） */
export function CustomerResearch({
  customerId,
  latest,
  canEdit,
  current,
}: {
  customerId: string;
  latest: ResearchView | null;
  canEdit: boolean;
  current: Current;
}) {
  const router = useRouter();
  const [starting, start] = useTransition();
  const [live, setLive] = useState<{ id: string; steps: ResearchStep[]; error?: string | null } | null>(
    latest?.status === "running" ? { id: latest.id, steps: latest.steps } : null,
  );
  const running = !!live && !live.error;

  // 进行中：每 3 秒问一次进度，完成后刷新页面拿报告
  useEffect(() => {
    if (!live || live.error) return;
    const t = setInterval(async () => {
      const p = await researchProgressAction(live.id);
      if (!p) return;
      if (p.status === "running") setLive((l) => (l ? { ...l, steps: p.steps } : l));
      else if (p.status === "failed") setLive({ id: live.id, steps: p.steps, error: p.error ?? "穿透失败" });
      else {
        setLive(null);
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [live, router]);

  const kickoff = () =>
    start(async () => {
      const r = await startCustomerResearchAction(customerId);
      if (r.ok && r.id) setLive({ id: r.id, steps: RESEARCH_STEPS.map((s) => ({ ...s, state: "wait" })) });
      else await runAction(Promise.resolve(r));
    });

  const report = latest?.status === "done" ? latest.report : null;
  const failed = live?.error ?? (!live && latest?.status === "failed" ? latest.error : null);

  return (
    <Panel
      title="AI 穿透"
      icon={<Building2 className="size-4 text-muted-foreground" />}
      action={
        report &&
        !running && (
          <Button size="xs" variant="ghost" className="text-primary" disabled={starting} onClick={kickoff}>
            {starting ? "正在开始…" : "重新穿透"}
          </Button>
        )
      }
      bodyClassName="px-4 pb-4 md:px-5"
    >
      {running ? (
        <Progress steps={live.steps} />
      ) : report ? (
        <Report id={latest!.id} report={report} date={latest!.date} stale={latest!.stale} canEdit={canEdit} current={current} />
      ) : (
        <div className="py-2">
          <p className="text-[13px] text-pretty text-muted-foreground">
            从官网、搜索引擎、域名注册和联合国进口统计里查这家公司：规模、品类、关键人物、风险，还有他们国家每年从中国进口多少我们这类产品。每条都带出处。
          </p>
          {failed && <p className="mt-2 text-[13px] text-destructive">上次没查完：{failed}</p>}
          <Button size="sm" className="mt-3" disabled={starting} onClick={kickoff}>
            {starting ? "正在开始…" : failed ? "再试一次" : "开始穿透"}
          </Button>
        </div>
      )}
    </Panel>
  );
}

function Progress({ steps }: { steps: ResearchStep[] }) {
  return (
    <div>
      <ol className="space-y-1.5" aria-live="polite">
        {steps.map((s) => (
          <li key={s.key} className={cn("flex items-center gap-2 text-[13px]", s.state === "wait" && "text-muted-foreground")}>
            <span className="flex size-4 shrink-0 items-center justify-center">
              {s.state === "run" ? (
                <Loader2 className="size-3.5" />
              ) : s.state === "done" ? (
                <Check className="size-3.5 text-ok" />
              ) : s.state === "fail" ? (
                <X className="size-3.5 text-warn" />
              ) : (
                <span className="size-1.5 rounded-full bg-border" />
              )}
            </span>
            <span>{s.label}</span>
            {s.note && <span className="truncate text-[12px] text-muted-foreground">{s.note}</span>}
            {s.state === "skip" && <span className="text-[12px] text-muted-foreground">跳过</span>}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12px] text-muted-foreground">大约 1～3 分钟，可以先去做别的，查完会显示在这里。</p>
    </div>
  );
}

function Source({ source }: { source: string }) {
  const label = sourceLabel(source);
  return /^https?:/.test(source) ? (
    <a
      href={source}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {label}
    </a>
  ) : (
    <span className="text-muted-foreground">{label}</span>
  );
}

function Report({
  id,
  report,
  date,
  stale,
  canEdit,
  current,
}: {
  id: string;
  report: ResearchReport;
  date: string;
  stale: boolean;
  canEdit: boolean;
  current: Current;
}) {
  const [open, setOpen] = useState(false);
  const j = report.judgment;
  const applied = new Set(report.applied ?? []);
  const sections = (Object.keys(SECTION_LABELS) as ResearchFact["section"][])
    .map((k) => ({ key: k, items: report.facts.filter((f) => f.section === k) }))
    .filter((s) => s.items.length);
  const suggestions = (Object.keys(SUGGEST_FIELDS) as SuggestField[])
    .map((k) => ({ key: k, s: report.suggestions?.[k] }))
    .filter((x): x is { key: SuggestField; s: { value: string; source: string } } => !!x.s?.value && !same(x.key, x.s.value, current[x.key]));

  return (
    <div className="space-y-4 text-[13px]">
      <div className="flex items-start gap-3">
        <div className="shrink-0 text-center">
          <p className="text-2xl leading-none font-semibold tabular-nums">{j.score}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">匹配度</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {report.company}
            <span className="ml-2 text-[12px] font-normal text-muted-foreground">采购潜力{POTENTIAL[j.potential]}</span>
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {date} 查的
            {stale && <span className="ml-1.5 text-warn">已超过 90 天，可能过时</span>}
          </p>
        </div>
      </div>

      {report.summary && <p className="text-pretty">{report.summary}</p>}

      {(j.contact || j.angle || j.next) && (
        <dl className="space-y-1.5 rounded-lg bg-muted/50 px-3 py-2.5">
          {j.contact && <Row label="找谁">{j.contact}</Row>}
          {j.angle && <Row label="切入点">{j.angle}</Row>}
          {j.next && <Row label="下一步">{j.next}</Row>}
        </dl>
      )}

      {report.signals.length > 0 && (
        <ul className="space-y-1.5">
          {report.signals.map((s, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {s.level === "risk" ? (
                  <TriangleAlert className="size-3.5 text-warn" />
                ) : s.level === "good" ? (
                  <Check className="size-3.5 text-ok" />
                ) : (
                  <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                )}
              </span>
              <span className="min-w-0 flex-1 text-pretty">
                {s.text} <span className="text-[11px]">· </span>
                <span className="text-[11px]">
                  <Source source={s.source} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {report.trade.length > 0 && <Trade stats={report.trade} />}

      {canEdit && suggestions.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[12px] font-medium text-muted-foreground">建议更新的资料</h3>
          <ul className="space-y-1.5">
            {suggestions.map(({ key, s }) => (
              <li key={key} className="flex items-start gap-2">
                <span className="w-16 shrink-0 text-muted-foreground">{SUGGEST_FIELDS[key]}</span>
                <span className="min-w-0 flex-1 break-words">
                  {key === "country" ? countryName(s.value) : s.value}
                  {current[key] && (
                    <span className="block text-[11px] text-muted-foreground">
                      现在是：{key === "country" ? countryName(current[key]) : current[key]}
                    </span>
                  )}
                </span>
                {applied.has(key) ? (
                  <span className="shrink-0 text-[12px] text-muted-foreground">已采用</span>
                ) : (
                  <Button size="xs" variant="outline" className="shrink-0" onClick={() => runAction(applyResearchFieldAction(id, key))}>
                    采用
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && (
        <>
          {sections.map((s) => (
            <div key={s.key}>
              <h3 className="mb-1.5 text-[12px] font-medium text-muted-foreground">{SECTION_LABELS[s.key]}</h3>
              <dl className="space-y-1.5">
                {s.items.map((f, i) => (
                  <Row key={i} label={f.label}>
                    <span className="break-words">{f.label === "社交主页" ? <Links value={f.value} /> : f.value}</span>
                    <span className="ml-1.5 text-[11px] whitespace-nowrap">
                      <Source source={f.source} />
                      {f.confidence === "low" && <span className="ml-1 text-warn">{CONFIDENCE_LABELS.low}</span>}
                    </span>
                  </Row>
                ))}
              </dl>
            </div>
          ))}
          {report.people.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[12px] font-medium text-muted-foreground">关键人物</h3>
              <ul className="space-y-1.5">
                {report.people.map((p) => (
                  <li key={p.name} className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{p.name}</span>
                      {p.title && <span className="text-muted-foreground"> · {p.title}</span>}
                      {p.email && <span className="block text-[12px]">{p.email}</span>}
                      <span className="block text-[11px]">
                        <Source source={p.source} />
                        {p.confidence === "low" && <span className="ml-1 text-warn">{CONFIDENCE_LABELS.low}</span>}
                      </span>
                    </span>
                    {canEdit &&
                      (applied.has(`person:${p.name}`) ? (
                        <span className="shrink-0 text-[12px] text-muted-foreground">已加</span>
                      ) : (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`加为联系人：${p.name}`}
                          title="加为联系人"
                          onClick={() => runAction(addResearchContactAction(id, p.name))}
                        >
                          <UserPlus />
                        </Button>
                      ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.sources.length > 0 && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">这次读过的 {report.sources.length} 个网页</summary>
              <ul className="mt-1.5 space-y-1">
                {report.sources.map((s) => (
                  <li key={s.url} className="truncate">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => setOpen(!open)}>
          {open ? "收起报告" : `完整报告（${report.facts.length} 条${report.people.length ? `、${report.people.length} 位关键人物` : ""}）`}
        </button>
        <span className="ml-auto flex gap-3">
          {researchLinks(report.company, report.domain).map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
            >
              {l.label}
              <ExternalLink className="size-3" />
            </a>
          ))}
        </span>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-pretty">{children}</dd>
    </div>
  );
}

function Links({ value }: { value: string }) {
  return (
    <span className="flex flex-wrap gap-x-2">
      {value.split(/\s+/).map((u) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
          {sourceLabel(u).split(".")[0]}
        </a>
      ))}
    </span>
  );
}

/** 万 / 亿美元 */
function money(n: number | null) {
  if (n == null) return "—";
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString()} 万`;
  return Math.round(n).toLocaleString();
}

function Trade({ stats }: { stats: TradeStat[] }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[12px] font-medium text-muted-foreground">{countryName(stats[0].country)}从中国进口（美元，联合国 Comtrade）</h3>
      <div className="space-y-3">
        {stats.map((t) => {
          const ys = t.years.filter((y) => y.china != null);
          const last = ys.at(-1);
          const prev = ys.at(-2);
          const growth = last?.china && prev?.china ? (last.china - prev.china) / prev.china : null;
          const max = Math.max(...t.years.map((y) => y.china ?? 0), 1);
          return (
            <div key={t.hs}>
              <p className="mb-1">
                <span className="font-medium">{t.product}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">HS {t.hs}</span>
                {growth != null && (
                  <span className={cn("ml-1.5 text-[12px] tabular-nums", growth >= 0 ? "text-ok" : "text-warn")}>
                    {growth >= 0 ? "+" : ""}
                    {Math.round(growth * 100)}%
                  </span>
                )}
              </p>
              <table className="w-full text-[12px] tabular-nums">
                <caption className="sr-only">{t.product} 每年从中国进口金额和占比</caption>
                <tbody>
                  {t.years.map((y) => (
                    <tr key={y.year}>
                      <th scope="row" className="w-11 py-0.5 text-left font-normal text-muted-foreground">
                        {y.year}
                      </th>
                      <td className="py-0.5 pr-2">
                        <span className="block h-1.5 rounded-full bg-chart-1" style={{ width: `${Math.max(2, ((y.china ?? 0) / max) * 100)}%` }} />
                      </td>
                      <td className="w-16 py-0.5 text-right">{money(y.china)}</td>
                      <td className="w-14 py-0.5 text-right text-muted-foreground">
                        {y.china != null && y.world ? `占 ${Math.round((y.china / y.world) * 100)}%` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
