"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, FileText, History, Plus, Printer, Trash2, WandSparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TradeDocView } from "@/components/trade-docs/doc-render";
import {
  DOC_TYPES,
  FIELDS,
  TEMPLATES,
  applyPatch,
  docTitle,
  emptyDoc,
  fieldLabel,
  missingFields,
  type DocCharge,
  type DocData,
  type DocItem,
  type DocPatch,
  type DocType,
  type FieldKey,
} from "@/lib/trade-docs/schema";
import type { TradeDocRow } from "@/server/trade-docs";
import { cn } from "@/lib/utils";
import { deleteTradeDocAction, loadTradeDocAction, saveTradeDocAction } from "./actions";
import { AI_NAME, DocChat, type ChatMsg } from "./doc-chat";
import { DocForm, KEEP_CASE } from "./doc-form";

type Mode = "form" | "ai";

const A4_PX = 794; // 210mm

function fmtWhen(d: Date) {
  const x = new Date(d);
  const now = new Date();
  return x.toDateString() === now.toDateString()
    ? x.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : x.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

const toChat = (v: unknown): ChatMsg[] =>
  (Array.isArray(v) ? v : []).map((m) => {
    const r = m as { role: "user" | "assistant"; text: string; card?: ChatMsg["card"] };
    return { role: r.role, text: r.text, ...(r.card ? { card: r.card } : {}) };
  });

/** 选单据类型（没选时铺满左栏） */
function TypePicker({ onPick }: { onPick: (t: DocType) => void }) {
  return (
    <div className="px-4 py-4">
      <p className="text-[13px] text-muted-foreground">选一种单据开始填。做好一张后可以一键转成别的单据，资料不用重填。</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {DOC_TYPES.map((t) => {
          const tp = TEMPLATES[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onPick(t)}
              className="group rounded-xl border border-line bg-card p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
            >
              <span className="flex items-baseline gap-1.5">
                <span className="text-[14px] font-medium">{tp.name}</span>
                <span className="text-[11px] text-muted-foreground">{tp.short}</span>
              </span>
              <span className="mt-1 line-clamp-2 block text-[12px] leading-snug text-muted-foreground">{tp.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Workbench({
  initial,
  seller,
  docs: initialDocs,
  aiEnabled,
  today,
}: {
  initial: { id: string | null; type: DocType | null; data: DocData; chat: unknown };
  seller: Partial<DocData>;
  docs: TradeDocRow[];
  aiEnabled: boolean;
  today: string;
}) {
  const [docId, setDocId] = useState(initial.id);
  const [type, setType] = useState<DocType | null>(initial.type);
  const [data, setData] = useState<DocData>(initial.data);
  const [messages, setMessages] = useState<ChatMsg[]>(() => toChat(initial.chat));
  const [docs, setDocs] = useState(initialDocs);
  const [mode, setMode] = useState<Mode>(aiEnabled && !initial.type ? "ai" : "form");
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [focusKey, setFocusKey] = useState<{ key: string; n: number } | null>(null);
  const [session, setSession] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [turnTick, setTurnTick] = useState(0);
  const [missOpen, setMissOpen] = useState(false);

  // ── 保存：串行执行，始终用最新状态 ──
  const st = useRef({ docId, type, data, messages });
  useLayoutEffect(() => {
    st.current = { docId, type, data, messages };
  });
  const ver = useRef(0);
  // 打开 / 新建时的那份状态：和它不同才算有改动
  const base = useRef({ type: initial.type, data: initial.data, messages });
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const b = base.current;
    if (b.type === type && b.data === data && b.messages === messages) return;
    ver.current++;
    setDirty(true);
  }, [type, data, messages]);

  const save = useCallback((opts?: { quiet?: boolean }) => {
    const run = async (): Promise<string | null> => {
      const s = st.current;
      if (!s.type) return null;
      const v = ver.current;
      setSaving(true);
      try {
        const res = await saveTradeDocAction({
          id: s.docId,
          type: s.type,
          data: s.data,
          chat: s.messages.map((m) => ({ role: m.role, text: m.text || m.error || "", ...(m.card ? { card: m.card } : {}) })),
        });
        if (!res.ok) {
          toast.error(res.message);
          return null;
        }
        st.current.docId = res.id;
        setDocId(res.id);
        setDocs(res.docs);
        if (ver.current === v) setDirty(false);
        if (window.location.search !== `?id=${res.id}`) window.history.replaceState(null, "", `/doc?id=${res.id}`);
        if (!opts?.quiet) toast.success("已保存");
        return res.id;
      } catch {
        toast.error("保存失败，请重试");
        return null;
      } finally {
        setSaving(false);
      }
    };
    const p = chain.current.then(run, run);
    chain.current = p.catch(() => undefined);
    return p;
  }, []);

  // 已存过的单据：改动后 1.5 秒自动保存
  useEffect(() => {
    if (!dirty || !docId || !type) return;
    const t = setTimeout(() => void save({ quiet: true }), 1500);
    return () => clearTimeout(t);
  }, [dirty, docId, type, data, save]);

  // AI 一轮结束：状态落地后保存（选了单据类型才存）
  useEffect(() => {
    if (turnTick && st.current.type) void save({ quiet: true });
  }, [turnTick, save]);

  // ── 改单据 ──
  const onSet = useCallback((k: FieldKey, v: string) => {
    const kind = (FIELDS[k] as { kind: string }).kind;
    const val = (kind === "text" || kind === "textarea") && !KEEP_CASE.has(k) ? v.toUpperCase() : v;
    setData((d) => {
      const n = { ...d };
      if (val) n[k] = val;
      else delete n[k];
      return n;
    });
  }, []);
  const onItems = useCallback((items: DocItem[]) => setData((d) => ({ ...d, items })), []);
  const onCharges = useCallback((charges: DocCharge[]) => setData((d) => ({ ...d, charges })), []);
  const onApply = useCallback((p: Partial<DocData>, label: string) => {
    const { items, charges, ...rest } = p;
    setData((d) => ({ ...d, ...rest, items: items?.length ? items : d.items, charges: charges?.length ? charges : d.charges }));
    toast.success(`已带入 ${label}`);
  }, []);
  const onPatch = useCallback((p: DocPatch) => setData((d) => applyPatch(d, p)), []);

  const fresh = useCallback((): DocData => ({ ...emptyDoc(), ...seller, date: today }), [seller, today]);

  const reset = (next: { id: string | null; type: DocType | null; data: DocData; chat: ChatMsg[] }) => {
    base.current = { type: next.type, data: next.data, messages: next.chat };
    setDocId(next.id);
    st.current.docId = next.id;
    setType(next.type);
    setData(next.data);
    setMessages(next.chat);
    setDirty(false);
    setSession((n) => n + 1);
    setFocusKey(null);
    window.history.replaceState(null, "", next.id ? `/doc?id=${next.id}` : "/doc");
  };

  const leave = async () => {
    if (dirty && type) await save({ quiet: true });
  };

  const newDoc = async () => {
    await leave();
    reset({ id: null, type: null, data: fresh(), chat: [] });
    if (aiEnabled) setMode("ai");
  };

  const openDoc = async (id: string) => {
    if (id === docId) return;
    await leave();
    const d = await loadTradeDocAction(id);
    if (!d) {
      toast.error("这张单据找不到了");
      return;
    }
    reset({ id: d.id, type: d.type, data: d.data, chat: toChat(d.chat) });
  };

  const removeDoc = async (id: string) => {
    setDocs(await deleteTradeDocAction(id));
    if (id === docId) reset({ id: null, type: null, data: fresh(), chat: [] });
    toast.success("已删除");
  };

  const print = async () => {
    const w = window.open("about:blank", "_blank");
    const id = await save({ quiet: true });
    if (id && w) w.location.href = `/print/trade-docs/${id}`;
    else w?.close();
  };

  const switchType = (t: DocType) => {
    setType(t);
    setView("edit");
  };

  const missing = useMemo(() => (type ? missingFields(type, data) : []), [type, data]);
  const jump = (k: string) => {
    setMode("form");
    setView("edit");
    setMissOpen(false);
    setFocusKey({ key: k, n: Date.now() });
  };

  // ── 预览缩放：A4 放不下就按宽度缩 ──
  const scroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      if (w > 0) setZoom(Math.max(0.35, Math.min(1, (w - 32) / A4_PX)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const t = type ? TEMPLATES[type] : null;
  const saveText = saving ? "保存中…" : dirty ? (docId ? "未保存" : "未保存（填好后点保存）") : docId ? "已保存" : "";

  const typeMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="max-w-[12rem]">
          <FileText className="text-muted-foreground" />
          <span className="truncate">{t ? t.name : "选择单据"}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t ? "转成其他单据（已填资料保留）" : "选择单据类型"}</DropdownMenuLabel>
        {DOC_TYPES.map((k) => (
          <DropdownMenuItem key={k} onSelect={() => switchType(k)} className={cn(k === type && "bg-accent font-medium")}>
            <span className="w-7 shrink-0 text-[11px] text-muted-foreground">{TEMPLATES[k].short}</span>
            {TEMPLATES[k].name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="-mx-3 -mt-3 -mb-4 flex h-[calc(100svh-6.75rem-1px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[26rem] flex-col overflow-hidden surface rounded-none shadow-none md:m-0 md:h-[calc(100svh-6.5rem)] md:min-h-[34rem] md:rounded-2xl lg:flex-row md:shadow-[var(--card-shadow)]">
      {/* 窄屏：编辑 / 预览 切换 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-2 lg:hidden">
        {(["edit", "preview"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn("rounded-lg px-3 py-1.5 text-sm", view === v ? "bg-accent font-medium text-accent-foreground" : "text-foreground/70")}
          >
            {v === "edit" ? "编辑" : "预览"}
          </button>
        ))}
        {!!missing.length && (
          <button type="button" onClick={() => jump(missing[0])} className="ml-auto text-xs text-amber-700">
            还缺 {missing.length} 项
          </button>
        )}
      </div>

      {/* 左：填表 / AI 对话 */}
      <aside className={cn("flex min-h-0 w-full min-w-0 flex-1 flex-col lg:w-[440px] lg:flex-none lg:border-r lg:border-line", view === "preview" && "max-lg:hidden")}>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
          <WandSparkles className="size-4 text-brand" />
          <h1 className="text-[15px] font-semibold">AI 单据制作</h1>
          <div className="ml-auto">{typeMenu}</div>
        </div>
        <div className="flex shrink-0 gap-1 px-4 pt-2.5 pb-2" role="tablist">
          {(
            [
              ["ai", `${AI_NAME} 对话`],
              ["form", "填表"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={mode === k}
              onClick={() => setMode(k)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                mode === k ? "bg-accent font-medium text-accent-foreground" : "text-foreground/70 hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto border-t border-line", mode !== "form" && "hidden")}>
          {type ? (
            <DocForm
              key={`${session}-${type}`}
              type={type}
              data={data}
              onSet={onSet}
              onItems={onItems}
              onCharges={onCharges}
              onApply={onApply}
              focusKey={focusKey}
            />
          ) : (
            <TypePicker onPick={switchType} />
          )}
        </div>
        <div className={cn("min-h-0 flex-1 border-t border-line", mode !== "ai" && "hidden")}>
          <DocChat
            key={session}
            type={type}
            data={data}
            messages={messages}
            setMessages={setMessages}
            enabled={aiEnabled}
            onPatch={onPatch}
            onType={setType}
            onTurnEnd={() => setTurnTick((n) => n + 1)}
          />
        </div>
      </aside>

      {/* 右：A4 预览 */}
      <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-muted/40", view === "edit" && "max-lg:hidden")}>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-card px-3">
          <p className="min-w-0 truncate text-[14px] font-medium">{type ? docTitle(type, data) : "单据预览"}</p>
          {saveText && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{saveText}</span>}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {type && (
              <Popover open={missOpen} onOpenChange={setMissOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost" className={cn(missing.length ? "text-amber-700" : "text-ok")}>
                    {missing.length ? `还缺 ${missing.length} 项` : "必填已齐"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-2">
                  {missing.length ? (
                    <>
                      <p className="px-1.5 pt-0.5 text-xs text-muted-foreground">点一项直接去填（预览里黄色的就是）</p>
                      <div className="flex flex-col">
                        {missing.map((k) => (
                          <button key={k} type="button" onClick={() => jump(k)} className="rounded-md px-1.5 py-1.5 text-left text-[13px] hover:bg-muted">
                            {fieldLabel(k)}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="px-1.5 py-1 text-[13px] text-muted-foreground">必填项都齐了，可以保存、打印。</p>
                  )}
                </PopoverContent>
              </Popover>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" title="我做过的单据" aria-label="我做过的单据">
                  <History />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-96 w-80">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">我做过的单据</DropdownMenuLabel>
                {docs.length === 0 && <p className="px-2 py-3 text-center text-[13px] text-muted-foreground">还没有保存过单据</p>}
                {docs.map((d) => (
                  <DropdownMenuItem key={d.id} onSelect={() => void openDoc(d.id)} className={cn("group gap-2", d.id === docId && "bg-accent")}>
                    <span className="w-7 shrink-0 text-[11px] text-muted-foreground">{TEMPLATES[d.type].short}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{d.no || TEMPLATES[d.type].name}</span>
                      {d.buyer && <span className="block truncate text-[11px] text-muted-foreground">{d.buyer}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{fmtWhen(d.updatedAt)}</span>
                    <button
                      type="button"
                      title="删除"
                      aria-label="删除"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (window.confirm("删除这张单据？")) void removeDoc(d.id);
                      }}
                      className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus:opacity-100 hover:text-destructive max-md:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void newDoc()}>
                  <Plus /> 新建单据
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="ghost" onClick={() => void newDoc()} className="max-sm:hidden">
              <Plus /> 新建
            </Button>
            <Button size="sm" variant="outline" disabled={!type || saving} onClick={() => void save()}>
              保存
            </Button>
            <Button size="sm" disabled={!type} onClick={() => void print()}>
              <Printer /> <span className="max-sm:hidden">打印 / PDF</span>
            </Button>
          </div>
        </div>
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-4 py-5">
          {type ? (
            <div style={{ zoom }} className="mx-auto w-fit">
              <TradeDocView type={type} data={data} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <FileText className="size-8 text-muted-foreground/50" />
              <p className="mt-3 text-[14px] font-medium">还没选单据</p>
              <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">
                {aiEnabled ? `在左边跟${AI_NAME}说要做什么，或者切到「填表」选一种单据。` : "在左边选一种单据开始填。"}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
