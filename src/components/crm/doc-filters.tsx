"use client";

import Form from "next/form";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";

/** 报价单 / 订单列表的筛选栏（GET 表单），放在列表卡片的工具条里 */
export function DocFilters({
  action,
  filters,
  statuses,
  members,
}: {
  action: string;
  filters: { q: string; status: string; owner: string };
  statuses: readonly { value: string; label: string }[];
  members: { id: string; name: string }[];
}) {
  const autoSubmit = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  const active = filters.q || filters.status || filters.owner;
  return (
    <Form action={action} className="flex flex-1 flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-60">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={filters.q} placeholder="单号 / 客户 / 联系人" className="h-8 pl-8" />
      </div>
      <NativeSelect name="status" defaultValue={filters.status} onChange={autoSubmit} className="h-8 w-auto" aria-label="状态">
        <option value="">全部状态</option>
        {statuses.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </NativeSelect>
      {members.length > 1 && (
        <NativeSelect name="owner" defaultValue={filters.owner} onChange={autoSubmit} className="h-8 w-auto" aria-label="负责人">
          <option value="">全部负责人</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      )}
      <Button type="submit" size="sm" variant="secondary">
        查询
      </Button>
      {active && (
        <Button size="sm" variant="ghost" asChild>
          <Link href={action}>清空筛选</Link>
        </Button>
      )}
    </Form>
  );
}
