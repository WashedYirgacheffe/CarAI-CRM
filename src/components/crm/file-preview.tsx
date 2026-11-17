"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  Archive,
  Download,
  Eye,
  FileText,
  Languages,
  Loader2,
  Mail,
  PanelRight,
  Sparkles,
  Table2,
  X,
} from "@/components/icons";
import {
  fileBadge,
  fileKind,
  fileSizeText,
  isOfficeFile,
  type FilePreviewData,
} from "@/lib/files";
import { cn } from "@/lib/utils";
import { saveAttachmentAction } from "@/app/(app)/files/actions";
import {
  askAboutFile,
  attachFileSlot,
  useFileSlot,
  type Viewing,
} from "@/components/ai/ai-file-slot";

/*
 * 文件在线预览：全屏覆盖层。
 * - PDF 用浏览器自带阅读器（不能内嵌时由服务器一页页渲染成图片）
 * - Excel / Word / PPT 由服务器用 LibreOffice 转成 PDF，「原样」看到的跟 Office 打开一致；也能切到「数据」看表格 / 文字
 * - 图片 / 视频 / 音频直接放，文本原样显示
 * - 右侧可以打开 AI 栏：AiDock 的对话 portal 进来，AI 直接拿到这个文件的内容，能问、能一键总结、翻译
 * 三个接口（客户文件、WhatsApp、邮件附件）都支持 ?preview=raw / pdf / pages / page / thumb / json。
 */

export type PreviewFile = {
  /** 接口地址，不带参数，例如 /api/crm-files/xxx */
  src: string;
  /** 下载地址 */
  download: string;
  name: string;
  mime?: string | null;
  size?: number | null;
  /** 客户资料里的文件：能让 AI 读、能用邮件发 */
  fileId?: string;
  customerId?: string | null;
  /** 可以「存到客户资料」时传：WhatsApp 消息或邮件附件 */
  save?: {
    waMessageId?: string;
    mailId?: string;
    attId?: string;
    customerId?: string | null;
  };
};

const withQuery = (src: string, q: string) =>
  `${src}${src.includes("?") ? "&" : "?"}${q}`;

/* ── 全站只有一个预览窗：放在 app-shell 里，哪里都能 openFilePreview() ── */

type Open = { file: PreviewFile; onClose?: () => void } | null;
let current: Open = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const setCurrent = (v: Open) => {
  current = v;
  listeners.forEach((l) => l());
};
export const openFilePreview = (file: PreviewFile, onClose?: () => void) =>
  setCurrent({ file, onClose });
const closeFilePreview = () => {
  const c = current;
  setCurrent(null);
  c?.onClose?.();
};

export function FilePreviewHost() {
  const open = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  if (!open) return null;
  return createPortal(
    <PreviewOverlay
      key={open.file.src}
      file={open.file}
      onClose={closeFilePreview}
    />,
    document.body,
  );
}

/** 兼容原来的用法：file 有值就打开 */
export function FilePreviewDialog({
  file,
  onClose,
}: {
  file: PreviewFile | null;
  onClose: () => void;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!file) return;
    openFilePreview(file, () => closeRef.current());
    return () => {
      if (current?.file === file) setCurrent(null);
    };
  }, [file]);
  return null;
}

const viewingOf = (f: PreviewFile): Viewing | null =>
  f.fileId
    ? { name: f.name, fileId: f.fileId }
    : f.save?.waMessageId
      ? { name: f.name, waMessageId: f.save.waMessageId }
      : f.save?.mailId && f.save.attId
        ? { name: f.name, mailId: f.save.mailId, attId: f.save.attId }
        : null;

const QUICK = [
  {
    label: "总结分析",
    icon: Sparkles,
    prompt:
      "帮我总结分析这个文件：是什么单据 / 文件，关键信息（双方、金额、数量、品名规格、日期、条款）列出来，有没有要注意的风险或异常，下一步该做什么。",
  },
  {
    label: "翻译成中文",
    icon: Languages,
    prompt:
      "把这个文件的内容翻译成中文，保持原来的结构（表格还用表格），专业术语保留原文括注。",
  },
  {
    label: "提取关键数据",
    icon: Table2,
    prompt:
      "把这个文件里的关键数据提取成表格：品名、型号规格、数量、单价、金额、交期、付款方式、贸易条款等，没有的写「无」。",
  },
  {
    label: "核对单据",
    icon: Eye,
    prompt:
      "帮我核对这份单据：金额 / 数量 / 单价算得对不对，前后是否一致，和 CRM 里这个客户的报价、订单对不对得上，抬头、日期、条款有没有明显错误。",
  },
];

