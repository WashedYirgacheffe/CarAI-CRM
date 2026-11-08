"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { runAction } from "@/hooks/use-action-form";
import { formatDateTime } from "@/lib/crm";
import { connectWhatsappAction, disconnectWhatsappAction } from "@/app/(app)/whatsapp/actions";

type Account = {
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED";
  enabled: boolean;
  phone: string | null;
  name: string | null;
  lastError: string | null;
  connectedAt: string | null;
};

export function WhatsappBinding({ account: a, qr, tz }: { account: Account | null; qr: string | null; tz: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const waiting = a?.enabled && a.status !== "CONNECTED";

  // 等待扫码 / 连接时每 2 秒刷新一次状态
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [waiting, router]);

  async function run(p: Promise<unknown>) {
    setBusy(true);
    await runAction(p as never);
    setBusy(false);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <p>
          扫码登录走的是 WhatsApp 网页版协议，不是官方商业接口。正常一对一沟通没有问题，但<strong>不要用它群发、频繁加陌生人</strong>，否则号码可能被 WhatsApp 限制。建议先用业务专用号码。
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <MessageCircle className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{a?.status === "CONNECTED" ? `${a.name ?? "WhatsApp"} · +${a.phone}` : "WhatsApp"}</p>
              <p className="text-xs text-muted-foreground">
                {a?.status === "CONNECTED"
                  ? `已连接${a.connectedAt ? `，${formatDateTime(a.connectedAt, tz)} 登录` : ""}`
                  : waiting
                    ? qr
                      ? "请用手机扫码"
                      : "正在连接…"
                    : "未连接"}
              </p>
            </div>
            <Badge
              variant="outline"
              className={a?.status === "CONNECTED" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : waiting ? "border-amber-200 bg-amber-50 text-amber-800" : ""}
            >
              {a?.status === "CONNECTED" ? "已连接" : waiting ? "连接中" : "未连接"}
            </Badge>
          </div>

          {a?.lastError && !waiting && <p className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">{a.lastError}</p>}

          {waiting && (
            <div className="flex flex-col items-center gap-4 rounded-lg border p-5 sm:flex-row sm:items-start">
              <div className="flex size-[264px] shrink-0 items-center justify-center rounded-md bg-muted">
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt="WhatsApp 登录二维码" width={264} height={264} />
                ) : (
                  <span className="text-sm text-muted-foreground">二维码生成中…</span>
                )}
              </div>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                <li>在手机上打开 WhatsApp</li>
                <li>
                  点 <strong>设置</strong>（iPhone）或 <strong>⋮ 菜单</strong>（安卓）→ <strong>已关联的设备</strong>
                </li>
                <li>
                  点 <strong>关联新设备</strong>，扫描左侧二维码
                </li>
                <li>二维码约 20 秒刷新一次，2 分钟内没扫会自动停止</li>
              </ol>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!a?.enabled && (
              <Button disabled={busy} onClick={() => run(connectWhatsappAction())}>
                {a?.phone ? "重新连接" : "获取登录二维码"}
              </Button>
            )}
            {a?.enabled && (
              <Button variant="outline" disabled={busy} onClick={() => run(disconnectWhatsappAction(false))}>
                {waiting ? "取消" : "暂时断开"}
              </Button>
            )}
            {a?.phone && (
              <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmLogout(true)}>
                退出登录
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="退出 WhatsApp 登录？"
        description="会从手机的「已关联的设备」中移除本系统，下次需要重新扫码。已同步的聊天记录会保留。"
        confirmText="退出登录"
        action={() => disconnectWhatsappAction(true)}
      />
    </div>
  );
}
