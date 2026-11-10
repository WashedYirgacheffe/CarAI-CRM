"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Eye, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/crm/bits";
import { runAction } from "@/hooks/use-action-form";
import { formatDateTime } from "@/lib/crm";
import { ENROLLMENT_STATUS } from "@/lib/sequences";
import { removeEnrollmentsAction, stopEnrollmentsAction } from "../actions";

type Row = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  country: string | null;
  customerId: string | null;
  status: string;
  step: number;
  nextAt: string | null;
  lastSentAt: string | null;
  error: string | null;
  lastMessageId: string | null;
  opens: number;
  clicks: number;
};

const TONE_COLOR = { primary: "blue", success: "emerald", muted: "slate", warning: "amber", danger: "rose" } as const;

export function RecipientTable({ sequenceId, totalSteps, tz, rows }: { sequenceId: string; totalSteps: number; tz: string; rows: Row[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const all = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggle = (id: string, v: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  const bulk = (fn: typeof stopEnrollmentsAction) =>
    start(async () => {
      const r = await runAction(fn(sequenceId, [...picked]));
      if (r.ok) setPicked(new Set());
    });

  if (!rows.length) return <p className="py-14 text-center text-sm text-muted-foreground">还没有收件人，点右上角「添加收件人」</p>;

  return (
    <>
      {picked.size > 0 && (
        <div className="flex items-center gap-2 border-b border-border/70 bg-primary/5 px-4 py-2 text-sm">
          已选 {picked.size} 位
          <Button size="xs" variant="outline" disabled={pending} onClick={() => bulk(stopEnrollmentsAction)}>
            停止发送
          </Button>
          <Button size="xs" variant="ghost" disabled={pending} onClick={() => bulk(removeEnrollmentsAction)}>
            移出序列
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4">
                <Checkbox checked={all} onCheckedChange={(v) => setPicked(v ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="全选" />
              </TableHead>
              <TableHead>收件人</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>进度</TableHead>
              <TableHead>互动</TableHead>
              <TableHead>最近发送</TableHead>
              <TableHead>下一封</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const st = ENROLLMENT_STATUS[r.status];
              return (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <Checkbox checked={picked.has(r.id)} onCheckedChange={(v) => toggle(r.id, !!v)} aria-label={`选择 ${r.email}`} />
                  </TableCell>
                  <TableCell>
                    <div className="max-w-72 min-w-0">
                      <p className="truncate font-medium">
                        {r.customerId ? (
                          <Link href={`/customers/${r.customerId}`} className="hover:text-primary">
                            {r.company || r.name || r.email}
                          </Link>
                        ) : (
                          r.company || r.name || r.email
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{[r.name, r.email, r.country].filter(Boolean).join(" · ")}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span title={r.error ?? undefined}>
                      <StatusBadge name={st?.label ?? r.status} color={TONE_COLOR[st?.tone ?? "muted"]} />
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <span className="flex items-center gap-2">
                      <span className="flex gap-0.5">
                        {Array.from({ length: totalSteps }, (_, i) => (
                          <span key={i} className={i < r.step ? "h-1.5 w-3 rounded-full bg-[var(--chart-1)]" : "h-1.5 w-3 rounded-full bg-muted"} />
                        ))}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.step}/{totalSteps}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {r.lastMessageId ? (
                      <Link
                        href={`/mail?box=sent&id=${r.lastMessageId}`}
                        className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums hover:text-primary"
                      >
                        <span className="flex items-center gap-1" title="打开次数（最近一封）">
                          <Eye className={r.opens ? "size-3.5 text-primary" : "size-3.5"} /> {r.opens}
                        </span>
                        <span className="flex items-center gap-1" title="点击次数（最近一封）">
                          <MousePointerClick className={r.clicks ? "size-3.5 text-primary" : "size-3.5"} /> {r.clicks}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {r.lastSentAt ? formatDateTime(r.lastSentAt, tz) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {r.status === "ACTIVE" && r.nextAt ? formatDateTime(r.nextAt, tz) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
