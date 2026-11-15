"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Loader2, Lock, Settings2, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { MATRIX_PLATFORMS, PROXY_PROTOCOLS } from "@/lib/matrix";
import {
  cancelJobAction,
  checkProxyAction,
  deleteAccountAction,
  deleteProxyAction,
  rotateRunnerTokenAction,
  runAccountAction,
  saveAccountAction,
  saveProxyAction,
} from "./actions";

type Option = { id: string; label: string };
type Member = { id: string; name: string };

/** 有任务在跑时每 3 秒刷新一次，看运行器的进度 */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), active ? 3000 : 20_000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

// ── 运行器 ──

/** 生成运行器令牌，给出在 Mac 上启动运行器的命令 */
export function RunnerSetupButton({ crmUrl, hasToken }: { crmUrl: string; hasToken: boolean }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cmd = token ? `CRM_URL=${crmUrl} MATRIX_RUNNER_TOKEN=${token} pnpm matrix-runner` : "";
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Settings2 /> 运行器
      </Button>
      <Dialog open={open} onOpenChange={(v) => (setOpen(v), v || setToken(null))}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg *:min-w-0">
          <DialogHeader>
            <DialogTitle>环境运行器</DialogTitle>
            <DialogDescription>
              运行器装在要弹浏览器窗口的电脑上（试点用你的 Mac），它拿着企业令牌来 CRM 领任务。需要 Node 22 以上，在项目目录里执行下面的命令。
            </DialogDescription>
          </DialogHeader>
          {token ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">令牌只显示这一次，关掉后看不到了。也可以把两个变量写进项目根目录的 .env.runner。</p>
              <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{cmd}</pre>
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(cmd)}>
                  <Copy /> 复制命令
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {hasToken ? "已经生成过令牌。重新生成后，旧令牌马上失效，正在跑的运行器要换新令牌重启。" : "还没有令牌，先生成一个。"}
              </p>
              {err && <p className="text-destructive">{err}</p>}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    if (hasToken && !confirm("重新生成令牌？旧令牌会失效。")) return;
                    setBusy(true);
                    const r = await rotateRunnerTokenAction();
                    setBusy(false);
                    if (r.token) setToken(r.token);
                    else setErr(r.message ?? "生成失败");
                  }}
                >
                  {busy && <Loader2 />} {hasToken ? "重新生成令牌" : "生成令牌"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── 代理 ──

type ProxyData = { id: string; name: string; protocol: string; host: string; port: number; username: string | null; note: string | null; hasPassword: boolean };

export function ProxyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> 添加代理
      </Button>
      <ProxyDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function ProxyDialog({ open, onOpenChange, proxy }: { open: boolean; onOpenChange: (v: boolean) => void; proxy?: ProxyData }) {
  const [state, submit, pending] = useActionForm(saveProxyAction, () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md *:min-w-0">
        <DialogHeader>
          <DialogTitle>{proxy ? "修改代理" : "添加代理 IP"}</DialogTitle>
          <DialogDescription>建议用住宅或 ISP 静态 IP，一个账号一个。地址栏也可以直接粘贴整串，例如 user:pass@1.2.3.4:8000</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" key={proxy?.id ?? "new"}>
          {proxy && <input type="hidden" name="id" value={proxy.id} />}
          <FieldGroup className="gap-3">
            <div className="grid grid-cols-[7rem_minmax(0,1fr)_6rem] gap-2">
              <Field>
                <FieldLabel>协议</FieldLabel>
                <NativeSelect name="protocol" defaultValue={proxy?.protocol ?? "http"}>
                  {PROXY_PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {p.toUpperCase()}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="px-host">地址</FieldLabel>
                <Input id="px-host" name="host" defaultValue={proxy?.host} placeholder="1.2.3.4 或整串" autoComplete="off" required />
                <FieldErrors state={state} name="host" />
              </Field>
              <Field>
                <FieldLabel htmlFor="px-port">端口</FieldLabel>
                <Input id="px-port" name="port" defaultValue={proxy?.port} inputMode="numeric" placeholder="8000" autoComplete="off" />
                <FieldErrors state={state} name="port" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field>
                <FieldLabel htmlFor="px-user">账号</FieldLabel>
                <Input id="px-user" name="username" defaultValue={proxy?.username ?? ""} autoComplete="off" />
              </Field>
              <Field>
                <FieldLabel htmlFor="px-pass">密码</FieldLabel>
                <Input
                  id="px-pass"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={proxy?.hasPassword ? "不改就留空" : ""}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field>
                <FieldLabel htmlFor="px-name">名称（可不填）</FieldLabel>
                <Input id="px-name" name="name" defaultValue={proxy?.name ?? ""} placeholder="美国-ISP-01" autoComplete="off" />
              </Field>
              <Field>
                <FieldLabel htmlFor="px-note">备注</FieldLabel>
                <Input id="px-note" name="note" defaultValue={proxy?.note ?? ""} placeholder="供应商、到期时间" autoComplete="off" />
              </Field>
            </div>
          </FieldGroup>
          <FormMessage state={state} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 />} {pending ? "保存并检测中…" : "保存并检测"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProxyRowActions({ proxy }: { proxy: ProxyData }) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-1 md:justify-end">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await runAction(checkProxyAction(proxy.id));
          setBusy(false);
        }}
      >
        {busy ? <Loader2 /> : <RefreshCw />} 检测
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="修改" onClick={() => setEdit(true)}>
        <Pencil />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="删除"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => confirm(`删除代理「${proxy.name}」？`) && runAction(deleteProxyAction(proxy.id))}
      >
        <Trash2 />
      </Button>
      <ProxyDialog open={edit} onOpenChange={setEdit} proxy={proxy} />
    </div>
  );
}

