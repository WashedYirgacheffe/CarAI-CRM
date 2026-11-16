"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, CornerDownLeft, Loader2, Maximize2, Minimize2, Paperclip, Send, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { cancelJobAction } from "./actions";

type LiveInput =
  | { t: "click" | "dblclick"; x: number; y: number }
  | { t: "wheel"; dy: number }
  | { t: "type"; text: string }
  | { t: "key"; key: string }
  | { t: "back" }
  | { t: "resize"; w: number; h: number };

const SPECIAL = new Set(["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete", "Home", "End", "PageUp", "PageDown"]);
/** Ctrl / ⌘ 组合键：全选、撤销、重做、剪切 */
const COMBO = new Set(["a", "z", "x"]);
const ACTIVE = ["queued", "running", "waiting"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_UPLOAD_MB = 25;

/**
 * 云端浏览器的实时画面：在画面上点击、滚动、直接打字、粘贴，跟操作真的浏览器一样。
 * 画面大小跟着这个窗口走（云端浏览器的窗口会调成一样大）；可以上传本机文件给网页。
 * 手机上没有实体键盘，用下面的输入框发送文字。
 */
export function LiveDialog({ jobId, title, open, onOpenChange }: { jobId: string; title: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("queued");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [chooser, setChooser] = useState(false);
  const [text, setText] = useState("");
  const [ending, setEnding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [full, setFull] = useState(false);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typed = useRef("");
  const wheel = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 长轮询取画面
  useEffect(() => {
    if (!open) return;
    let stop = false;
    let seq = 0;
    let last: string | null = null;
    (async () => {
      while (!stop) {
        const r = await fetch(`/api/matrix/jobs/${jobId}/live?seq=${seq}`, { cache: "no-store" }).catch(() => null);
        if (stop) break;
        if (!r) {
          await sleep(1500);
          continue;
        }
        if (r.status === 404) {
          setResult({ ok: false, text: "任务不存在或没有权限" });
          break;
        }
        const st = r.headers.get("x-job-status") ?? "";
        setStatus(st);
        setPageUrl(decodeURIComponent(r.headers.get("x-page-url") ?? ""));
        setChooser(r.headers.get("x-file-chooser") === "1");
        if (r.status === 200) {
          seq = Number(r.headers.get("x-seq") || seq);
          const url = URL.createObjectURL(await r.blob());
          if (last) URL.revokeObjectURL(last);
          last = url;
          setSrc(url);
        }
        if (st && !ACTIVE.includes(st)) {
          const err = decodeURIComponent(r.headers.get("x-job-error") ?? "");
          const acc = r.headers.get("x-account-status");
          setResult(
            st === "done"
              ? { ok: true, text: acc === "active" ? "已登录，浏览器数据已保存" : "已结束" }
              : { ok: false, text: st === "canceled" ? "已结束" : err || "任务失败" },
          );
          router.refresh();
          break;
        }
        if (r.status === 204 && st === "queued") await sleep(1000);
      }
    })();
    return () => {
      stop = true;
      if (last) URL.revokeObjectURL(last);
      setSrc(null);
    };
  }, [open, jobId, router]);

  const send = (ev: LiveInput) =>
    fetch(`/api/matrix/jobs/${jobId}/input`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ev) }).catch(() => {});

  // 连续打字、滚轮合并成一次发送；长文本按 500 字一段
  const flush = () => {
    flushTimer.current = null;
    for (let i = 0; i < typed.current.length; i += 500) send({ t: "type", text: typed.current.slice(i, i + 500) });
    if (wheel.current) send({ t: "wheel", dy: Math.round(wheel.current) });
    typed.current = "";
    wheel.current = 0;
  };
  const later = () => {
    flushTimer.current ??= setTimeout(flush, 150);
  };
  const sendNow = (ev: LiveInput) => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flush();
    send(ev);
  };

  const live = ACTIVE.includes(status) && !result;
  const running = live && status !== "queued";
  const starting = live && !src;

  // 画面自适应：云端浏览器的窗口调成和画面区域一样大
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !running) return;
    let sent = { w: 0, h: 0 };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      timer = null;
      const w = Math.round(Math.min(2560, Math.max(320, el.clientWidth)));
      const h = Math.round(Math.min(1600, Math.max(320, el.clientHeight)));
      if (Math.abs(w - sent.w) < 16 && Math.abs(h - sent.h) < 16) return;
      sent = { w, h };
      send({ t: "resize", w, h });
    };
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(measure, 400);
    });
    ro.observe(el);
    measure();
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, jobId]);

  const upload = async (files: File[]) => {
    if (!running || !files.length) return;
    const size = files.reduce((n, f) => n + f.size, 0);
    if (size > MAX_UPLOAD_MB * 1024 * 1024) return toast.error(`文件太大，一次最多 ${MAX_UPLOAD_MB} MB`);
    const fd = new FormData();
    for (const f of files) fd.append("file", f);
    setUploading(true);
    const r = await fetch(`/api/matrix/jobs/${jobId}/upload`, { method: "POST", body: fd }).catch(() => null);
    setUploading(false);
    if (!r?.ok) {
      const d = (await r?.json().catch(() => null)) as { error?: string } | null;
      return toast.error(d?.error ?? "上传失败");
    }
    toast.success(chooser ? `已把 ${files.length} 个文件交给网页` : `已上传 ${files.length} 个文件，在网页上点「上传」按钮时自动选上`);
  };

  const point = (e: React.MouseEvent<HTMLImageElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  // 原生 wheel 事件才能 preventDefault，避免整个弹窗跟着滚
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheel.current += e.deltaY;
      later();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "grid-cols-[minmax(0,1fr)] gap-3 *:min-w-0",
          full ? "h-dvh max-h-dvh w-screen max-w-none rounded-none grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-none" : "sm:max-w-5xl",
        )}
      >
        <DialogHeader className="pr-16">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate">
            {result ? result.text : starting ? "正在启动云端浏览器（首次约 1 分钟）…" : pageUrl || "在画面上直接点击、滚动、打字；扫码登录用手机扫画面里的二维码"}
          </DialogDescription>
        </DialogHeader>
        <Button
          size="icon-sm"
          variant="ghost"
          className="absolute top-3 right-12"
          aria-label={full ? "退出全屏" : "全屏"}
          onClick={() => setFull((v) => !v)}
        >
          {full ? <Minimize2 /> : <Maximize2 />}
        </Button>

        <div
          ref={boxRef}
          tabIndex={0}
          autoFocus
          className={cn(
            "relative flex items-center justify-center overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring",
            full ? "h-full min-h-0" : "h-[min(70vh,900px)] min-h-64",
            dragging && "ring-2 ring-primary",
          )}
          onKeyDown={(e) => {
            if (!live || e.nativeEvent.isComposing) return;
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key.toLowerCase() === "v") return; // 交给 onPaste
            if (mod && !e.altKey && COMBO.has(e.key.toLowerCase())) {
              e.preventDefault();
              sendNow({ t: "key", key: `ControlOrMeta+${e.shiftKey && e.key.toLowerCase() === "z" ? "Shift+z" : e.key.toLowerCase()}` });
              return;
            }
            if (mod || e.altKey) return;
            if (e.key === "Tab" && e.shiftKey) {
              e.preventDefault();
              sendNow({ t: "key", key: "Shift+Tab" });
            } else if (SPECIAL.has(e.key)) {
              e.preventDefault();
              sendNow({ t: "key", key: e.key });
            } else if (e.key.length === 1) {
              e.preventDefault();
              typed.current += e.key;
              later();
            }
          }}
          onPaste={(e) => {
            if (!live) return;
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              void upload(files);
              return;
            }
            const t = e.clipboardData.getData("text");
            if (t) {
              e.preventDefault();
              typed.current += t.slice(0, 20_000);
              later();
            }
          }}
          onDragOver={(e) => {
            if (!running || !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            setDragging(false);
            if (!running) return;
            e.preventDefault();
            void upload(Array.from(e.dataTransfer.files));
          }}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt="云端浏览器画面"
              draggable={false}
              className={`block h-auto max-h-full w-auto max-w-full select-none ${live ? "cursor-pointer" : "opacity-60"}`}
              onClick={(e) => {
                boxRef.current?.focus();
                if (live && e.detail === 1) sendNow({ t: "click", ...point(e) });
              }}
              onDoubleClick={(e) => live && sendNow({ t: "dblclick", ...point(e) })}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 p-10 text-sm text-muted-foreground">
              {live && <Loader2 className="animate-spin" />}
              {result ? result.text : "等待画面…"}
            </div>
          )}
          {chooser && running && (
            <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-primary px-3 py-2 text-sm text-primary-foreground">
              网页在等你选文件
              <Button size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 /> : <Paperclip />} 从本机选择
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text) return;
              typed.current += text;
              flush();
              setText("");
            }}
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="输入文字发送到当前输入框（手机用）" disabled={!live} autoComplete="off" className="min-w-0" />
            <Button type="submit" size="sm" variant="outline" disabled={!live || !text}>
              <Send /> 发送
            </Button>
          </form>
          <Button size="sm" variant="outline" disabled={!live} onClick={() => sendNow({ t: "key", key: "Enter" })}>
            <CornerDownLeft /> 回车
          </Button>
          <Button size="sm" variant="outline" disabled={!live} onClick={() => sendNow({ t: "key", key: "Backspace" })}>
            退格
          </Button>
          <Button size="sm" variant="outline" disabled={!live} onClick={() => sendNow({ t: "back" })}>
            <ArrowLeft /> 后退
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void upload(files);
            }}
          />
          <Button size="sm" variant="outline" disabled={!running || uploading} onClick={() => fileRef.current?.click()} title="也可以把文件拖到画面上，或直接粘贴图片">
            {uploading ? <Loader2 /> : <Paperclip />} 上传文件
          </Button>
          {live ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={ending}
              onClick={async () => {
                setEnding(true);
                await cancelJobAction(jobId);
                setEnding(false);
                onOpenChange(false);
                router.refresh();
              }}
            >
              {ending ? <Loader2 /> : <X />} 结束
            </Button>
          ) : (
            <Button size="sm" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
