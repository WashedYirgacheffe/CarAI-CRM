"use client";

import { useState } from "react";
import { RefreshCw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { runAction } from "@/hooks/use-action-form";
import { syncNowAction } from "./actions";

export function SyncButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className={className ?? "w-full"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await runAction(syncNowAction());
        setBusy(false);
      }}
    >
      <RefreshCw className={busy ? "animate-spin" : undefined} /> {busy ? "同步中…" : "收信"}
    </Button>
  );
}
