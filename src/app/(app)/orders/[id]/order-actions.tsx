"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, MoreHorizontal, Pencil, Printer, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { runAction } from "@/hooks/use-action-form";
import { ORDER_STATUSES } from "@/lib/docs";
import { deleteOrderAction, setOrderStatusAction } from "../actions";

export function OrderActions({ id, no, status, perms }: { id: string; no: string; status: string; perms: { edit: boolean; delete: boolean } }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <a href={`/print/orders/${id}`} target="_blank" rel="noreferrer">
          <Printer /> 打印 PI
        </a>
      </Button>
      {perms.edit && (
        <>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/orders/${id}/edit`}>
              <Pencil /> 编辑
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                更改状态 <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {ORDER_STATUSES.map((s) => (
                <DropdownMenuItem key={s.value} disabled={s.value === status} onSelect={() => runAction(setOrderStatusAction(id, s.value))}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      {perms.delete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="更多操作">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
              <Trash2 /> 删除订单
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`删除订单 ${no}？`}
        description="订单明细和收款记录会一起删除，且无法恢复。不做了的订单建议改为「已取消」。"
        action={() => deleteOrderAction(id)}
        onDone={() => router.push("/orders")}
      />
    </div>
  );
}
