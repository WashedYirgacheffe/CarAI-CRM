"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  ClipboardList,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Link2Off,
  LoaderCircle,
  MessageCircle,
  Package,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  Truck,
} from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WaAvatar } from "@/components/crm/wa-avatar";
import { KindTag, QuickReminder, TaskList, type TaskItem } from "@/components/crm/tasks";
import { runAction } from "@/hooks/use-action-form";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";
import { STATUS_COLORS, formatDateTime, formatMoney } from "@/lib/crm";
import { quotationStatus } from "@/lib/docs";
import { TIME_PRESETS } from "@/lib/reminders";
import { waListTime } from "@/lib/wa-time";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileThumb, openFilePreview } from "@/components/crm/file-preview";
import { FILE_TYPE_FILTERS, fileCategoryLabel, fileKind, fileSizeText } from "@/lib/files";
import {
  aiChatFollowUpAction,
  productDetailAction,
  sendCrmFileAction,
  saveChatFollowUpAction,
  searchProductsAction,
  sendFormAction,
  sendProductAction,
  sendQuotationAction,
  unlinkChatAction,
  type AiFollowUp,
  type ProductDetail,
  type ProductPick,
} from "./actions";

export type PanelData = {
  chat: {
    id: string;
    name: string | null;
    phone: string | null;
    avatar: string | null;
    customer: { id: string; name: string; status: string | null; country: string | null; owner: string | null } | null;
    contact: { name: string; title: string | null; email: string | null } | null;
  };
  msgCount: number;
  firstAt: string | null;
  media: { id: string; type: string }[];
  starred: { id: string; body: string; fromMe: boolean; timestamp: string }[];
  tasks: TaskItem[];
  activities: { id: string; content: string; createdAt: string; user: string | null; follow: boolean }[];
  quotations: { id: string; no: string; total: string; currency: string; status: string; approval: string; date: string }[];
  files: { id: string; name: string; mime: string; size: number; category: string; createdAt: string }[];
};

export type PanelTab = "info" | "follow" | "todo" | "send";
const TABS: { key: PanelTab; label: string }[] = [
  { key: "follow", label: "跟进" },
  { key: "todo", label: "待办" },
  { key: "send", label: "发送" },
  { key: "info", label: "资料" },
];

export function ChatPanel({
  data,
  tz,
  canAi,
  onLink,
  onOpenImage,
  onJump,
  tab,
  onTab,
}: {
  data: PanelData;
  tz: string;
  canAi: boolean;
  onLink: () => void;
  onOpenImage: (id: string) => void;
  onJump: (messageId: string) => void;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
}) {
  const setTab = onTab;
  const openTodos = data.tasks.filter((t) => !t.done).length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <CustomerHeader data={data} onLink={onLink} />
      <nav className="mx-3 mb-2 grid grid-cols-4 rounded-full bg-muted/70 p-1" role="tablist" aria-label="客户面板">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative rounded-full py-1.5 text-[13px] font-medium transition-colors",
              tab === t.key ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.key === "todo" && openTodos > 0 && <span className="ml-1 text-[11px] text-primary tabular-nums">{openTodos}</span>}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {tab === "follow" && <FollowTab data={data} tz={tz} canAi={canAi} />}
        {tab === "todo" && <TodoTab data={data} tz={tz} />}
        {tab === "send" && <SendTab data={data} />}
        {tab === "info" && <InfoTab data={data} tz={tz} onOpenImage={onOpenImage} onJump={onJump} />}
      </div>
    </div>
  );
}

