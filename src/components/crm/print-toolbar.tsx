"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintToolbar({ backHref, hint }: { backHref: string; hint?: string }) {
  return (
    <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-2 print:hidden">
      <a href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
        ← 返回
      </a>
      <div className="flex items-center gap-3">
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        <Button size="sm" onClick={() => window.print()}>
          <Printer /> 打印 / 另存为 PDF
        </Button>
      </div>
    </div>
  );
}
