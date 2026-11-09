"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Copy, FileOutput, MoreHorizontal, Pencil, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { runAction } from "@/hooks/use-action-form";
import { QUOTATION_STATUSES } from "@/lib/docs";
import { deleteQuotationAction, duplicateQuotationAction, setQuotationStatusAction } from "../actions";

export function QuotationActions({
  id,
  no,
  status,
  perms,
}: {
  id: string;
  no: string;
  status: string;
  perms: { edit: boolean; create: boolean; delete: boolean; createOrder: boolean };
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  async function duplicate() {
    setBusy(true);
    const r = await runAction(duplicateQuotationAction(id));
    setBusy(false);
    if (r.ok && "id" in r && r.id) router.push(`/quotations/${r.id}/edit`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <a href={`/print/quotations/${id}`} target="_blank" rel="noreferrer">
          <Printer /> 打印 / PDF
        </a>
      </Button>
      {perms.edit && (
        <>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/quotations/${id}/edit`}>
              <Pencil /> 编辑
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                更改状态 <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {QUOTATION_STATUSES.filter((s) => s.value !== "CONVERTED" || status === "CONVERTED").map((s) => (
                <DropdownMenuItem key={s.value} disabled={s.value === status} onSelect={() => runAction(setQuotationStatusAction(id, s.value))}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      {perms.createOrder && (
        <Button size="sm" asChild>
          <Link href={`/orders/new?quotationId=${id}`}>
            <FileOutput /> 转为订单
          </Link>
        </Button>
      )}
      {(perms.create || perms.delete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="更多操作" disabled={busy}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{no}</DropdownMenuLabel>
            {perms.create && (
              <DropdownMenuItem onSelect={duplicate}>
                <Copy /> 复制为新报价单
              </DropdownMenuItem>
            )}
            {perms.delete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                  <Trash2 /> 删除
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`删除报价单 ${no}？`}
        description="删除后无法恢复。已转出的订单不受影响。"
        action={() => deleteQuotationAction(id)}
        onDone={() => router.push("/quotations")}
      />
    </div>
  );
}