function CustomerHeader({ data, onLink }: { data: PanelData; onLink: () => void }) {
  const { chat } = data;
  const c = chat.customer;
  return (
    <div className="px-3 pt-4 pb-3">
      <div className="flex items-center gap-3 px-1">
        <WaAvatar src={chat.avatar} name={chat.name} phone={chat.phone} className="size-11 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{chat.name || (chat.phone ? `+${chat.phone}` : "未知号码")}</p>
          {chat.phone && <p className="truncate text-xs text-muted-foreground tabular-nums">+{chat.phone}</p>}
        </div>
      </div>
      {c ? (
        <div className="group mt-3 rounded-xl bg-primary/5 p-3 ring-1 ring-primary/10">
          <Link href={`/customers/${c.id}`} className="flex items-center gap-1.5 font-medium hover:text-primary">
            <Building2 className="size-4 shrink-0 text-primary" />
            <span className="truncate">{c.name}</span>
          </Link>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {[
              c.status,
              c.country,
              chat.contact && `联系人 ${chat.contact.name}${chat.contact.title ? `（${chat.contact.title}）` : ""}`,
              c.owner && `负责人 ${c.owner}`,
            ]
              .filter(Boolean)
              .join(" · ") || "查看客户详情"}
          </p>
          <div className="mt-2 flex gap-1.5">
            <Button size="xs" variant="ghost" className="h-7 px-2 text-xs" onClick={onLink}>
              <RefreshCw /> 更换
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => {
                if (confirm(`取消与「${c.name}」的关联？已记录的跟进会保留，之后的消息不再记到这个客户。`)) void runAction(unlinkChatAction(chat.id));
              }}
            >
              <Link2Off /> 取消关联
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onLink}
          className="mt-3 flex w-full items-center gap-2 rounded-xl border border-dashed border-primary/40 p-3 text-left text-sm text-primary transition-colors hover:bg-primary/5"
        >
          <Link2 className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">关联客户</span>
            <span className="block text-xs text-muted-foreground">关联后消息自动记跟进，可发报价单</span>
          </span>
        </button>
      )}
    </div>
  );
}

// ── 跟进 ──

