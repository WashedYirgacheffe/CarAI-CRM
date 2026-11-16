"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Loader2, Upload, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/native-select";
import { ACCOUNT_STATUS, MATRIX_PLATFORMS, matrixPlatform, PROXY_PROTOCOLS } from "@/lib/matrix";
import { toTsv } from "@/lib/table-text";
import { readXlsx } from "@/lib/xlsx-lite";
import { importAccountsAction, importCookiesAction, importProxiesAction, type ImportResult } from "./actions";

// ── 筛选 ──

/** 账号列表筛选：平台、分组、状态、负责人、搜索，条件放在网址里 */
export function AccountFilters({ groups, members, total, shown }: { groups: string[]; members: { id: string; name: string }[]; total: number; shown: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
  };
  const any = ["platform", "group", "status", "owner", "q"].some((k) => params.get(k));
  // 换了网址上的条件后重新挂载，下拉框显示新值
  const key = params.toString();
  return (
    <div key={key} className="mb-3 flex flex-wrap items-center gap-2">
      <NativeSelect className="h-8 w-36" defaultValue={params.get("platform") ?? ""} onChange={(e) => set("platform", e.target.value)} aria-label="平台">
        <option value="">全部平台</option>
        {MATRIX_PLATFORMS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </NativeSelect>
      {groups.length > 0 && (
        <NativeSelect className="h-8 w-32" defaultValue={params.get("group") ?? ""} onChange={(e) => set("group", e.target.value)} aria-label="分组">
          <option value="">全部分组</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
          <option value="-">未分组</option>
        </NativeSelect>
      )}
      <NativeSelect className="h-8 w-32" defaultValue={params.get("status") ?? ""} onChange={(e) => set("status", e.target.value)} aria-label="状态">
        <option value="">全部状态</option>
        {Object.entries(ACCOUNT_STATUS).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </NativeSelect>
      {members.length > 0 && (
        <NativeSelect className="h-8 w-32" defaultValue={params.get("owner") ?? ""} onChange={(e) => set("owner", e.target.value)} aria-label="负责人">
          <option value="">全部负责人</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value="-">未分配</option>
        </NativeSelect>
      )}
      <form
        className="w-44"
        onSubmit={(e) => {
          e.preventDefault();
          set("q", String(new FormData(e.currentTarget).get("q") ?? "").trim());
        }}
      >
        <Input name="q" defaultValue={params.get("q") ?? ""} placeholder="搜名称 / 登录账号 / 标签" className="h-8" autoComplete="off" />
      </form>
      {any && (
        <>
          <span className="text-xs text-muted-foreground tabular-nums">
            {shown} / {total}
          </span>
          <Button size="sm" variant="ghost" onClick={() => router.replace(params.get("tab") ? `${pathname}?tab=${params.get("tab")}` : pathname, { scroll: false })}>
            <X /> 清除筛选
          </Button>
        </>
      )}
    </div>
  );
}

// ── 导入结果 ──

function ResultBox({ result }: { result: ImportResult | null }) {
  if (!result) return null;
  return (
    <div className="space-y-1 rounded-md border p-3 text-sm">
      <p className={result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>{result.message}</p>
      {!!result.errors?.length && (
        <ul className="max-h-40 overflow-y-auto text-xs text-muted-foreground">
          {result.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 读文件：xlsx 转成制表符文本，其它当文本读 */
async function readTableFile(file: File) {
  if (/\.xlsx$/i.test(file.name)) return toTsv(await readXlsx(file));
  if (/\.xls$/i.test(file.name)) throw new Error("老版 .xls 读不了，请在 Excel 里另存为 .xlsx 或 .csv");
  return file.text();
}

function FilePick({ accept, onText, label }: { accept: string; onText: (t: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            onText(await readTableFile(f));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "读不了这个文件");
          }
        }}
      />
      <Button type="button" size="sm" variant="outline" onClick={() => ref.current?.click()}>
        <Upload /> {label}
      </Button>
    </>
  );
}

// ── 批量导入账号 ──

const ACCOUNT_TEMPLATE = [
  ["平台", "名称", "登录账号", "密码", "代理", "负责人", "分组", "标签", "备注", "Cookie"],
  ["tiktok", "美国店铺号-01", "shop01@example.com", "", "user:pass@1.2.3.4:8000", "", "美国", "主号,带货", "", ""],
  ["instagram", "假发展示号", "", "", "", "", "美国", "", "代理留空 = 自动分一个空闲代理", ""],
];

export function ImportAccountsButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const rows = text.trim() ? text.trim().split(/\r?\n/).length - 1 : 0;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FileSpreadsheet /> 批量导入
      </Button>
      <Dialog open={open} onOpenChange={(v) => (setOpen(v), v || (setResult(null), setText("")))}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-2xl *:min-w-0">
          <DialogHeader>
            <DialogTitle>批量导入账号</DialogTitle>
            <DialogDescription>
              上传 Excel / CSV，或者从 Excel 里复制整块单元格粘贴进来。第一行是表头，至少要有「平台」「名称」。「代理」可以填代理串、已有代理的名称或出口 IP，留空就自动分一个这个平台还没用过的代理；「Cookie」填了会直接用 Cookie 登录。一次最多 500 行。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <FilePick accept=".xlsx,.csv,.tsv,.txt" label="选择文件" onText={setText} />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                const csv = "﻿" + ACCOUNT_TEMPLATE.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                a.download = "社媒账号导入模板.csv";
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              <Download /> 下载模板
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">平台填：{MATRIX_PLATFORMS.map((p) => p.key).join(" / ")}</span>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"平台\t名称\t登录账号\t代理\ntiktok\t美国号-01\tshop01@example.com\tuser:pass@1.2.3.4:8000"}
            className="max-h-[40vh] min-h-40 font-mono text-xs [field-sizing:fixed]"
            spellCheck={false}
          />
          <ResultBox result={result} />
          <div className="flex items-center justify-end gap-2">
            {rows > 0 && <span className="text-xs text-muted-foreground">{rows} 行</span>}
            <Button
              disabled={busy || rows < 1}
              onClick={async () => {
                setBusy(true);
                const r = await importAccountsAction(text);
                setBusy(false);
                setResult(r);
                if (r.ok) toast.success(r.message);
              }}
            >
              {busy && <Loader2 />} 导入
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── 批量导入代理 ──

export function ImportProxiesButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [protocol, setProtocol] = useState("http");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FileSpreadsheet /> 批量导入
      </Button>
      <Dialog open={open} onOpenChange={(v) => (setOpen(v), v || (setResult(null), setText("")))}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-xl *:min-w-0">
          <DialogHeader>
            <DialogTitle>批量导入代理 IP</DialogTitle>
            <DialogDescription>
              一行一个，支持 host:port、host:port:账号:密码、账号:密码@host:port、socks5://账号:密码@host:port。已经有的会跳过，导入后在后台逐个检测出口 IP。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">没写协议的按</span>
            <NativeSelect className="h-8 w-28" value={protocol} onChange={(e) => setProtocol(e.target.value)} aria-label="默认协议">
              {PROXY_PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </NativeSelect>
            <FilePick accept=".txt,.csv,.tsv" label="选择文件" onText={setText} />
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"1.2.3.4:8000:user:pass\nuser:pass@5.6.7.8:8000\nsocks5://user:pass@9.9.9.9:1080"}
            className="max-h-[40vh] min-h-40 font-mono text-xs [field-sizing:fixed]"
            spellCheck={false}
          />
          <ResultBox result={result} />
          <div className="flex items-center justify-end gap-2">
            {lines > 0 && <span className="text-xs text-muted-foreground">{lines} 行</span>}
            <Button
              disabled={busy || !lines}
              onClick={async () => {
                setBusy(true);
                const r = await importProxiesAction(text, protocol);
                setBusy(false);
                setResult(r);
                if (r.ok) toast.success(r.message);
              }}
            >
              {busy && <Loader2 />} 导入
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── 导入 Cookie ──

export function CookieDialog({ account, open, onOpenChange }: { account: { id: string; name: string; platform: string }; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label = matrixPlatform(account.platform)?.label ?? account.platform;
  return (
    <Dialog open={open} onOpenChange={(v) => (onOpenChange(v), v || (setText(""), setErr(null)))}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-xl *:min-w-0">
        <DialogHeader>
          <DialogTitle>导入 Cookie · {account.name}</DialogTitle>
          <DialogDescription>
            在已经登录 {label} 的浏览器里，用 Cookie-Editor 之类的插件导出（JSON），粘贴到这里；也支持 cookies.txt 和 name=value; 格式。导入后会在这个账号的环境里自动检查登录。
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <FilePick accept=".json,.txt" label="选择文件" onText={setText} />
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='[{"name":"sessionid","value":"…","domain":".tiktok.com", …}]'
          className="max-h-[40vh] min-h-40 font-mono text-xs [field-sizing:fixed]"
          spellCheck={false}
        />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-end">
          <Button
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true);
              const r = await importCookiesAction(account.id, text);
              setBusy(false);
              if (r.ok) {
                toast.success(r.message);
                onOpenChange(false);
                setText("");
              } else setErr(r.message ?? "导入失败");
            }}
          >
            {busy && <Loader2 />} 导入并检查
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
