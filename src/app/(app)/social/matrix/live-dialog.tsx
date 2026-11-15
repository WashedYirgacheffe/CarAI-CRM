"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CornerDownLeft, Loader2, Send, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cancelJobAction } from "./actions";

type LiveInput =
  | { t: "click" | "dblclick"; x: number; y: number }
  | { t: "wheel"; dy: number }
  | { t: "type"; text: string }
  | { t: "key"; key: string }
  | { t: "back" };

const SPECIAL = new Set(["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete", "Home", "End", "PageUp", "PageDown"]);
const ACTIVE = ["queued", "running", "waiting"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 云端浏览器的实时画面：在画面上点击、滚动、直接打字，跟操作真的浏览器一样。
 * 手机上没有实体键盘，用下面的输入框发送文字。
 */
export function LiveDialog({ jobId, title, open, onOpenChange }: { jobId: string; title: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("queued");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [text, setText] = useState("");
  const [ending, setEnding] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
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

  // 连续打字、滚轮合并成一次发送
  const flush = () => {
    flushTimer.current = null;
    if (typed.current) send({ t: "type", text: typed.current });
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

  const live = ACTIVE.includes(status) && !result;
  const starting = live && !src;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-3 sm:max-w-5xl *:min-w-0">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate">
            {result ? result.text : starting ? "正在启动云端浏览器（首次约 1 分钟）…" : pageUrl || "在画面上直接点击、滚动、打字；扫码登录用手机扫画面里的二维码"}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={boxRef}
          tabIndex={0}
          autoFocus
          className="relative flex min-h-64 items-center justify-center overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(e) => {
            if (!live || e.nativeEvent.isComposing) return;
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") return; // 交给 onPaste
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (SPECIAL.has(e.key)) {
              e.preventDefault();
              sendNow({ t: "key", key: e.key });
            } else if (e.key.length === 1) {
              e.preventDefault();
              typed.current += e.key;
              later();
            }
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (live && t) {
              e.preventDefault();
              typed.current += t.slice(0, 500);
              later();
            }
          }}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt="云端浏览器画面"
              draggable={false}
              className={`block max-h-[70vh] w-auto max-w-full select-none ${live ? "cursor-pointer" : "opacity-60"}`}
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
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text) return;
              sendNow({ t: "type", text });
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