function FollowTab({ data, tz, canAi }: { data: PanelData; tz: string; canAi: boolean }) {
  const [ai, setAi] = useState<AiFollowUp | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState("");
  const [picked, setPicked] = useState<boolean[]>([]);
  const [saving, setSaving] = useState(false);
  const linked = !!data.chat.customer;

  async function generate() {
    setLoading(true);
    const r = await aiChatFollowUpAction(data.chat.id);
    setLoading(false);
    if (!r.ok || !r.data) {
      toast.error(r.message ?? "AI 整理失败");
      return;
    }
    setAi(r.data);
    setSummary(r.data.summary);
    setPicked(r.data.todos.map(() => true));
  }

  async function save() {
    setSaving(true);
    const todos = ai ? ai.todos.filter((_, i) => picked[i]) : [];
    const r = await runAction(saveChatFollowUpAction(data.chat.id, linked ? summary : "", todos));
    setSaving(false);
    if (r.ok) {
      setAi(null);
      setSummary("");
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-card p-3 shadow-xs ring-1 ring-border/70">
        <div className="mb-2 flex items-center gap-2">
          <p className="flex-1 text-sm font-medium">写跟进记录</p>
          {canAi && (
            <Button size="xs" variant={ai ? "ghost" : "default"} onClick={generate} disabled={loading} className="h-7 text-xs">
              {loading ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              {loading ? "AI 整理中…" : ai ? "重新整理" : "AI 整理聊天"}
            </Button>
          )}
        </div>
        {ai?.intent && (
          <p className="mb-2 rounded-lg bg-brand-soft/40 px-2.5 py-1.5 text-xs text-foreground">
            <span className="font-medium">客户意向：</span>
            {ai.intent}
          </p>
        )}
        {linked ? (
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={ai ? 6 : 3}
            placeholder={canAi ? "点「AI 整理聊天」自动生成，或直接写：客户要什么、谈到哪一步、下一步做什么" : "客户要什么、谈到哪一步、下一步做什么"}
            className="text-sm"
          />
        ) : (
          <p className="rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground">
            关联客户后，跟进记录才能记到客户名下；AI 建议的待办可以直接加到日程。
          </p>
        )}
        {ai && ai.todos.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">AI 建议的待办（勾选的加到日程）</p>
            <ul className="space-y-1.5">
              {ai.todos.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={picked[i]}
                    onCheckedChange={(v) => setPicked((p) => p.map((x, j) => (j === i ? !!v : x)))}
                    aria-label={t.title}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <KindTag kind={t.kind} />
                      <span>{t.title}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{TIME_PRESETS.find((p) => p.key === t.when)?.label}提醒</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(summary.trim() || (ai && picked.some(Boolean))) && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">最近动态</h3>
        {!linked ? (
          <p className="px-1 text-xs text-muted-foreground">关联客户后显示客户的跟进动态。</p>
        ) : data.activities.length ? (
          <ol className="relative space-y-3 border-l border-border pl-4">
            {data.activities.map((a) => (
              <li key={a.id} className="relative">
                <span
                  className={cn(
                    "absolute top-1.5 -left-[21px] size-2 rounded-full ring-2 ring-card",
                    a.follow ? "bg-primary" : "bg-muted-foreground/40",
                  )}
                />
                <p className="line-clamp-4 text-[13px] leading-relaxed whitespace-pre-wrap">{a.content}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatDateTime(a.createdAt, tz)}
                  {a.user && ` · ${a.user}`}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">还没有跟进动态。</p>
        )}
      </section>
    </div>
  );
}

// ── 待办 ──

function TodoTab({ data, tz }: { data: PanelData; tz: string }) {
  const { chat } = data;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <p className="flex-1 text-xs text-muted-foreground">等工厂报价、等船期、催尾款……设个提醒，到点铃铛会响</p>
        <QuickReminder
          tz={tz}
          context="whatsapp"
          customerId={chat.customer?.id}
          link={`/whatsapp?chat=${chat.id}`}
          subject={chat.customer ? undefined : `WhatsApp ${chat.name ?? chat.phone ?? ""}`.trim()}
          label="新提醒"
          size="sm"
          variant="default"
        />
      </div>
      <div className="rounded-xl bg-card px-3 shadow-xs ring-1 ring-border/70">
        <TaskList tasks={data.tasks} tz={tz} showCustomer={false} empty="没有待办" />
      </div>
    </div>
  );
}

// ── 发送 ──

function SendTab({ data }: { data: PanelData }) {
  const { chat } = data;
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<ProductPick[] | null>(null);
  const [withPrice, setWithPrice] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [detail, setDetail] = useState<ProductDetail | "loading" | null>(null);
  const toggle = (id: string) => setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const showDetail = async (id: string) => {
    setDetail("loading");
    const d = await productDetailAction(id);
    if (!d) toast.error("商品不存在");
    setDetail(d);
  };
  async function sendProducts(ids: string[]) {
    setBusy("products");
    for (const id of ids) if (!(await runAction(sendProductAction(chat.id, id, withPrice))).ok) break;
    setBusy(null);
    setPicked([]);
  }

  useEffect(() => {
    const t = setTimeout(async () => setProducts(await searchProductsAction(q)), 200);
    return () => clearTimeout(t);
  }, [q]);

  async function run(id: string, p: Promise<ActionState>) {
    setBusy(id);
    await runAction(p);
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">表单（客户填完自动记到客户 / 线索，并提醒你）</h3>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { kind: "inquiry", label: "询价表单", desc: "品名、数量、目标价", icon: ClipboardList },
              { kind: "shipping", label: "收货信息", desc: "收货人、地址、通知方", icon: Truck },
            ] as const
          ).map((f) => (
            <button
              key={f.kind}
              type="button"
              disabled={busy !== null}
              onClick={() => run(f.kind, sendFormAction(chat.id, f.kind))}
              className="group flex flex-col items-start gap-1 rounded-xl bg-card p-3 text-left shadow-xs ring-1 ring-border/70 transition hover:ring-primary/40 disabled:opacity-60"
            >
              <span className="flex w-full items-center gap-1.5 text-sm font-medium">
                <f.icon className="size-4 text-primary" />
                <span className="flex-1">{f.label}</span>
                {busy === f.kind ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                )}
              </span>
              <span className="text-[11px] text-muted-foreground">{f.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center px-1">
          <h3 className="flex-1 text-xs font-medium text-muted-foreground">报价单（发在线链接，客户打开会提醒你）</h3>
          {chat.customer && (
            <Link href={`/quotations/new?customerId=${chat.customer.id}`} className="text-xs text-primary hover:underline">
              新建
            </Link>
          )}
        </div>
        {!chat.customer ? (
          <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">关联客户后，这里会列出该客户的报价单。</p>
        ) : data.quotations.length ? (
          <ul className="space-y-1.5">
            {data.quotations.map((qt) => {
              const st = quotationStatus(qt.status);
              const blocked = qt.approval === "PENDING" || qt.approval === "REJECTED";
              return (
                <li key={qt.id} className="flex items-center gap-2 rounded-xl bg-card p-2.5 shadow-xs ring-1 ring-border/70">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/quotations/${qt.id}`} className="block truncate text-sm font-medium hover:text-primary">
                      {qt.no}
                    </Link>
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">{formatMoney(qt.total, qt.currency)}</span>
                      <span className={cn("rounded-md border px-1.5 leading-4", STATUS_COLORS[st.color])}>
                        {blocked ? (qt.approval === "PENDING" ? "审批中" : "已驳回") : st.label}
                      </span>
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={busy !== null || blocked}
                    onClick={() => run(qt.id, sendQuotationAction(chat.id, qt.id))}
                  >
                    {busy === qt.id ? <LoaderCircle className="animate-spin" /> : <Send />} 发送
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">这个客户还没有报价单。</p>
        )}
      </section>

      <FilesSection data={data} />

      <section>
        <div className="mb-2 flex items-center gap-2 px-1">
          <h3 className="flex-1 text-xs font-medium text-muted-foreground">商品（发图片 + 英文规格 + 产品卡链接）</h3>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <Checkbox checked={withPrice} onCheckedChange={(v) => setWithPrice(!!v)} className="size-3.5" />
            带价格
          </label>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索品名、型号、货号" className="mb-2 h-9 rounded-full" />
        {products === null ? (
          <p className="py-4 text-center text-xs text-muted-foreground">加载中…</p>
        ) : products.length ? (
          <>
            <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pt-0.5 pb-2 [scrollbar-width:thin]">
              {products.map((p) => {
                const on = picked.includes(p.id);
                return (
                  <li key={p.id} className="shrink-0 snap-start">
                    <button
                      type="button"
                      onClick={() => toggle(p.id)}
                      onDoubleClick={() => void showDetail(p.id)}
                      aria-pressed={on}
                      aria-label={p.name}
                      title={`${p.name}\n单击选中，双击看详情`}
                      className={cn(
                        "group relative block size-24 overflow-hidden rounded-xl bg-muted ring-1 ring-border/70 transition",
                        on ? "ring-2 ring-primary" : "hover:ring-primary/40",
                      )}
                    >
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口
                        <img src={p.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
                      ) : (
                        <span className="grid size-full place-items-center">
                          <Package className="size-6 text-muted-foreground" />
                        </span>
                      )}
                      {/* 悬停显示品名 */}
                      <span className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/75 to-black/0 px-1.5 pt-4 pb-1 text-left text-[10.5px] leading-tight text-white transition-transform group-hover:translate-y-0 group-focus-visible:translate-y-0">
                        <span className="line-clamp-2">{p.name}</span>
                        {Number(p.price) > 0 && <span className="block opacity-80">{formatMoney(p.price, p.currency)}</span>}
                      </span>
                      {on && (
                        <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground shadow">
                          {picked.indexOf(p.id) + 1}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-2 px-1">
              <span className="flex-1 text-[11px] text-muted-foreground">
                {picked.length ? `已选 ${picked.length} 个商品` : "单击选中，双击看详情"}
              </span>
              {picked.length > 0 && (
                <Button size="xs" variant="ghost" className="h-7 text-xs" onClick={() => setPicked([])}>
                  清空
                </Button>
              )}
              <Button
                size="xs"
                className="h-7 text-xs"
                disabled={!picked.length || busy !== null}
                onClick={() => void sendProducts(picked)}
              >
                {busy === "products" ? <LoaderCircle className="animate-spin" /> : <Send />} 发送{picked.length > 1 ? ` ${picked.length} 个` : ""}
              </Button>
            </div>
          </>
        ) : (
          <p className="py-4 text-center text-xs text-muted-foreground">没有找到商品</p>
        )}
      </section>
      <ProductDetailDialog
        detail={detail}
        onClose={() => setDetail(null)}
        busy={busy !== null}
        onSend={(id) => {
          setDetail(null);
          void sendProducts([id]);
        }}
      />
      <p className="px-1 text-[11px] text-muted-foreground">发出的内容会出现在聊天里，和手机上发的一样。</p>
    </div>
  );
}

/** 发文件：客户资料里存好的 PI、CO、报价单、证书、产品图…；横向滑动挑，可多选，附言随第一个文件 */
function FilesSection({ data }: { data: PanelData }) {
  const { chat, files } = data;
  const [type, setType] = useState<string>("all");
  const [cat, setCat] = useState<string>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const cats = [...new Set(files.map((f) => f.category))];
  const shown = files.filter(
    (f) =>
      (type === "all" || (type === "doc" ? ["doc", "slides"].includes(fileKind(f.name, f.mime)) : fileKind(f.name, f.mime) === type)) &&
      (cat === "all" || f.category === cat),
  );
  const toggle = (id: string) => setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const send = async () => {
    setBusy(true);
    let first = true;
    for (const id of picked) {
      const ok = await runAction(sendCrmFileAction(chat.id, id, first ? caption.trim() : ""));
      if (!ok.ok) break;
      first = false;
    }
    setBusy(false);
    setPicked([]);
    setCaption("");
  };
  const pill = (on: boolean) =>
    cn("h-6 shrink-0 rounded-full border px-2 text-[11px] transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted");

  return (
    <section>
      <div className="mb-2 flex items-center px-1">
        <h3 className="flex-1 text-xs font-medium text-muted-foreground">文件（客户资料里存好的单据、证书、图片）</h3>
        {chat.customer && (
          <Link href={`/customers/${chat.customer.id}`} className="text-xs text-primary hover:underline">
            管理
          </Link>
        )}
      </div>
      {!chat.customer ? (
        <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">关联客户后，这里会列出客户资料里的文件。</p>
      ) : !files.length ? (
        <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">这个客户还没有文件。到客户详情的「文件」里上传，或把聊天里收到的文件存进去。</p>
      ) : (
        <>
          <div className="mb-1.5 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
            <button type="button" className={pill(type === "all")} onClick={() => setType("all")}>
              全部类型
            </button>
            {FILE_TYPE_FILTERS.map((t) => (
              <button key={t.value} type="button" className={pill(type === t.value)} onClick={() => setType(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
          {cats.length > 1 && (
            <div className="mb-2 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
              <button type="button" className={pill(cat === "all")} onClick={() => setCat("all")}>
                全部单据
              </button>
              {cats.map((c) => (
                <button key={c} type="button" className={pill(cat === c)} onClick={() => setCat(c)}>
                  {fileCategoryLabel(c)}
                </button>
              ))}
            </div>
          )}
          {shown.length ? (
            <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pt-0.5 pb-2 [scrollbar-width:thin]">
              {shown.map((f) => {
                const on = picked.includes(f.id);
                const src = `/api/crm-files/${f.id}`;
                return (
                  <li key={f.id} className="w-[6.5rem] shrink-0 snap-start">
                    <button
                      type="button"
                      onClick={() => toggle(f.id)}
                      onDoubleClick={() =>
                        openFilePreview({ src, download: `${src}?download`, name: f.name, mime: f.mime, size: f.size, fileId: f.id, customerId: chat.customer?.id })
                      }
                      aria-pressed={on}
                      title={`${f.name}\n${fileCategoryLabel(f.category)} · ${fileSizeText(f.size)}\n单击选中，双击预览`}
                      className="group block w-full text-left"
                    >
                      <span className={cn("relative block rounded-lg ring-1 ring-border/70 transition", on ? "ring-2 ring-primary" : "group-hover:ring-primary/40")}>
                        <FileThumb src={src} name={f.name} mime={f.mime} className="aspect-[3/4] w-full rounded-lg" />
                        {on && (
                          <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground shadow">
                            {picked.indexOf(f.id) + 1}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 line-clamp-2 text-[11px] leading-tight break-all">{f.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{fileCategoryLabel(f.category)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-3 text-center text-xs text-muted-foreground">没有符合筛选的文件</p>
          )}
          {picked.length > 0 ? (
            <div className="flex items-center gap-2 px-1">
              <Input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="附言（随第一个文件发出，可不填）"
                className="h-7 flex-1 text-xs"
              />
              <Button size="xs" className="h-7 shrink-0 text-xs" disabled={busy} onClick={() => void send()}>
                {busy ? <LoaderCircle className="animate-spin" /> : <Send />} 发送 {picked.length} 个
              </Button>
            </div>
          ) : (
            <p className="px-1 text-[11px] text-muted-foreground">单击选中（可多选），双击预览</p>
          )}
        </>
      )}
    </section>
  );
}

function ProductDetailDialog({
  detail,
  onClose,
  onSend,
  busy,
}: {
  detail: ProductDetail | "loading" | null;
  onClose: () => void;
  onSend: (id: string) => void;
  busy: boolean;
}) {
  const [img, setImg] = useState(0);
  const d = detail === "loading" ? null : detail;
  return (
    <Dialog
      open={!!detail}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setImg(0);
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {!d ? (
          <>
            <DialogTitle className="sr-only">商品详情</DialogTitle>
            <div className="flex h-60 items-center justify-center">
              <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{d.name}</DialogTitle>
              <DialogDescription>
                {[d.nameCn !== d.name && d.nameCn, d.sku, d.model].filter(Boolean).join(" · ")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <div className="grid aspect-square place-items-center overflow-hidden rounded-xl bg-muted">
                  {d.images[img] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口
                    <img src={d.images[img]} alt={d.name} className="size-full object-contain" />
                  ) : (
                    <Package className="size-10 text-muted-foreground" />
                  )}
                </div>
                {d.images.length > 1 && (
                  <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                    {d.images.map((u, i) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setImg(i)}
                        className={cn("size-12 shrink-0 overflow-hidden rounded-md ring-1 ring-border", i === img && "ring-2 ring-primary")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口 */}
                        <img src={u} alt="" className="size-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="min-w-0 space-y-3 text-sm">
                <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[13px]">
                  {(
                    [
                      ["价格", Number(d.price) > 0 ? `${formatMoney(d.price, d.currency)} / ${d.unit}` : null],
                      ["MOQ", d.moq ? `${d.moq} ${d.unit}` : null],
                      ["规格", d.spec],
                      ["包装", d.packing],
                      ["HS 编码", d.hsCode],
                    ] as const
                  )
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="whitespace-pre-wrap">{v}</dd>
                      </div>
                    ))}
                </dl>
                {d.bullets.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-foreground/85">
                    {d.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                {d.desc && <p className="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{d.desc}</p>}
                <Button className="w-full" disabled={busy} onClick={() => onSend(d.id)}>
                  <Send /> 发给客户
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── 资料 ──

function InfoTab({
  data,
  tz,
  onOpenImage,
  onJump,
}: {
  data: PanelData;
  tz: string;
  onOpenImage: (id: string) => void;
  onJump: (id: string) => void;
}) {
  const { chat } = data;
  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-card p-3 shadow-xs ring-1 ring-border/70">
        <dl className="space-y-2 text-sm">
          <Row icon={Phone} label="号码" value={chat.phone ? `+${chat.phone}` : "未知"} />
          <Row icon={MessageCircle} label="消息" value={`${data.msgCount} 条`} />
          <Row icon={ClipboardList} label="首次沟通" value={data.firstAt ? waListTime(new Date(data.firstAt), tz) : "—"} />
          {chat.contact?.email && <Row icon={Send} label="邮箱" value={chat.contact.email} />}
        </dl>
        {chat.phone && (
          <Button asChild size="sm" variant="outline" className="mt-3 w-full">
            <a href={`https://wa.me/${chat.phone}`} target="_blank" rel="noreferrer">
              <ExternalLink /> 在 WhatsApp 打开
            </a>
          </Button>
        )}
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
          <Star className="size-3.5" /> 星标消息
        </h3>
        {data.starred.length ? (
          <ul className="space-y-1.5">
            {data.starred.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onJump(m.id)}
                  className="w-full rounded-xl bg-card p-2.5 text-left shadow-xs ring-1 ring-border/70 hover:ring-primary/40"
                >
                  <p className="line-clamp-2 text-[13px]">{m.body || "[媒体]"}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {m.fromMe ? "我" : "客户"} · {formatDateTime(m.timestamp, tz)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">在消息上右键「加星标」，重要信息（价格、地址、交期）就能在这里快速找到。</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
          <ImageIcon className="size-3.5" /> 图片和视频
        </h3>
        {data.media.length ? (
          <div className="grid grid-cols-3 gap-1.5">
            {data.media.map((m) =>
              m.type === "image" ? (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onOpenImage(m.id)}
                  className="aspect-square overflow-hidden rounded-lg bg-muted"
                  aria-label="查看大图"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口 */}
                  <img
                    src={`/api/whatsapp/media/${m.id}`}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover transition-transform hover:scale-105"
                  />
                </button>
              ) : (
                <a
                  key={m.id}
                  href={`/api/whatsapp/media/${m.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex aspect-square items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground"
                >
                  视频
                </a>
              ),
            )}
          </div>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">暂无</p>
        )}
      </section>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-right tabular-nums">{value}</dd>
    </div>
  );
}