function PreviewOverlay({
  file,
  onClose,
}: {
  file: PreviewFile;
  onClose: () => void;
}) {
  const kind = fileKind(file.name, file.mime ?? "");
  const office = isOfficeFile(file.name, file.mime ?? "");
  const [view, setView] = useState<"original" | "data">("original");
  const [saving, startSave] = useTransition();
  const ai = useFileSlot();
  const viewing = viewingOf(file);
  const canAi = ai.ready && !!viewing;
  const [aiOpen, setAiOpen] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const badge = fileBadge(file.name, file.mime ?? "");

  // 打开时锁住页面滚动；Esc 关闭（输入框里按 Esc 先失焦）
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("textarea,input")) return (t as HTMLElement).blur();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // AI 栏：把插槽交给 AiDock
  useEffect(() => {
    if (!aiOpen || !canAi || !slotRef.current || !viewing) return;
    return attachFileSlot(slotRef.current, viewing, () => setAiOpen(false));
    // viewing 由 file 决定，file 变了整个组件会重建（key）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOpen, canAi]);

  const ask = (prompt: string) => {
    setAiOpen(true);
    // 等插槽挂上、AiDock portal 进来再发
    setTimeout(() => askAboutFile(prompt), 60);
  };

  const save = () =>
    startSave(async () => {
      const r = await saveAttachmentAction({
        ...file.save,
        customerId: file.save?.customerId ?? undefined,
      });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });

  const raw = withQuery(file.src, "preview=raw");
  const mailHref = file.fileId
    ? `/mail/compose?${new URLSearchParams({ files: file.fileId, ...(file.customerId ? { customer: file.customerId } : {}) })}`
    : null;
  const bar =
    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 [&_svg]:size-4";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${file.name}`}
      className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in-0"
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2 sm:px-4">
        <span
          className={cn(
            "grid h-7 min-w-9 shrink-0 place-items-center rounded-md px-1 text-[10px] font-bold tracking-wide text-white",
            badge.tone,
          )}
        >
          {badge.label}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold" title={file.name}>
            {file.name}
          </span>
          <span className="block text-xs text-muted-foreground">
            {fileSizeText(file.size)}
          </span>
        </span>
        {(office || kind === "sheet") && (
          <span className="inline-flex shrink-0 rounded-lg bg-muted p-0.5 max-sm:hidden">
            {(
              [
                ["original", "原样"],
                ["data", kind === "sheet" ? "表格数据" : "纯文字"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                disabled={v === "original" && !office}
                className={cn(
                  "h-7 rounded-md px-3 text-xs font-medium transition-colors disabled:hidden",
                  view === v || (!office && v === "data")
                    ? "bg-card text-foreground shadow-e1"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-0.5">
          <a href={file.download} className={bar} title="下载">
            <Download />
            <span className="max-md:hidden">下载</span>
          </a>
          {file.save && (
            <button type="button" className={bar} onClick={save} disabled={saving} title="存到客户资料">
              {saving ? <Loader2 className="animate-spin" /> : <Archive />}
              <span className="max-md:hidden">存到客户资料</span>
            </button>
          )}
          {mailHref && (
            <a href={mailHref} className={bar} title="用邮件发给客户（作为附件）">
              <Mail />
              <span className="max-md:hidden">邮件发送</span>
            </a>
          )}
          {canAi && (
            <>
              <button type="button" className={cn(bar, "text-brand-ink max-sm:hidden")} onClick={() => ask(QUICK[0].prompt)}>
                <Sparkles />
                <span className="max-lg:hidden">AI 总结</span>
              </button>
              <button
                type="button"
                className={cn(bar, aiOpen && "bg-brand-soft text-brand-ink")}
                onClick={() => setAiOpen((v) => !v)}
                aria-pressed={aiOpen}
                title="AI 解读：在右侧边看边问"
              >
                <PanelRight />
                <span className="max-md:hidden">AI 解读</span>
              </button>
            </>
          )}
          <button type="button" className={cn(bar, "ml-1 px-2")} onClick={onClose} aria-label="关闭预览" title="关闭（Esc）">
            <X />
          </button>
        </span>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden bg-muted/40">
          {kind === "pdf" ? (
            <PdfView src={file.src} name={file.name} mode="raw" />
          ) : office && view === "original" ? (
            <OfficeView src={file.src} name={file.name} onFail={() => setView("data")} />
          ) : kind === "image" ? (
            <div className="flex size-full items-center justify-center overflow-auto p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口 */}
              <img src={raw} alt={file.name} className="max-h-full max-w-full object-contain shadow-e2" />
            </div>
          ) : kind === "video" ? (
            <video src={raw} controls className="size-full bg-black" />
          ) : kind === "audio" ? (
            <div className="flex size-full items-center justify-center">
              <audio src={raw} controls />
            </div>
          ) : kind === "other" ? (
            <Empty text="这种文件不能在线预览，请下载后打开" />
          ) : (
            <JsonPreview src={withQuery(file.src, "preview=json")} />
          )}
        </div>
        {canAi && aiOpen && (
          <aside
            aria-label="AI 解读"
            className="flex w-full shrink-0 flex-col border-l bg-card max-lg:absolute max-lg:inset-0 max-lg:z-10 lg:w-[400px] xl:w-[440px]"
          >
            <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none]">
              {QUICK.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => askAboutFile(q.prompt)}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-brand/25 bg-card px-2.5 text-xs font-medium text-brand-ink transition-colors hover:bg-brand-soft [&_svg]:size-3.5"
                >
                  <q.icon />
                  {q.label}
                </button>
              ))}
            </div>
            <div ref={slotRef} className="flex min-h-0 flex-1 flex-col" />
          </aside>
        )}
      </div>
    </div>
  );
}

/** Excel / Word / PPT：服务器转成 PDF（第一次要几秒），跟 Office 打开看到的一样；转不了退回数据视图 */
function OfficeView({
  src,
  name,
  onFail,
}: {
  src: string;
  name: string;
  onFail: () => void;
}) {
  const [ready, setReady] = useState(false);
  const failRef = useRef(onFail);
  useEffect(() => {
    failRef.current = onFail;
  });
  useEffect(() => {
    let alive = true;
    // 先请求页数：触发转换并缓存，之后的 PDF / 页面图都直接读缓存
    fetch(withQuery(src, "preview=pages"))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(() => alive && setReady(true))
      .catch(() => {
        if (!alive) return;
        toast.message("这个文件暂时不能按原样显示，已切换到数据视图");
        failRef.current();
      });
    return () => {
      alive = false;
    };
  }, [src]);
  if (!ready)
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        正在按原样排版…
      </div>
    );
  return <PdfView src={src} name={name} mode="pdf" />;
}

/** 浏览器能内嵌 PDF 就用自带阅读器；桌面版（Electron）、安卓浏览器不能，就由服务器一页页渲染成图片 */
const subscribeNoop = () => () => {};
function PdfView({
  src,
  name,
  mode,
}: {
  src: string;
  name: string;
  mode: "raw" | "pdf";
}) {
  const native = useSyncExternalStore(
    subscribeNoop,
    () => navigator.pdfViewerEnabled !== false,
    () => true,
  );
  if (native)
    return (
      <iframe
        title={name}
        src={`${withQuery(src, `preview=${mode}`)}#view=FitH`}
        className="size-full border-0 bg-white"
      />
    );
  return <PdfPages src={src} name={name} />;
}

function PdfPages({ src, name }: { src: string; name: string }) {
  const [total, setTotal] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(withQuery(src, "preview=pages"))
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((d: { total: number }) => alive && setTotal(d.total))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [src]);
  if (failed) return <Empty text="文件打不开，请下载后查看" />;
  if (total == null)
    return (
      <div className="flex size-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  return (
    <div className="flex size-full flex-col items-center gap-4 overflow-auto p-4">
      {Array.from({ length: Math.min(total, 100) }, (_, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口
        <img
          key={i}
          src={withQuery(src, `preview=page&n=${i + 1}`)}
          alt={`${name} 第 ${i + 1} 页`}
          loading="lazy"
          className="w-full max-w-5xl bg-white shadow-e2"
          style={{ aspectRatio: "1 / 1.414" }}
          onLoad={(e) => (e.currentTarget.style.aspectRatio = "auto")}
        />
      ))}
      {total > 100 && (
        <p className="text-xs text-muted-foreground">
          只显示前 100 页，完整内容请下载
        </p>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <FileText className="size-8" />
      {text}
    </div>
  );
}

function JsonPreview({ src }: { src: string }) {
  const [data, setData] = useState<FilePreviewData | null>(null);
  const [sheet, setSheet] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(src)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((d: FilePreviewData) => alive && setData(d))
      .catch(
        () =>
          alive &&
          setData({ kind: "none", message: "文件加载失败，请下载后查看" }),
      );
    return () => {
      alive = false;
    };
  }, [src]);

  if (!data)
    return (
      <div className="flex size-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  if (data.kind === "none") return <Empty text={data.message} />;
  if (data.kind === "text")
    return (
      <pre className="mx-auto size-full max-w-5xl overflow-auto bg-card p-6 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {data.text}
        {data.truncated && "\n\n…（太长了，只显示前面一部分，完整内容请下载）"}
      </pre>
    );
  if (data.kind === "html")
    return (
      <iframe
        title="文档"
        sandbox=""
        className="size-full border-0 bg-white"
        srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:14px/1.6 -apple-system,"PingFang SC",Arial,sans-serif;max-width:860px;margin:24px auto;padding:0 20px;color:#222}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}img{max-width:100%}</style>${data.html}`}
      />
    );
  const cur = data.sheets[sheet] ?? data.sheets[0];
  return (
    <div className="flex size-full flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-auto">
        {!cur || !cur.rows.length ? (
          <Empty text="这张表是空的" />
        ) : (
          <table className="border-collapse text-xs">
            <tbody>
              {cur.rows.map((r, i) => (
                <tr
                  key={i}
                  className={
                    i === 0 ? "sticky top-0 bg-muted font-medium" : undefined
                  }
                >
                  <td className="border bg-muted/60 px-1.5 text-right text-muted-foreground tabular-nums">
                    {i + 1}
                  </td>
                  {r.map((c, j) => (
                    <td
                      key={j}
                      className="max-w-[320px] border px-2 py-1 align-top whitespace-pre-wrap"
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cur?.truncated && (
          <p className="p-2 text-xs text-muted-foreground">
            只显示前 1000 行，完整内容请下载
          </p>
        )}
      </div>
      {data.sheets.length > 1 && (
        // 工作表切换放在底部，跟 Excel 一样
        <div className="flex shrink-0 gap-0.5 overflow-x-auto border-t bg-muted/60 px-1 pb-1">
          {data.sheets.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSheet(i)}
              className={cn(
                "shrink-0 rounded-b-md px-3 py-1 text-xs",
                i === sheet
                  ? "bg-card font-medium text-emerald-700 shadow-e1"
                  : "text-muted-foreground hover:bg-card/60",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 能出缩略图的类型（图片、PDF、Office 文件） */
export const hasThumb = (name: string, mime = "") => {
  const k = fileKind(name, mime);
  return k === "image" || k === "pdf" || isOfficeFile(name, mime);
};

/** 文件缩略图：第一页 / 图片缩小；没有缩略图时显示类型色块 */
export function FileThumb({
  src,
  name,
  mime,
  className,
  fit = "cover",
}: {
  src: string;
  name: string;
  mime?: string | null;
  className?: string;
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);
  const badge = fileBadge(name, mime ?? "");
  const thumb = hasThumb(name, mime ?? "") && !failed;
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden bg-muted",
        className,
      )}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口
        <img
          src={withQuery(src, "preview=thumb")}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className={cn(
            "size-full bg-white",
            fit === "cover" ? "object-cover object-top" : "object-contain",
          )}
        />
      ) : (
        <FileText className="size-1/3 min-w-5 text-muted-foreground/70" />
      )}
      <span
        className={cn(
          "absolute bottom-1 left-1 rounded px-1 py-px text-[9px] leading-tight font-bold text-white shadow-sm",
          badge.tone,
        )}
      >
        {badge.label}
      </span>
    </span>
  );
}

/** 一个文件小卡片：缩略图 + 名字，点了在线预览 */
export function FileChip({
  file,
  className,
}: {
  file: PreviewFile;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => openFilePreview(file)}
      className={cn(
        "flex items-center gap-2 rounded-md bg-black/5 p-1.5 pr-2 text-left hover:bg-black/10",
        className,
      )}
      title="点击预览"
    >
      <FileThumb
        src={file.src}
        name={file.name}
        mime={file.mime}
        className="size-11 rounded"
      />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13px] leading-snug break-all">
          {file.name || "文件"}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {fileSizeText(file.size)}
        </span>
      </span>
    </button>
  );
}
