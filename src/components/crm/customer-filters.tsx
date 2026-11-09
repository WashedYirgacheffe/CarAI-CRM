"use client";

import { useState } from "react";
import Form from "next/form";
import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { cn } from "@/lib/utils";
import { COUNTRIES } from "@/lib/crm";
import { CUSTOMER_FILTER_KEYS, FOLLOW_OPTIONS } from "@/lib/segments";
import type { CustomerOptionsProp } from "@/components/crm/customer-form";

type Filters = Record<string, string | number>;

/**
 * 客户列表筛选：GET 表单，筛选条件都在 URL 上，可分享、可刷新。
 * 放在列表工具条里：表单本身 display:contents，搜索框和「筛选」按钮靠右，
 * 展开的筛选项另起一行。
 */
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
  /** 是否在筛选项里显示「跟进状态」下拉；不显示时沿用 URL 上的 follow（左侧快捷筛选） */
  showFollow?: boolean;
}) {
  const autoSubmit = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  const v = (k: string) => String(filters[k] ?? "");
  const active = CUSTOMER_FILTER_KEYS.some((k) => v(k));
  const panelKeys = ["status", "group", "star", "country", "owner", "idle", ...(showFollow ? ["follow"] : [])];
  const panelCount = panelKeys.filter((k) => v(k)).length;
  const [open, setOpen] = useState(panelCount > 0);
  const sel = "h-8 w-auto text-[13px]";

  return (
    // key：点左侧客群 / 快捷筛选是客户端跳转，非受控输入框要随 URL 重置，否则会带着旧值再提交
    <Form key={CUSTOMER_FILTER_KEYS.map(v).join("|")} action={action} className="contents">
      <div className="relative ml-auto w-full sm:w-60">
        <button
          type="submit"
          className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="搜索"
        >
          <Search className="size-4" />
        </button>
        <Input name="q" defaultValue={v("q")} placeholder="公司名 / 联系人 / 邮箱 / 电话" className="h-8 pl-8 text-[13px]" />
      </div>
      <Button
        type="button"
        size="sm"
        variant={open ? "secondary" : "outline"}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <SlidersHorizontal />
        筛选
        {panelCount > 0 && <span className="tabular-nums text-primary">{panelCount}</span>}
      </Button>
      {active && (
        <Button variant="ghost" size="sm" asChild>
          <Link href={action}>清空</Link>
        </Button>
      )}

      {/* 收起时只隐藏不卸载，已选的筛选项在搜索时继续生效 */}
      <div className={cn("flex basis-full flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-2", !open && "hidden")}>
        <NativeSelect name="status" defaultValue={v("status")} onChange={autoSubmit} className={sel} aria-label="状态">
          <option value="">全部状态</option>
          {options.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="group" defaultValue={v("group")} onChange={autoSubmit} className={sel} aria-label="分组">
          <option value="">全部分组</option>
          {options.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {"　".repeat(g.depth) + g.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="star" defaultValue={v("star")} onChange={autoSubmit} className={sel} aria-label="星级">
          <option value="">全部星级</option>
          {[5, 4, 3, 2, 1, 0].map((n) => (
            <option key={n} value={n}>
              {n ? "★".repeat(n) : "未评级"}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="country" defaultValue={v("country")} onChange={autoSubmit} className={cn(sel, "max-w-40")} aria-label="国家">
          <option value="">全部国家</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        {members && members.length > 1 && (
          <NativeSelect name="owner" defaultValue={v("owner")} onChange={autoSubmit} className={sel} aria-label="负责人">
            <option value="">全部负责人</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        )}
        {showFollow && (
          <NativeSelect name="follow" defaultValue={v("follow")} onChange={autoSubmit} className={sel} aria-label="跟进">
            <option value="">全部跟进状态</option>
            {FOLLOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        )}
        <label className="flex items-center gap-1 text-[13px] text-muted-foreground">
          <Input
            name="idle"
            type="number"
            min={1}
            max={3650}
            defaultValue={v("idle")}
            placeholder="N"
            className="h-8 w-16 text-[13px]"
            aria-label="多少天未联系"
          />
          天未联系
        </label>
        <Button type="submit" size="sm" variant="outline">
          查询
        </Button>
      </div>
      {!showFollow && v("follow") && <input type="hidden" name="follow" value={v("follow")} />}
      {v("tag") && <input type="hidden" name="tag" value={v("tag")} />}
    </Form>
  );
}

/** 分页（保留当前筛选条件）。放在卡片底部时用 className 加上边框和内边距 */
export function Pager({
  path,
  filters,
  page,
  pages,
  total,
  className,
}: {
  path: string;
  filters: Filters;
  page: number;
  pages: number;
  total: number;
  className?: string;
}) {
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, val] of Object.entries(filters)) if (val && k !== "page") sp.set(k, String(val));
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${path}?${qs}` : path;
  };
  return (
    <div className={cn("mt-3 flex min-h-8 items-center justify-between gap-3 text-[13px] text-muted-foreground", className)}>
      <span>
        共 <span className="tabular-nums">{total}</span> 条
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="xs" disabled={page <= 1} asChild={page > 1}>
            {page > 1 ? <Link href={href(page - 1)}>上一页</Link> : <span>上一页</span>}
          </Button>
          <span className="tabular-nums">
            {page} / {pages}
          </span>
          <Button variant="outline" size="xs" disabled={page >= pages} asChild={page < pages}>
            {page < pages ? <Link href={href(page + 1)}>下一页</Link> : <span>下一页</span>}
          </Button>
        </div>
      )}
    </div>
  );
}
