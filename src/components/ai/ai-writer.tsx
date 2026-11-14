"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/native-select";
import { AI_LANGUAGES, AI_TONES } from "@/lib/mail";
import { cn } from "@/lib/utils";
import { streamAiWrite } from "./stream-write";

export type AiWriteMode = "compose" | "reply" | "polish" | "translate";
type Mode = AiWriteMode;

/**
 * AI 写作工具条：读取当前草稿，生成结果后预览，确认后替换草稿。邮件和 WhatsApp 共用。
 */
export function AiWriter({
  channel,
  getDraft,
  onApply,
  original,
  compact,
  scroll,
  extra,
  request,
}: {
  channel: "email" | "whatsapp";
  getDraft: () => string;
  onApply: (text: string) => void;
  /** 回复时的来信原文；有它才显示「生成回复」 */
  original?: string;
  compact?: boolean;
  /** 手机上：所有按钮排成一行，左右滑 */
  scroll?: boolean;
  /** 跟在按钮后面的东西（如 WhatsApp 的「中→外」开关） */
  extra?: ReactNode;
  /** 外面直接发起一次（如长按某条消息「AI 帮我回复」）：id 变了就跑 */
  request?: { id: number; mode: Mode; original?: string } | null;
}) {
  const [language, setLanguage] = useState("");
  const [tone, setTone] = useState("");
  const [busy, setBusy] = useState<Mode | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run(mode: Mode, source = original) {
    setBusy(mode);
    setResult(null);
    const draft = getDraft();
    const r = await streamAiWrite(
      {
        mode,
        // 回复时只把引用线以上的部分当要点
        draft: draft.split(/\n\n\n.{0,80}(写道：|wrote:)|\n\n\n---------- 转发的邮件/)[0],
        original: source,
        language: language || (mode === "translate" ? "English" : undefined),
        tone: tone || undefined,
        channel,
      },
      setResult,
    );
    setBusy(null);
    if (r.ok) setResult(r.text);
    else {
      setResult(null);
      toast.error(r.message);
    }
  }

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const reqId = request?.id;
  useEffect(() => {
    if (!request) return;
    const t = setTimeout(() => void runRef.current(request.mode, request.original ?? original), 0);
    return () => clearTimeout(t);
    // 只看 id：同一个请求不重复跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqId]);

  const btn = (mode: Mode, label: string) => (
    <Button type="button" size="xs" variant="outline" disabled={!!busy} onClick={() => run(mode)}>
      {busy === mode ? "生成中…" : label}
    </Button>
  );

  return (
    <div className={cn("space-y-2 rounded-2xl bg-brand-soft/40 p-2.5", compact && "p-1.5")}>
      <div
        className={cn(
          "flex items-center gap-1.5",
          scroll ? "-mx-1.5 overflow-x-auto px-1.5 [scrollbar-width:none] [&>*]:shrink-0" : "flex-wrap",
        )}
      >
        <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink">
          <Sparkles className="size-3.5" /> AI
        </span>
        {original && btn("reply", "生成回复")}
        {btn("compose", "要点扩写")}
        {btn("polish", "润色")}
        {btn("translate", "翻译")}
        <NativeSelect aria-label="目标语言" className="h-6 w-auto px-1.5 text-xs" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">{original ? "语言：同来信" : "语言：英文"}</option>
          {AI_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="语气" className="h-6 w-auto px-1.5 text-xs" value={tone} onChange={(e) => setTone(e.target.value)}>
          <option value="">语气：默认</option>
          {AI_TONES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
        {extra}
      </div>
      {result && (
        <div className="rounded-md border bg-background p-2">
          <p className="max-h-64 overflow-y-auto text-sm whitespace-pre-wrap">
            {result}
            {busy && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-brand align-middle" aria-hidden />}
          </p>
          <div className={cn("mt-2 flex gap-1.5", busy && "pointer-events-none opacity-50")}>
            <Button
              type="button"
              size="xs"
              onClick={() => {
                onApply(result);
                setResult(null);
              }}
            >
              使用这段
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(result);
                toast.success("已复制");
              }}
            >
              复制
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setResult(null)}>
              放弃
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
