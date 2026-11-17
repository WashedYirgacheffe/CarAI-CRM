"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";
import { Archive, Download, FileText, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fileKind, fileSizeText, type FilePreviewData } from "@/lib/files";
import { cn } from "@/lib/utils";
import { saveAttachmentAction } from "@/app/(app)/files/actions";

/*
 * 文件在线预览：PDF 用浏览器自带的阅读器，图片 / 视频 / 音频直接放，
 * Excel 按工作表显示成表格，Word 转成 HTML，文本原样显示。三个接口（客户文件、WhatsApp、邮件附件）
 * 都支持 ?preview=raw（从我们自己的域名内嵌返回）和 ?preview=json（表格 / Word / 文本的内容）。
 */

export type PreviewFile = {
  /** 接口地址，不带参数，例如 /api/crm-files/xxx */
  src: string;
  /** 下载地址 */
  download: string;
  name: string;
  mime?: string | null;
  size?: number | null;
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

export function FilePreviewDialog({
  file,
  onClose,
}: {
  file: PreviewFile | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92svh] flex-col gap-3 sm:h-[calc(100svh-4rem)] sm:max-w-5xl">
        {file && <PreviewBody file={file} />}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ file }: { file: PreviewFile }) {
  const kind = fileKind(file.name, file.mime ?? "");
  const [saving, startSave] = useTransition();
  const raw = withQuery(file.src, "preview=raw");

  const save = () =>
    startSave(async () => {
      const r = await saveAttachmentAction({
        ...file.save,
        customerId: file.save?.customerId ?? undefined,
      });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle className="truncate">{file.name}</DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-2">
          <span>{fileSizeText(file.size)}</span>
          <Button asChild size="sm" variant="outline" className="h-7">
            <a href={file.download}>
              <Download /> 下载
            </a>
          </Button>
          {file.save && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={save}
              disabled={saving}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Archive />}{" "}
              存到客户资料
            </Button>
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/30">
        {kind === "pdf" ? (
          <PdfView src={file.src} name={file.name} />
        ) : kind === "image" ? (
          <div className="flex size-full items-center justify-center overflow-auto p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口 */}
            <img
              src={raw}
              alt={file.name}
              className="max-h-full max-w-full object-contain"
            />
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
    </>
  );
}

/** 浏览器能内嵌 PDF 就用自带阅读器；桌面版（Electron）、安卓浏览器不能，就由服务器一页页渲染成图片 */
const subscribeNoop = () => () => {};
function PdfView({ src, name }: { src: string; name: string }) {
  const native = useSyncExternalStore(
    subscribeNoop,
    () => navigator.pdfViewerEnabled !== false,
    () => true,
  );
  if (native)
    return (
      <iframe
        title={name}
        src={withQuery(src, "preview=raw")}
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
  if (failed) return <Empty text="PDF 打不开，请下载后查看" />;
  if (total == null)
    return (
      <div className="flex size-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  return (
    <div className="flex size-full flex-col items-center gap-3 overflow-auto bg-muted/50 p-3">
      {Array.from({ length: Math.min(total, 100) }, (_, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口
        <img
          key={i}
          src={withQuery(src, `preview=page&n=${i + 1}`)}
          alt={`${name} 第 ${i + 1} 页`}
          loading="lazy"
          className="w-full max-w-3xl bg-white shadow-sm"
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
      <pre className="size-full overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
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
        srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:14px/1.6 -apple-system,"PingFang SC",Arial,sans-serif;max-width:820px;margin:24px auto;padding:0 20px;color:#222}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}img{max-width:100%}</style>${data.html}`}
      />
    );
  const cur = data.sheets[sheet] ?? data.sheets[0];
  return (
    <div className="flex size-full flex-col">
      {data.sheets.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b bg-background p-1">
          {data.sheets.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSheet(i)}
              className={cn(
                "shrink-0 rounded px-2.5 py-1 text-xs",
                i === sheet
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-background">
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
    </div>
  );
}

/** 一个文件小卡片：点了在线预览 */
export function FileChip({
  file,
  className,
}: {
  file: PreviewFile;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 text-left hover:bg-black/10",
          className,
        )}
        title="点击预览"
      >
        <FileText className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{file.name || "文件"}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {fileSizeText(file.size)}
        </span>
      </button>
      <FilePreviewDialog
        file={open ? file : null}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
