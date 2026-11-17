"use client";

import { useTransition } from "react";
import { Trash2 } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { runAction } from "@/hooks/use-action-form";
import { revokeDeviceAction, setMatrixCloudAction } from "./actions";

type Device = {
  id: string;
  name: string;
  os: string | null;
  appVersion: string | null;
  owner: string;
  accounts: number;
  lastSeenAt: string | null;
  online: boolean;
  /** 桌面版报的状态，如「正在下载浏览器内核 41%」 */
  note: string | null;
};

const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
function ago(iso: string | null) {
  if (!iso) return "从未连接";
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (s > -60) return "刚刚";
  if (s > -3600) return rtf.format(Math.round(s / 60), "minute");
  if (s > -86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

export function MatrixRunSettings({ cloudConfigured, cloudEnabled, devices }: { cloudConfigured: boolean; cloudEnabled: boolean; devices: Device[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section className="surface p-6">
        <label className="flex items-start gap-3">
          <Checkbox
            className="mt-0.5"
            checked={cloudEnabled}
            disabled={!cloudConfigured || pending}
            onCheckedChange={(v) => start(async () => void (await runAction(setMatrixCloudAction(v === true))))}
          />
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">云端运行器</span>
            <span className="text-sm text-muted-foreground">
              {cloudConfigured
                ? "打开后，没有归属电脑的账号会在云端浏览器里执行（登录、检测、收发私信），按实际运行时间计费。关闭时这些账号暂停，直到在桌面版里登录。"
                : "服务器还没有配置云端运行器。"}
            </span>
          </span>
        </label>
      </section>

      <section className="surface">
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-sm font-medium">已连接的电脑</h2>
          <span className="text-xs text-muted-foreground">在电脑上打开车车 CRM 桌面版并登录后，会自动出现在这里</span>
        </div>
        {devices.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>电脑</TableHead>
                <TableHead>使用人</TableHead>
                <TableHead>账号</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{[d.os, d.appVersion && `桌面版 ${d.appVersion}`].filter(Boolean).join(" · ")}</div>
                  </TableCell>
                  <TableCell>{d.owner}</TableCell>
                  <TableCell className="tabular-nums">{d.accounts}</TableCell>
                  <TableCell>
                    {d.online ? (
                      <div className="space-y-0.5">
                        <Badge>在线</Badge>
                        {d.note && <div className="text-xs text-muted-foreground">{d.note}</div>}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">离线 · {ago(d.lastSeenAt)}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`移除 ${d.name}`}
                      disabled={pending}
                      onClick={() => {
                        const tip = d.accounts ? `\n归属这台电脑的 ${d.accounts} 个账号会失去归属，换地方运行需要重新登录。` : "";
                        if (confirm(`移除「${d.name}」？这台电脑上的桌面版会立即断开。${tip}`)) start(async () => void (await runAction(revokeDeviceAction(d.id))));
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="mx-6 mb-6 rounded-2xl border border-dashed border-foreground/20 px-3 py-6 text-center text-sm text-muted-foreground">
            还没有电脑连接。下载车车 CRM 桌面版（Mac / Windows），登录后社媒账号就可以在这台电脑上运行。
          </p>
        )}
        <p className="border-t border-border/70 px-6 py-3 text-xs text-muted-foreground">
          下载桌面版：Mac
          <a className="ml-1 text-primary hover:underline" href="/api/desktop/download?arch=arm64">
            Apple 芯片（M1 及以后）
          </a>
          <span className="mx-1.5">·</span>
          <a className="text-primary hover:underline" href="/api/desktop/download?arch=x64">
            Intel 芯片
          </a>
          <span className="mx-1.5">·</span>
          <a className="text-primary hover:underline" href="/api/desktop/download?arch=win">
            Windows 10 / 11（64 位）
          </a>
          <span className="ml-2">装好后会自动更新</span>
        </p>
      </section>
    </div>
  );
}
