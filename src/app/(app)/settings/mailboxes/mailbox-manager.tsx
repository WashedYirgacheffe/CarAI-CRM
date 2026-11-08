"use client";

import { useState } from "react";
import { Mail, MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { formatDateTime } from "@/lib/crm";
import { deleteMailAccountAction, saveMailAccountAction, syncNowAction, toggleMailAccountAction } from "@/app/(app)/mail/actions";

type Preset = { key: string; label: string; domains: string[]; imap: [string, number]; smtp: [string, number, boolean]; hint?: string };

type Account = {
  id: string;
  email: string;
  displayName: string | null;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  signature: string | null;
  autoLead: boolean;
  status: "ACTIVE" | "ERROR" | "PAUSED";
  lastError: string | null;
  lastSyncAt: string | null;
  count: number;
};

const STATUS = {
  ACTIVE: { label: "同步中", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  ERROR: { label: "连接失败", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  PAUSED: { label: "已暂停", cls: "text-muted-foreground" },
};

export function MailboxManager({ accounts, presets, tz }: { accounts: Account[]; presets: Preset[]; tz: string }) {
  const [editing, setEditing] = useState<Partial<Account> | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);
  const [syncing, setSyncing] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button onClick={() => setEditing({})}>
          <Plus /> 绑定邮箱
        </Button>
        {accounts.length > 0 && (
          <Button
            variant="outline"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              await runAction(syncNowAction());
              setSyncing(false);
            }}
          >
            <RefreshCw className={syncing ? "animate-spin" : undefined} /> {syncing ? "同步中…" : "立即同步"}
          </Button>
        )}
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            还没有绑定邮箱。支持 QQ / 163 / 腾讯企业邮 / 阿里企业邮 / Gmail 等所有开通了 IMAP 和 SMTP 的邮箱。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardContent className="space-y-2">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Mail className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{a.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.imapHost} · {a.count} 封 · {a.lastSyncAt ? `上次同步 ${formatDateTime(a.lastSyncAt, tz)}` : "尚未同步"}
                    </p>
                  </div>
                  <Badge variant="outline" className={STATUS[a.status].cls}>
                    {STATUS[a.status].label}
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="更多操作">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(a)}>编辑设置</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => runAction(toggleMailAccountAction(a.id))}>
                        {a.status === "PAUSED" ? "恢复同步" : "暂停同步"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(a)}>
                        解除绑定
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {a.status === "ERROR" && a.lastError && <p className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">{a.lastError}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          {editing && <AccountForm key={editing.id ?? "new"} account={editing} presets={presets} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`解除绑定 ${removing?.email ?? ""}？`}
        description="本系统里同步的邮件会一起删除（邮箱服务器上的邮件不受影响），已归档到客户动态的记录会保留。"
        confirmText="解除绑定"
        action={() => deleteMailAccountAction(removing!.id)}
      />
    </div>
  );
}

