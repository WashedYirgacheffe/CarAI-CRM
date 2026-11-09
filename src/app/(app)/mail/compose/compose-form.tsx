"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { AiWriter } from "@/components/ai/ai-writer";
import { useActionForm } from "@/hooks/use-action-form";
import { sendMailAction } from "../actions";

type Initial = {
  accountId: string;
  to: string;
  cc: string;
  subject: string;
  text: string;
  replyToId?: string;
  forwardId?: string;
  forwardFiles: string[];
  original?: string;
};

export function ComposeForm({ accounts, initial, canAi }: { accounts: { id: string; email: string }[]; initial: Initial; canAi: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initial.text);
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, submit, pending] = useActionForm(
    async (prev, fd) => {
      fd.delete("files");
      for (const f of files) fd.append("files", f);
      return sendMailAction(prev, fd);
    },
    () => router.push("/mail?box=sent"),
  );

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3 surface p-4">
        {initial.replyToId && <input type="hidden" name="replyToId" value={initial.replyToId} />}
        {initial.forwardId && <input type="hidden" name="forwardId" value={initial.forwardId} />}
        <FormMessage state={state} />
        <Row label="发件人">
          <NativeSelect name="accountId" defaultValue={initial.accountId}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </NativeSelect>
        </Row>
        <Row label="收件人">
          <div className="flex gap-2">
            <Input name="to" defaultValue={initial.to} placeholder="多个地址用逗号分隔" required autoFocus={!initial.to} />
            {!showCc && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowCc(true)}>
                抄送 / 密送
              </Button>
            )}
          </div>
          <FieldErrors state={state} name="to" />
        </Row>
        {showCc && (
          <>
            <Row label="抄送">
              <Input name="cc" defaultValue={initial.cc} />
              <FieldErrors state={state} name="cc" />
            </Row>
            <Row label="密送">
              <Input name="bcc" />
              <FieldErrors state={state} name="bcc" />
            </Row>
          </>
        )}
        <Row label="主题">
          <Input name="subject" defaultValue={initial.subject} autoFocus={!!initial.to && !initial.subject} />
        </Row>
        <Textarea
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={18}
          className="min-h-[22rem] font-sans"
          placeholder="正文。签名会自动加在末尾。"
          autoFocus={!!initial.replyToId}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              setFiles((f) => [...f, ...Array.from(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Paperclip /> 添加附件
          </Button>
          {initial.forwardFiles.map((f) => (
            <span key={f} className="rounded-md bg-muted px-2 py-0.5 text-xs">
              {f}（原邮件附件）
            </span>
          ))}
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
              {f.name}
              <button type="button" aria-label={`移除 ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Button type="submit" className="ml-auto" disabled={pending}>
            <Send /> {pending ? "发送中…" : "发送"}
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {canAi ? (
          <AiWriter channel="email" original={initial.original} getDraft={() => text} onApply={(t) => setText((cur) => {
            const tail = cur.match(/\n\n\n(.{0,80}(写道：|wrote:)|---------- 转发的邮件)[\s\S]*$/)?.[0] ?? "";
            return t + tail;
          })} />
        ) : (
          <p className="rounded-lg border bg-card p-3 text-xs text-muted-foreground">AI 写作助手未开通（需要管理员配置 AI 并授予「使用 AI」权限）。</p>
        )}
        <div className="rounded-lg border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">小提示</p>
          <p>· 先用中文写几句要点，点「要点扩写」生成英文邮件。</p>
          <p>· 回复时点「生成回复」，AI 会根据来信起草，需要你确认的信息用 [方括号] 标出。</p>
          <p>· 发给客户联系人的邮件会自动记入客户跟进动态。</p>
        </div>
      </div>
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid items-start gap-1 sm:grid-cols-[4rem_1fr] sm:gap-3">
      <span className="pt-2 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}
