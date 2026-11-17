import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Search } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { Pager } from "@/components/crm/customer-filters";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from "@/server/audit";
import type { Prisma } from "@/generated/prisma/client";
import { formatDateTime, parseLocalInput } from "@/lib/crm";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "操作日志" };

const PAGE_SIZE = 50;

/** 对象 → 详情页链接（删掉的打不开也没关系，会显示 404） */
function hrefOf(entity: string, id: string | null, action: string) {
  if (!id || action === "delete") return null;
  if (entity === "customer") return `/customers/${id}`;
  if (entity === "quotation") return `/quotations/${id}`;
  if (entity === "order") return `/orders/${id}`;
  if (entity === "approval") return "/approvals";
  return null;
}

const ACTION_TONE: Record<string, string> = {
  delete: "text-rose-700 bg-rose-50",
  release: "text-amber-700 bg-amber-50",
  transfer: "text-violet-700 bg-violet-50",
  reject: "text-rose-700 bg-rose-50",
  approve: "text-emerald-700 bg-emerald-50",
  create: "text-emerald-700 bg-emerald-50",
};

type Detail = Record<string, unknown> | null;

/** 字段改动 { 字段: [旧, 新] } 展开成一行行 */
function changeLines(detail: Detail) {
  if (!detail || typeof detail !== "object") return [];
  return Object.entries(detail)
    .filter(([, v]) => Array.isArray(v) && v.length === 2)
    .map(([k, v]) => {
      const [a, b] = v as [unknown, unknown];
      const show = (x: unknown) => (x === null || x === undefined || x === "" ? "空" : Array.isArray(x) ? x.join("、") || "空" : String(x));
      return `${k}：${show(a)} → ${show(b)}`;
    });
}

export default async function AuditPage({ searchParams }: PageProps<"/settings/audit">) {
  const user = await requirePermission("settings.audit");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const q = str("q");
  const entity = str("entity") in AUDIT_ENTITIES ? str("entity") : "";
  const action = str("action") in AUDIT_ACTIONS ? str("action") : "";
  const who = str("user");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str("from")) ? str("from") : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(str("to")) ? str("to") : "";
  const page = Math.max(1, Number(str("page")) || 1);
  const tz = user.timezone;
  const db = tenantDb(user.tenantId);

  const where: Prisma.AuditLogWhereInput = {
    ...(entity ? { entity } : {}),
    ...(action ? { action } : {}),
    ...(who ? { userId: who } : {}),
    ...(q
      ? {
          OR: [
            { summary: { contains: q, mode: "insensitive" } },
            { entityName: { contains: q, mode: "insensitive" } },
            { userName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: parseLocalInput(`${from}T00:00`, tz)! } : {}),
            ...(to ? { lt: new Date(parseLocalInput(`${to}T00:00`, tz)!.getTime() + 86_400_000) } : {}),
          },
        }
      : {}),
  };

  const [total, rows, members] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  const filtered = !!(q || entity || action || who || from || to);

  return (
    <>
      <PageHeader
        title="操作日志"
        description="谁在什么时候新建、修改、删除、转移了什么。只能查看，不能修改或删除。"
      />
      <div className="surface">
        <Form action="/settings/audit" className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-3 md:px-4">
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder="客户、单号、内容" className="h-8 pl-8" />
          </div>
          <NativeSelect name="user" defaultValue={who} className="h-8 w-auto" aria-label="操作人">
            <option value="">全部成员</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="entity" defaultValue={entity} className="h-8 w-auto" aria-label="对象">
            <option value="">全部对象</option>
            {Object.entries(AUDIT_ENTITIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="action" defaultValue={action} className="h-8 w-auto" aria-label="操作">
            <option value="">全部操作</option>
            {Object.entries(AUDIT_ACTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
          <Input type="date" name="from" defaultValue={from} className="h-8 w-auto" aria-label="开始日期" />
          <span className="text-sm text-muted-foreground">至</span>
          <Input type="date" name="to" defaultValue={to} className="h-8 w-auto" aria-label="结束日期" />
          <Button type="submit" size="sm" variant="secondary">
            查询
          </Button>
          {filtered && (
            <Button size="sm" variant="ghost" asChild>
              <Link href="/settings/audit">清空筛选</Link>
            </Button>
          )}
        </Form>

        {rows.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">
            {filtered ? "没有符合条件的记录" : "还没有操作记录。之后新建、修改、删除客户和单据，调整成员和权限，都会记在这里。"}
          </p>
        ) : (
          <ol className="divide-y divide-border/60">
            {rows.map((r) => {
              const href = hrefOf(r.entity, r.entityId, r.action);
              const lines = changeLines(r.detail as Detail);
              return (
                <li key={r.id} className="grid gap-x-4 gap-y-1 px-3 py-3 text-sm md:grid-cols-[9.5rem_6rem_1fr] md:px-4">
                  <time className="text-xs whitespace-nowrap text-muted-foreground tabular-nums md:pt-0.5 md:text-sm">
                    {formatDateTime(r.createdAt, tz)}
                  </time>
                  <span className="truncate font-medium">{r.userName ?? "系统"}</span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-px text-xs font-medium whitespace-nowrap",
                          ACTION_TONE[r.action] ?? "bg-muted text-foreground/70",
                        )}
                      >
                        {AUDIT_ENTITIES[r.entity] ?? r.entity} · {AUDIT_ACTIONS[r.action] ?? r.action}
                      </span>
                      {href ? (
                        <Link href={href} className="min-w-0 hover:text-primary hover:underline">
                          {r.summary}
                        </Link>
                      ) : (
                        <span className="min-w-0">{r.summary}</span>
                      )}
                    </p>
                    {lines.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {lines.map((l) => (
                          <li key={l} className="break-words">
                            {l}
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.ip && <p className="mt-0.5 text-xs text-muted-foreground/70 tabular-nums">IP {r.ip}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div className="border-t border-border/70 px-3 py-3 md:px-4 [&>div]:mt-0">
          <Pager
            path="/settings/audit"
            filters={{ q, entity, action, user: who, from, to }}
            page={page}
            pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            total={total}
          />
        </div>
      </div>
    </>
  );
}
