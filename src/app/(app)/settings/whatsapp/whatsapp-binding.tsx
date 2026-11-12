"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, TriangleAlert } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  pairPhone: string | null;
  pairCode: string | null;
};

type Mode = "phone" | "qr";

const LINKED_DEVICES = (
  <>
    点 <strong>设置</strong>（iPhone）或 <strong>⋮ 菜单</strong>（安卓）→ <strong>已关联的设备</strong> → <strong>关联新设备</strong>
  </>
);

export function WhatsappBinding({ account: a, qr, tz }: { account: Account | null; qr: string | null; tz: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [mode, setMode] = useState<Mode>(a?.pairPhone === null && a?.phone ? "qr" : "phone");
  const [phone, setPhone] = useState(a?.pairPhone ?? a?.phone ?? "");
  const waiting = a?.enabled && a.status !== "CONNECTED";
  const pairing = waiting && !!a?.pairPhone;

  // 等待扫码 / 输入配对码时每 2 秒刷新一次状态
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [waiting, router]);

  async function run(p: Promise<unknown>) {
    setBusy(true);
    try {
      await runAction(p as never);
    } finally {
      setBusy(false);
    }
  }

  const code = a?.pairCode ? `${a.pairCode.slice(0, 4)}-${a.pairCode.slice(4)}` : null;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex gap-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <p>
          这里走的是 WhatsApp 网页版协议，不是官方商业接口。正常一对一沟通没有问题，但<strong>不要用它群发、频繁加陌生人</strong>，否则号码可能被
          WhatsApp 限制。建议先用业务专用号码。
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
                    ? pairing
                      ? code
                        ? "请在手机上输入配对码"
                        : "正在获取配对码…"
                      : qr
                        ? "请用手机扫码"
                        : "正在连接…"
                    : "未连接"}
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                a?.status === "CONNECTED"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : waiting
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : ""
              }
            >
              {a?.status === "CONNECTED" ? "已连接" : waiting ? "连接中" : "未连接"}
            </Badge>
          </div>

          {a?.lastError && !waiting && <p className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">{a.lastError}</p>}

          {/* 暂时断开过：登录凭证还在，直接重连 */}
          {!a?.enabled && a?.phone && (
            <Button disabled={busy} onClick={() => run(connectWhatsappAction(a.pairPhone ?? undefined))}>
              重新连接 +{a.phone}
            </Button>
          )}

          {/* 未登录：选择登录方式 */}
          {!a?.enabled && !a?.phone && (
            <div className="space-y-3 rounded-2xl bg-muted/60 p-4">
              <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <TabsList>
                  <TabsTrigger value="phone">手机号登录</TabsTrigger>
                  <TabsTrigger value="qr">扫码登录</TabsTrigger>
                </TabsList>
              </Tabs>
              {mode === "phone" ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(connectWhatsappAction(phone));
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="wa-phone">WhatsApp 手机号</Label>
                    <Input
                      id="wa-phone"
                      inputMode="tel"
                      placeholder="带国家码，例如 8613800138000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="max-w-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      不用加 +，中国号码以 86 开头。提交后会显示一个 8
                      位配对码，在手机上输入即可，不需要扫码。这种方式只能同步最近的聊天记录，要同步全部历史请用扫码登录。
                    </p>
                  </div>
                  <Button type="submit" disabled={busy || phone.replace(/\D/g, "").length < 8}>
                    获取配对码
                  </Button>
                </form>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    生成二维码后，用手机 WhatsApp 扫描，关联后会同步手机上的全部历史聊天。如果扫码时提示无法关联设备，请改用手机号登录。
                  </p>
                  <Button disabled={busy} onClick={() => run(connectWhatsappAction())}>
                    获取登录二维码
                  </Button>
                </div>
              )}
            </div>
          )}

          {waiting && pairing && (
            <div className="flex flex-col items-center gap-4 rounded-2xl bg-muted/60 p-5 sm:flex-row sm:items-start">
              <div className="flex h-[120px] w-[264px] shrink-0 flex-col items-center justify-center gap-1 rounded-md bg-muted">
                {code ? (
                  <>
                    <span className="font-mono text-3xl font-normal tracking-[0.2em] select-all">{code}</span>
                    <span className="text-xs text-muted-foreground">+{a?.pairPhone}</span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">配对码生成中…</span>
                )}
              </div>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                <li>在手机上打开 WhatsApp</li>
                <li>{LINKED_DEVICES}</li>
                <li>
                  点底部的 <strong>改用电话号码关联</strong>，输入左侧 8 位配对码
                </li>
                <li>2 分钟内没输入会自动停止，需重新获取</li>
              </ol>
            </div>
          )}

          {waiting && !pairing && (
            <div className="flex flex-col items-center gap-4 rounded-2xl bg-muted/60 p-5 sm:flex-row sm:items-start">
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
                <li>{LINKED_DEVICES}</li>
                <li>扫描左侧二维码</li>
                <li>二维码约 20 秒刷新一次，2 分钟内没扫会自动停止</li>
              </ol>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
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
        description="会从手机的「已关联的设备」中移除本系统，下次需要重新登录。已同步的聊天记录会保留。"
        confirmText="退出登录"
        action={() => disconnectWhatsappAction(true)}
      />
    </div>
  );
}