// ── 账号 ──

type AccountData = {
  id: string;
  platform: string;
  name: string;
  login: string | null;
  ownerId: string | null;
  proxyId: string | null;
  os: string;
  note: string | null;
  hasPassword: boolean;
  /** 已经生成过指纹，系统类型不能再改 */
  locked: boolean;
  status: string;
};

export function AccountButton({ proxies, members, defaultOwnerId }: { proxies: Option[]; members: Member[]; defaultOwnerId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> 添加账号
      </Button>
      <AccountDialog open={open} onOpenChange={setOpen} proxies={proxies} members={members} defaultOwnerId={defaultOwnerId} />
    </>
  );
}

function AccountDialog({
  open,
  onOpenChange,
  account,
  proxies,
  members,
  defaultOwnerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  account?: AccountData;
  proxies: Option[];
  members: Member[];
  defaultOwnerId?: string;
}) {
  const [state, submit, pending] = useActionForm(saveAccountAction, () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md *:min-w-0">
        <DialogHeader>
          <DialogTitle>{account ? "修改账号" : "添加社媒账号"}</DialogTitle>
          <DialogDescription>保存后点「登录」，运行器会弹出这个账号专用的浏览器窗口，扫码或输入密码登录。</DialogDescription>
        </DialogHeader>
        {proxies.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有代理 IP，先到「代理 IP」里添加一个。</p>
        ) : (
          <form onSubmit={submit} className="space-y-4" key={account?.id ?? "new"}>
            {account && <input type="hidden" name="id" value={account.id} />}
            <FieldGroup className="gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Field>
                  <FieldLabel>平台</FieldLabel>
                  <NativeSelect name="platform" defaultValue={account?.platform ?? "linkedin"}>
                    {MATRIX_PLATFORMS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ma-name">名称</FieldLabel>
                  <Input id="ma-name" name="name" defaultValue={account?.name} placeholder="Tom 的领英" autoComplete="off" required />
                  <FieldErrors state={state} name="name" />
                </Field>
              </div>
              <Field>
                <FieldLabel>代理 IP</FieldLabel>
                <NativeSelect name="proxyId" defaultValue={account?.proxyId ?? ""} required>
                  <option value="" disabled>
                    选一个代理
                  </option>
                  {proxies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </NativeSelect>
                <FieldErrors state={state} name="proxyId" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field>
                  <FieldLabel htmlFor="ma-login">登录账号（可不填）</FieldLabel>
                  <Input id="ma-login" name="login" defaultValue={account?.login ?? ""} placeholder="邮箱 / 手机号" autoComplete="off" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ma-pass">密码（可不填）</FieldLabel>
                  <Input
                    id="ma-pass"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={account?.hasPassword ? "不改就留空" : "加密保存"}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field>
                  <FieldLabel>负责人</FieldLabel>
                  <NativeSelect name="ownerId" defaultValue={account?.ownerId ?? defaultOwnerId ?? ""}>
                    <option value="">不分配</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel>模拟系统</FieldLabel>
                  <NativeSelect name="os" defaultValue={account?.os ?? "windows"} disabled={account?.locked}>
                    <option value="windows">Windows</option>
                    <option value="macos">macOS</option>
                  </NativeSelect>
                  {account?.locked && <input type="hidden" name="os" value={account.os} />}
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="ma-note">备注</FieldLabel>
                <Input id="ma-note" name="note" defaultValue={account?.note ?? ""} autoComplete="off" />
              </Field>
            </FieldGroup>
            <FormMessage state={state} />
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 />} 保存
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AccountRowActions({
  account,
  activeJobId,
  manage,
  proxies,
  members,
}: {
  account: AccountData;
  activeJobId: string | null;
  manage: boolean;
  proxies: Option[];
  members: Member[];
}) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, p: Promise<{ ok?: boolean; message?: string }>) => {
    setBusy(key);
    await runAction(p as never);
    setBusy(null);
  };
  const loggedIn = account.status === "active";
  return (
    <div className="flex items-center gap-1 md:justify-end">
      {activeJobId ? (
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("cancel", cancelJobAction(activeJobId))}>
          {busy === "cancel" ? <Loader2 /> : <X />} 取消
        </Button>
      ) : loggedIn ? (
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("open", runAccountAction(account.id, "open"))}>
          {busy === "open" ? <Loader2 /> : <ExternalLink />} 打开环境
        </Button>
      ) : (
        <Button size="sm" disabled={!!busy} onClick={() => run("login", runAccountAction(account.id, "login"))}>
          {busy === "login" ? <Loader2 /> : <Lock />} 登录
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="更多">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!!activeJobId} onSelect={() => run("check", runAccountAction(account.id, "check"))}>
            <RefreshCw /> 检查登录状态
          </DropdownMenuItem>
          {loggedIn && (
            <DropdownMenuItem disabled={!!activeJobId} onSelect={() => run("login", runAccountAction(account.id, "login"))}>
              <Lock /> 重新登录
            </DropdownMenuItem>
          )}
          {manage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setEdit(true)}>
                <Pencil /> 修改
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => confirm(`删除账号「${account.name}」？`) && run("del", deleteAccountAction(account.id))}
              >
                <Trash2 /> 删除
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {manage && <AccountDialog open={edit} onOpenChange={setEdit} account={account} proxies={proxies} members={members} />}
    </div>
  );
}