function AccountForm({ account, presets, onDone }: { account: Partial<Account>; presets: Preset[]; onDone: () => void }) {
  const [state, submit, pending] = useActionForm(saveMailAccountAction, onDone);
  const [v, setV] = useState({
    email: account.email ?? "",
    imapHost: account.imapHost ?? "",
    imapPort: String(account.imapPort ?? 993),
    imapSecure: account.imapSecure ?? true,
    smtpHost: account.smtpHost ?? "",
    smtpPort: String(account.smtpPort ?? 465),
    smtpSecure: account.smtpSecure ?? true,
  });
  const [preset, setPreset] = useState("");
  const hint = presets.find((p) => p.key === preset)?.hint;

  function applyPreset(key: string) {
    setPreset(key);
    const p = presets.find((x) => x.key === key);
    if (!p) return;
    setV((s) => ({
      ...s,
      imapHost: p.imap[0],
      imapPort: String(p.imap[1]),
      imapSecure: p.imap[1] === 993,
      smtpHost: p.smtp[0],
      smtpPort: String(p.smtp[1]),
      smtpSecure: p.smtp[2],
    }));
  }

  function onEmail(email: string) {
    setV((s) => ({ ...s, email }));
    if (account.id || v.imapHost) return;
    const domain = email.split("@")[1]?.toLowerCase();
    const p = presets.find((x) => domain && x.domains.includes(domain));
    if (p) applyPreset(p.key);
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{account.id ? "编辑邮箱" : "绑定邮箱"}</DialogTitle>
        <DialogDescription>保存时会实际连接一次收信和发信服务器，确认账号可用。密码加密存储。</DialogDescription>
      </DialogHeader>
      {account.id && <input type="hidden" name="id" value={account.id} />}
      <FieldGroup className="max-h-[65vh] gap-4 overflow-y-auto py-4 pr-1">
        <FormMessage state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="mb-email">邮箱地址</FieldLabel>
            <Input id="mb-email" name="email" type="email" value={v.email} onChange={(e) => onEmail(e.target.value)} required autoFocus />
            <FieldErrors state={state} name="email" />
          </Field>
          <Field>
            <FieldLabel htmlFor="mb-preset">邮箱类型</FieldLabel>
            <NativeSelect id="mb-preset" value={preset} onChange={(e) => applyPreset(e.target.value)}>
              <option value="">自定义服务器</option>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="mb-pass">密码 / 授权码</FieldLabel>
            <Input id="mb-pass" name="password" type="password" autoComplete="new-password" placeholder={account.id ? "不修改请留空" : ""} />
            <FieldErrors state={state} name="password" />
          </Field>
          <Field>
            <FieldLabel htmlFor="mb-user">登录名</FieldLabel>
            <Input id="mb-user" name="username" defaultValue={account.username !== account.email ? account.username : ""} placeholder="默认同邮箱地址" />
          </Field>
        </div>
        {hint && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{hint}</p>}
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="mb-imap">收信服务器（IMAP）</FieldLabel>
            <Input id="mb-imap" name="imapHost" value={v.imapHost} onChange={(e) => setV({ ...v, imapHost: e.target.value })} required />
            <FieldErrors state={state} name="imapHost" />
          </Field>
          <Field>
            <FieldLabel htmlFor="mb-imap-port">端口</FieldLabel>
            <Input id="mb-imap-port" name="imapPort" inputMode="numeric" value={v.imapPort} onChange={(e) => setV({ ...v, imapPort: e.target.value })} />
          </Field>
          <label className="flex h-9 items-center gap-1.5 text-sm">
            <Checkbox name="imapSecure" checked={v.imapSecure} onCheckedChange={(c) => setV({ ...v, imapSecure: c === true })} /> SSL
          </label>
          <Field>
            <FieldLabel htmlFor="mb-smtp">发信服务器（SMTP）</FieldLabel>
            <Input id="mb-smtp" name="smtpHost" value={v.smtpHost} onChange={(e) => setV({ ...v, smtpHost: e.target.value })} required />
            <FieldErrors state={state} name="smtpHost" />
          </Field>
          <Field>
            <FieldLabel htmlFor="mb-smtp-port">端口</FieldLabel>
            <Input id="mb-smtp-port" name="smtpPort" inputMode="numeric" value={v.smtpPort} onChange={(e) => setV({ ...v, smtpPort: e.target.value })} />
          </Field>
          <label className="flex h-9 items-center gap-1.5 text-sm">
            <Checkbox name="smtpSecure" checked={v.smtpSecure} onCheckedChange={(c) => setV({ ...v, smtpSecure: c === true })} /> SSL
          </label>
        </div>
        <Field>
          <FieldLabel htmlFor="mb-name">发件人名称</FieldLabel>
          <Input id="mb-name" name="displayName" defaultValue={account.displayName ?? ""} placeholder="如 Tom Zhang，默认用你的姓名" />
        </Field>
        <Field>
          <FieldLabel htmlFor="mb-sign">签名</FieldLabel>
          <Textarea id="mb-sign" name="signature" rows={3} defaultValue={account.signature ?? ""} placeholder={"Best regards,\nTom Zhang\nSales Manager | ABC Co., Ltd."} />
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="mb-lead" name="autoLead" defaultChecked={account.autoLead ?? true} />
          <div>
            <FieldLabel htmlFor="mb-lead">陌生来信自动建线索</FieldLabel>
            <FieldDescription>匹配不到客户、也不是群发通知的来信，自动建成你名下的线索。</FieldDescription>
          </div>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "正在连接测试…" : "保存"}
        </Button>
      </DialogFooter>
    </form>
  );
}
