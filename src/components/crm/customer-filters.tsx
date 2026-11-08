"use client";

import Form from "next/form";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { COUNTRIES } from "@/lib/crm";
import type { CustomerOptionsProp } from "@/components/crm/customer-form";

type Filters = Record<string, string | number>;

/** 客户列表筛选栏：GET 表单，筛选条件都在 URL 上，可分享、可刷新 */
export function CustomerFilters({
  action,
  filters,
  options,
  members,
  showFollow = true,
}: {
  action: string;
  filters: Filters;
  options: CustomerOptionsProp;
  members?: { id: string; name: string }[];
  showFollow?: boolean;
}) {
  const autoSubmit = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  const v = (k: string) => String(filters[k] ?? "");
  const active = ["q", "status", "group", "star", "country", "tag", "owner", "follow"].some((k) => v(k));
  return (
    <Form action={action} className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={v("q")} placeholder="公司名 / 联系人 / 邮箱 / 电话" className="pl-8" />
      </div>
      <NativeSelect name="status" defaultValue={v("status")} onChange={autoSubmit} className="w-auto" aria-label="状态">
        <option value="">全部状态</option>
        {options.statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect name="group" defaultValue={v("group")} onChange={autoSubmit} className="w-auto" aria-label="分组">
        <option value="">全部分组</option>
        {options.groups.map((g) => (
          <option key={g.id} value={g.id}>
            {"　".repeat(g.depth) + g.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect name="star" defaultValue={v("star")} onChange={autoSubmit} className="w-auto" aria-label="星级">
        <option value="">全部星级</option>
        {[5, 4, 3, 2, 1, 0].map((n) => (
          <option key={n} value={n}>
            {n ? "★".repeat(n) : "未评级"}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect name="country" defaultValue={v("country")} onChange={autoSubmit} className="w-auto max-w-40" aria-label="国家">
        <option value="">全部国家</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </NativeSelect>
      {members && members.length > 1 && (
        <NativeSelect name="owner" defaultValue={v("owner")} onChange={autoSubmit} className="w-auto" aria-label="负责人">
          <option value="">全部负责人</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      )}
      {showFollow && (
        <NativeSelect name="follow" defaultValue={v("follow")} onChange={autoSubmit} className="w-auto" aria-label="跟进">
          <option value="">全部跟进状态</option>
          <option value="due">今天及逾期待跟进</option>
          <option value="stale">超过 14 天未跟进</option>
        </NativeSelect>
      )}
      {v("tag") && <input type="hidden" name="tag" value={v("tag")} />}
      <Button type="submit" variant="secondary">
        查询
      </Button>
      {active && (
        <Button variant="ghost" asChild>
          <Link href={action}>清空筛选</Link>
        </Button>
      )}
    </Form>
  );
}

/** 分页（保留当前筛选条件） */
export function Pager({
  path,
  filters,
  page,
  pages,
  total,
}: {
  path: string;
  filters: Filters;
  page: number;
  pages: number;
  total: number;
}) {
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, val] of Object.entries(filters)) if (val && k !== "page") sp.set(k, String(val));
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${path}?${qs}` : path;
  };
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span>共 {total} 条</span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
            {page > 1 ? <Link href={href(page - 1)}>上一页</Link> : <span>上一页</span>}
          </Button>
          <span className="tabular-nums">
            {page} / {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} asChild={page < pages}>
            {page < pages ? <Link href={href(page + 1)}>下一页</Link> : <span>下一页</span>}
          </Button>
        </div>
      )}
    </div>
  );
}
