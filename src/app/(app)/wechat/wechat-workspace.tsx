"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Archive,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Clock,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  MessageCircle,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Settings,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { resolveWechatSearchKey, wechatDisplayName, WX_MSG_STATUS_LABEL, WX_SYNC_MODES, WX_SYNC_STATUS_LABEL } from "@/lib/wechat";
import {
  confirmWechatMessageAction,
  createWechatChatAction,
  draftWechatReplyAction,
  importPastedWechatLogAction,
  linkWechatCustomerAction,
  searchCustomersForWechatAction,
  stageWechatMessageAction,
  updateWechatChatAction,
  updateWechatSettingsAction,
} from "./actions";

type DesktopWechatBridge = {
  getStatus: () => Promise<{
    platform: string;
    wechatInstalled: boolean;
    wechatRunning: boolean;
    dataDir: string | null;
    syncSource: "chatlog" | "none";
    chatlogUrl: string;
    lastSyncAt: string | null;
    lastError: string | null;
    autoSync: boolean;
  }>;
  stageSend: (opts: { searchKey?: string; text: string; autoLocate?: boolean }) => Promise<{
    ok: boolean;
    mode?: string;
    hint?: string;
    error?: string;
  }>;
  saveConfig: (cfg: { chatlogUrl?: string; autoSync?: boolean; dataDir?: string }) => Promise<{ ok: boolean }>;
  syncNow: () => Promise<{ ok: boolean; inserted?: number; confirmed?: number; error?: string }>;
};

declare global {
  interface Window {
    chechedesktop?: {
      version: string;
      platform: string;
      status: () => Promise<{ paired: boolean; state: string; detail: string; device: string }>;
      wechat?: DesktopWechatBridge;
    };
  }
}

type AccountInfo = {
  id: string;
  name: string | null;
  wechatNo: string | null;
  platform: string | null;
  syncMode: "whitelist" | "all";
  remarkPrefix: string;
  status: string;
  lastError: string | null;
  lastSyncAt: string | null;
  syncMessages: number;
};

type ChatItem = {
  id: string;
  wxKey: string;
  wechatNo: string | null;
  remark: string | null;
  name: string | null;
  isGroup: boolean;
  syncEnabled: boolean;
  customerId: string | null;
  customer: { id: string; name: string; country: string | null } | null;
  lastMessageAt: string | null;
  lastText: string | null;
  unread: number;
  lastFromMe: boolean;
  pinnedAt: string | null;
  archived: boolean;
};

type ChatMessage = {
  id: string;
  fromMe: boolean;
  senderName: string | null;
  type: string;
  body: string;
  translation: string | null;
  status: string;
  error: string | null;
  timestamp: string;
  stagedAt: string | null;
  confirmedAt: string | null;
};

type ActiveChat = {
  id: string;
  wxKey: string;
  wechatNo: string | null;
  remark: string | null;
  name: string | null;
  isGroup: boolean;
  syncEnabled: boolean;
  customerId: string | null;
  customer: { id: string; name: string; country: string | null } | null;
  pinnedAt: string | null;
  archived: boolean;
  messages: ChatMessage[];
};

const FILTERS = [
  { key: "", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "customer", label: "客户" },
  { key: "unlinked", label: "未关联" },
  { key: "group", label: "群聊" },
] as const;

function fmtTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

export function WechatWorkspace({
  account,
  filter,
  query,
  unreadChats,
  archivedCount,
  canAi,
  quickReplies,
  chats,
  activeChat,
}: {
  account: AccountInfo;
  filter: string;
  query: string;
  unreadChats: number;
  archivedCount: number;
  canAi: boolean;
  quickReplies: { id: string; title: string; body: string }[];
  chats: ChatItem[];
  activeChat: ActiveChat | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(query);
  const [draft, setDraft] = useState("");
  const [autoLocate, setAutoLocate] = useState(true);
  const [staging, setStaging] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // 桌面端本地桥接状态
  const [desktopBridge, setDesktopBridge] = useState<DesktopWechatBridge | null>(null);
  const [desktopPlatform, setDesktopPlatform] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<Awaited<ReturnType<DesktopWechatBridge["getStatus"]>> | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);

  // 弹窗状态
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newWechatNo, setNewWechatNo] = useState("");
  const [newRemark, setNewRemark] = useState("");
  const [newName, setNewName] = useState("");
  const [newIsGroup, setNewIsGroup] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteDefaultFromMe, setPasteDefaultFromMe] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncMode, setSyncMode] = useState<"whitelist" | "all">(account.syncMode);
  const [remarkPrefix, setRemarkPrefix] = useState(account.remarkPrefix);
  const [myWxName, setMyWxName] = useState(account.name || "");
  const [myWxNo, setMyWxNo] = useState(account.wechatNo || "");
  const [chatlogUrl, setChatlogUrl] = useState("http://127.0.0.1:5030");
  const [localAutoSync, setLocalAutoSync] = useState(true);

  const [editPeerOpen, setEditPeerOpen] = useState(false);
  const [editWechatNo, setEditWechatNo] = useState("");
  const [editRemark, setEditRemark] = useState("");
  const [editName, setEditName] = useState("");

  const [linkOpen, setLinkOpen] = useState(false);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<{ id: string; name: string; country: string | null }[]>([]);

  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.chechedesktop?.wechat : undefined;
    if (bridge) {
      setDesktopBridge(bridge);
      setDesktopPlatform(window.chechedesktop?.platform || null);
      bridge
        .getStatus()
        .then((s) => {
          setBridgeStatus(s);
          if (s.chatlogUrl) setChatlogUrl(s.chatlogUrl);
          setLocalAutoSync(s.autoSync);
        })
        .catch(() => null);
    }
  }, []);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.id, activeChat?.messages.length]);

  const buildHref = (p: { chat?: string | null; f?: string; q?: string }) => {
    const u = new URLSearchParams();
    const qq = p.q !== undefined ? p.q : query;
    const ff = p.f !== undefined ? p.f : filter;
    if (qq) u.set("q", qq);
    if (ff) u.set("f", ff);
    if (p.chat) u.set("chat", p.chat);
    return `/wechat${u.size ? `?${u}` : ""}`;
  };

  const handleStageSend = async (textOverride?: string, existingMsgId?: string) => {
    if (!activeChat) return;
    const text = (textOverride ?? draft).trim();
    if (!text) return;

    const anchor = resolveWechatSearchKey(activeChat);
    setStaging(true);
    try {
      let messageId = existingMsgId;
      let searchKey = anchor.key;

      if (!messageId) {
        const res = await stageWechatMessageAction({
          chatId: activeChat.id,
          body: text,
          searchKeyOverride: anchor.key,
        });
        if ("error" in res && res.error) {
          toast.error(res.error);
          return;
        }
        if ("messageId" in res) {
          messageId = res.messageId;
          searchKey = res.searchKey || anchor.key;
        }
        setDraft("");
      }

      if (desktopBridge) {
        const sendRes = await desktopBridge.stageSend({
          searchKey: autoLocate ? searchKey : undefined,
          text,
          autoLocate: autoLocate && !!searchKey,
        });
        if (sendRes.ok) {
          toast.success(sendRes.hint || "已上屏到微信输入框，请核对对方头像后按 Enter 发送");
        } else {
          if (messageId) await confirmWechatMessageAction(messageId, "FAILED", sendRes.error);
          toast.error(sendRes.error || "唤起微信失败，已为您复制文本，请手动粘贴");
          await navigator.clipboard?.writeText(text).catch(() => null);
        }
      } else {
        await navigator.clipboard?.writeText(text).catch(() => null);
        toast.success("已记录待发并复制到剪贴板，请切到微信粘贴发送（使用车车桌面版可一键自动定位上屏）");
      }
      router.refresh();
    } finally {
      setStaging(false);
    }
  };

  const handleSyncNow = async () => {
    if (!desktopBridge) {
      toast.info("请先打开车车 CRM Windows/Mac 桌面版，即可进行本地只读增量同步");
      return;
    }
    setSyncingNow(true);
    try {
      const res = await desktopBridge.syncNow();
      if (res.ok) {
        toast.success(`同步完成：新增 ${res.inserted ?? 0} 条，自动确认发出 ${res.confirmed ?? 0} 条`);
        const s = await desktopBridge.getStatus().catch(() => null);
        if (s) setBridgeStatus(s);
        router.refresh();
      } else {
        toast.error(res.error || "本地同步未就绪，请检查微信本地同步设置");
      }
    } finally {
      setSyncingNow(false);
    }
  };

  const handleAiDraft = async () => {
    if (!activeChat) return;
    setAiLoading(true);
    try {
      const res = await draftWechatReplyAction(activeChat.id, draft);
      if ("error" in res && res.error) {
        toast.error(res.error);
      } else if ("text" in res && res.text) {
        setDraft(res.text);
        toast.success("已生成回复草稿，可修改后一键上屏");
      }
    } finally {
      setAiLoading(false);
    }
  };

  const handleCreateChat = () => {
    startTransition(async () => {
      const res = await createWechatChatAction({
        wechatNo: newWechatNo,
        remark: newRemark,
        name: newName,
        isGroup: newIsGroup,
      });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      setNewChatOpen(false);
      setNewWechatNo("");
      setNewRemark("");
      setNewName("");
      setNewIsGroup(false);
      toast.success("已添加微信会话");
      if ("chatId" in res && res.chatId) {
        router.push(buildHref({ chat: res.chatId }));
      }
      router.refresh();
    });
  };

  const handleImportPaste = () => {
    if (!activeChat || !pasteText.trim()) return;
    startTransition(async () => {
      const res = await importPastedWechatLogAction({
        chatId: activeChat.id,
        rawText: pasteText,
        defaultFromMe: pasteDefaultFromMe,
      });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      setImportOpen(false);
      setPasteText("");
      toast.success(`已归档 ${"inserted" in res ? res.inserted : 0} 条聊天记录`);
      router.refresh();
    });
  };

  const handleSaveSettings = () => {
    startTransition(async () => {
      const res = await updateWechatSettingsAction({
        syncMode,
        remarkPrefix,
        name: myWxName,
        wechatNo: myWxNo,
      });
      if (desktopBridge) {
        await desktopBridge.saveConfig({ chatlogUrl: chatlogUrl.trim(), autoSync: localAutoSync }).catch(() => null);
        const s = await desktopBridge.getStatus().catch(() => null);
        if (s) setBridgeStatus(s);
      }
      if ("ok" in res) {
        setSettingsOpen(false);
        toast.success("微信同步设置已保存");
        router.refresh();
      }
    });
  };

  const openLinkDialog = async () => {
    setLinkOpen(true);
    const rows = await searchCustomersForWechatAction("");
    setCustResults(rows);
  };

  const anchor = activeChat ? resolveWechatSearchKey(activeChat) : null;
  const isWin = desktopPlatform === "win32";
  const isMac = desktopPlatform === "darwin";

  return (
    <div
      className={cn(
        "-mx-3 -mt-3 -mb-4 flex h-[calc(100svh-6.75rem-1px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[26rem] overflow-hidden surface rounded-none shadow-none md:m-0 md:h-[calc(100svh-6.5rem)] md:min-h-[34rem] md:rounded-2xl md:shadow-[var(--card-shadow)]",
      )}
    >
      {/* ── 左侧：微信会话列表 ── */}
      <section className={cn("flex w-full min-w-0 flex-col border-r border-border/70 md:w-[22.5rem] md:shrink-0", activeChat && "hidden md:flex")}>
        <header className="flex items-center gap-3 px-4 pt-4 pb-2.5">
          <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <MessageCircle className="size-5" />
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-card",
                desktopBridge
                  ? bridgeStatus?.wechatRunning
                    ? "bg-emerald-500"
                    : "bg-amber-400"
                  : account.status === "READY" || account.status === "SYNCING"
                    ? "bg-emerald-500"
                    : "bg-slate-300",
              )}
              aria-hidden
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-medium">{account.name || "个人微信助手"}</p>
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                零封号
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {desktopBridge
                ? bridgeStatus?.wechatRunning
                  ? `${isWin ? "Win" : isMac ? "Mac" : "桌面"}端就绪 · ${bridgeStatus.syncSource === "chatlog" ? "只读同步已连" : "半自动上屏"}`
                  : `${isWin ? "Win" : isMac ? "Mac" : "桌面"}端在线 · 等待打开本地微信`
                : WX_SYNC_STATUS_LABEL[account.status] || "网页模式（建议用桌面版）"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              title="立即增量同步"
              disabled={syncingNow}
              onClick={handleSyncNow}
            >
              {syncingNow ? <LoaderCircle className="size-4" /> : <RefreshCcw className="size-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              title="添加微信客户会话"
              onClick={() => setNewChatOpen(true)}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              title="微信同步与隐私设置"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="size-4" />
            </Button>
          </div>
        </header>

        {/* 非桌面端提示条：引导下载 Windows 桌面版 */}
        {!desktopBridge && (
          <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs">
            <span className="text-muted-foreground">用桌面版可一键上屏到微信并自动只读同步</span>
            <Link
              href="/api/desktop/download?arch=win"
              className="inline-flex shrink-0 items-center gap-1 font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              <Download className="size-3.5" />
              Win版
            </Link>
          </div>
        )}

        {/* 搜索框 */}
        <form
          className="px-3 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(buildHref({ q: searchInput.trim(), chat: activeChat?.id ?? null }));
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜备注、微信号、客户名…"
              className="h-8 rounded-lg pl-8 text-xs"
            />
          </div>
        </form>

        {/* 筛选 Tab */}
        <div className="flex items-center gap-1 overflow-x-auto px-3 pb-2">
          {FILTERS.map((item) => (
            <Link
              key={item.key || "all"}
              href={buildHref({ f: item.key, chat: null })}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors",
                filter === item.key
                  ? "bg-emerald-600 text-white"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {item.label}
              {item.key === "unread" && unreadChats > 0 ? ` ${unreadChats}` : ""}
            </Link>
          ))}
          {archivedCount > 0 && (
            <Link
              href={buildHref({ f: filter === "archived" ? "" : "archived", chat: null })}
              className={cn(
                "ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors",
                filter === "archived" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Archive className="size-3" />
              {archivedCount}
            </Link>
          )}
        </div>

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm font-medium text-foreground/80">还没有微信会话</p>
              <p className="mt-1 text-xs text-muted-foreground">
                点右上角「+」添加客户微信号，或在桌面端开启白名单只读同步。
              </p>
              <Button size="sm" variant="outline" className="mt-4" onClick={() => setNewChatOpen(true)}>
                <Plus className="mr-1.5 size-3.5" />
                添加第一个微信客户
              </Button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {chats.map((c) => {
                const selected = activeChat?.id === c.id;
                const title = wechatDisplayName(c);
                return (
                  <Link
                    key={c.id}
                    href={buildHref({ chat: c.id })}
                    className={cn(
                      "flex items-start gap-2.5 rounded-xl px-2.5 py-2.5 transition-colors",
                      selected ? "bg-emerald-500/10 text-foreground" : "hover:bg-muted/60",
                    )}
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-600/15 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      {c.isGroup ? "群" : title.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{title}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{fmtTime(c.lastMessageAt)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-muted-foreground">
                          {c.lastFromMe ? "我: " : ""}
                          {c.lastText || (c.wechatNo ? `微信号: ${c.wechatNo}` : "点击开始半自动沟通")}
                        </p>
                        {c.unread > 0 && (
                          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-medium text-white">
                            {c.unread > 99 ? "99+" : c.unread}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {c.customer && (
                          <span className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">
                            <Building2 className="size-2.5" />
                            {c.customer.name}
                          </span>
                        )}
                        {c.wechatNo && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {c.wechatNo}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── 右侧：聊天记录与半自动一键上屏工作区 ── */}
      <section className={cn("flex min-w-0 flex-1 flex-col", !activeChat && "hidden md:flex")}>
        {!activeChat ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
              <MessageCircle className="size-7" />
            </div>
            <h2 className="mt-4 font-brand text-lg font-medium">个人微信安全工作台</h2>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
              采用「本地只读同步 + 半自动一键上屏」模式：不注入微信内存、不碰网络协议，杜绝封号与发错客户。
              选择一个会话即可查看记录、AI 撰写回复并一键上屏到微信输入框。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => setNewChatOpen(true)}>
                <Plus className="mr-1.5 size-3.5" />
                添加微信客户
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
                <Settings className="mr-1.5 size-3.5" />
                配置本地同步
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* 会话顶栏 */}
            <header className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Link href={buildHref({ chat: null })} className="rounded-lg p-1 hover:bg-muted md:hidden">
                  <ChevronLeft className="size-5" />
                </Link>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-medium">{wechatDisplayName(activeChat)}</h2>
                    {activeChat.isGroup && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">群聊</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditWechatNo(activeChat.wechatNo || "");
                        setEditRemark(activeChat.remark || "");
                        setEditName(activeChat.name || "");
                        setEditPeerOpen(true);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      编辑搜索锚点
                    </button>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      定位词：
                      <strong className="font-normal text-foreground">{anchor?.key || "未设置"}</strong>
                      {anchor?.label ? `（${anchor.label}）` : ""}
                    </span>
                    {activeChat.customer ? (
                      <Link
                        href={`/customers/${activeChat.customer.id}`}
                        className="inline-flex items-center gap-1 text-sky-600 hover:underline dark:text-sky-400"
                      >
                        <Building2 className="size-3" />
                        {activeChat.customer.name}
                      </Link>
                    ) : (
                      <button type="button" onClick={openLinkDialog} className="text-emerald-700 hover:underline dark:text-emerald-400">
                        + 关联 CRM 客户
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setImportOpen(true)}>
                  <FileText className="mr-1.5 size-3.5" />
                  粘贴导入记录
                </Button>
                {activeChat.customer && (
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={openLinkDialog}>
                    更换客户
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => {
                    startTransition(async () => {
                      await updateWechatChatAction(activeChat.id, { archived: !activeChat.archived });
                      toast.success(activeChat.archived ? "已移出归档" : "已归档该会话");
                      router.refresh();
                    });
                  }}
                >
                  <Archive className="mr-1 size-3.5" />
                  {activeChat.archived ? "取消归档" : "归档"}
                </Button>
              </div>
            </header>

            {/* 消息列表 */}
            <div className="flex-1 space-y-3 overflow-y-auto bg-muted/20 px-4 py-4">
              {activeChat.messages.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  暂无同步记录。你可以直接点右上角「粘贴导入记录」，或在下方写好回复一键上屏到微信。
                </div>
              ) : (
                activeChat.messages.map((m) => (
                  <div key={m.id} className={cn("flex flex-col", m.fromMe ? "items-end" : "items-start")}>
                    {!m.fromMe && m.senderName && (
                      <span className="mb-1 px-1 text-[11px] text-muted-foreground">{m.senderName}</span>
                    )}
                    <div
                      className={cn(
                        "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm shadow-xs",
                        m.fromMe
                          ? m.status === "STAGED"
                            ? "border border-amber-400/50 bg-amber-50 text-foreground dark:bg-amber-950/40"
                            : m.status === "UNCONFIRMED" || m.status === "FAILED"
                              ? "border border-destructive/40 bg-destructive/10 text-foreground"
                              : "bg-emerald-600 text-white"
                          : "border border-border/60 bg-card text-foreground",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      {m.translation && (
                        <p className="mt-2 border-t border-border/50 pt-1.5 text-xs text-muted-foreground">
                          译文：{m.translation}
                        </p>
                      )}
                    </div>

                    {/* 消息时间 + 状态回执操作 */}
                    <div className="mt-1 flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
                      <span>{fmtTime(m.timestamp)}</span>
                      {m.fromMe && (
                        <>
                          {m.status === "SENT" && (
                            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="size-3" />
                              已发出
                            </span>
                          )}
                          {(m.status === "STAGED" || m.status === "UNCONFIRMED" || m.status === "FAILED") && (
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-0.5",
                                  m.status === "STAGED" ? "text-amber-600 dark:text-amber-400" : "text-destructive",
                                )}
                              >
                                {m.status === "STAGED" ? <Clock className="size-3" /> : <CircleAlert className="size-3" />}
                                {WX_MSG_STATUS_LABEL[m.status] || m.status}
                              </span>
                              <button
                                type="button"
                                className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                                onClick={() => {
                                  startTransition(async () => {
                                    await confirmWechatMessageAction(m.id, "SENT");
                                    toast.success("已标记为已发出");
                                    router.refresh();
                                  });
                                }}
                              >
                                我已发出
                              </button>
                              <button
                                type="button"
                                className="font-medium text-foreground/80 hover:underline"
                                onClick={() => handleStageSend(m.body, m.id)}
                              >
                                重新上屏
                              </button>
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={msgEndRef} />
            </div>

            {/* 底部：半自动一键上屏发送栏 */}
            <div className="border-t border-border/70 bg-card p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={autoLocate}
                      onChange={(e) => setAutoLocate(e.target.checked)}
                      className="size-3.5 rounded accent-emerald-600"
                    />
                    自动在微信搜索定位
                    {anchor?.key ? <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">{anchor.key}</span> : null}
                  </label>
                  {quickReplies.length > 0 && (
                    <select
                      className="h-7 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground"
                      defaultValue=""
                      onChange={(e) => {
                        const hit = quickReplies.find((r) => r.id === e.target.value);
                        if (hit) setDraft((prev) => (prev ? `${prev}\n${hit.body}` : hit.body));
                        e.target.value = "";
                      }}
                    >
                      <option value="">插入快捷话术…</option>
                      {quickReplies.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {canAi && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={aiLoading}
                    onClick={handleAiDraft}
                  >
                    {aiLoading ? <LoaderCircle className="mr-1 size-3.5" /> : <Bot className="mr-1 size-3.5" />}
                    AI 帮我写回复
                  </Button>
                )}
              </div>

              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void handleStageSend();
                  }
                }}
                placeholder="输入要发给客户的微信内容（Ctrl/Cmd + Enter 一键上屏到微信，由你核对头像后按回车发送）…"
                rows={3}
                className="resize-none text-sm"
              />

              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  安全机制：绝不自动按最终回车键，防止串人误发与触发风控。
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!draft.trim()}
                    onClick={async () => {
                      await navigator.clipboard?.writeText(draft.trim()).catch(() => null);
                      toast.success("已复制到剪贴板");
                    }}
                  >
                    <Copy className="mr-1.5 size-3.5" />
                    仅复制
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={!draft.trim() || staging || pending}
                    onClick={() => handleStageSend()}
                  >
                    {staging ? <LoaderCircle className="mr-1.5 size-3.5" /> : <Send className="mr-1.5 size-3.5" />}
                    一键上屏到微信
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── 弹窗 1：新建微信客户会话 ── */}
      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加微信客户会话</DialogTitle>
            <DialogDescription>建议优先填写对方「微信号」或「微信精确备注名」，一键上屏时可精准定位防重名。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium">微信号（推荐，唯一精准搜索锚点）</label>
              <Input value={newWechatNo} onChange={(e) => setNewWechatNo(e.target.value)} placeholder="如：wxid_xxx 或 alex_auto2026" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium">微信备注名</label>
              <Input value={newRemark} onChange={(e) => setNewRemark(e.target.value)} placeholder="如：客户-迪拜Alex" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium">微信昵称 / 群名</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="对方微信昵称或群名称" className="mt-1" />
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={newIsGroup} onChange={(e) => setNewIsGroup(e.target.checked)} className="size-3.5" />
              这是一个微信客户群
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewChatOpen(false)}>取消</Button>
            <Button disabled={pending} onClick={handleCreateChat}>确认添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 弹窗 2：粘贴导入聊天记录 ── */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>粘贴导入微信聊天记录</DialogTitle>
            <DialogDescription>
              在 PC/Mac 微信里多选或复制聊天内容粘贴到下方，系统会自动拆分发言人、时间和内容并自动翻译外文。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              placeholder={"示例：\nAlex 2026-11-27 10:20:30\nHi, please send FOB price for BYD Song Plus.\n\n我 2026-11-27 10:22:10\nSure, sending you the latest quotation now."}
            />
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={pasteDefaultFromMe}
                onChange={(e) => setPasteDefaultFromMe(e.target.checked)}
                className="size-3.5"
              />
              若粘贴的是无头行纯文本，默认记为「我方发出」
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
            <Button disabled={pending || !pasteText.trim()} onClick={handleImportPaste}>解析并归档</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 弹窗 3：微信本地同步与隐私设置 ── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>个人微信同步与隐私设置</DialogTitle>
            <DialogDescription>
              零封号架构：桌面端仅本地只读同步白名单客户会话，私人聊天绝不上传；发送采用半自动一键上屏。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">我的微信昵称（导入时识别“我”）</label>
                <Input value={myWxName} onChange={(e) => setMyWxName(e.target.value)} placeholder="如：王经理" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium">我的微信号（仅展示）</label>
                <Input value={myWxNo} onChange={(e) => setMyWxNo(e.target.value)} placeholder="选填" className="mt-1" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">同步隐私范围</label>
              {WX_SYNC_MODES.map((m) => (
                <label
                  key={m.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors",
                    syncMode === m.value ? "border-emerald-600 bg-emerald-500/5" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name="wx-sync-mode"
                    checked={syncMode === m.value}
                    onChange={() => setSyncMode(m.value)}
                    className="mt-0.5 accent-emerald-600"
                  />
                  <div>
                    <p className="text-xs font-medium">{m.label}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{m.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            {syncMode === "whitelist" && (
              <div>
                <label className="text-xs font-medium">白名单自动同步备注前缀</label>
                <Input value={remarkPrefix} onChange={(e) => setRemarkPrefix(e.target.value)} placeholder="客户-" className="mt-1" />
                <p className="mt-1 text-[11px] text-muted-foreground">微信里备注以该前缀开头的联系人会自动同步到 CRM。</p>
              </div>
            )}

            <div className="rounded-xl border border-border/80 bg-muted/30 p-3">
              <p className="text-xs font-medium">本机只读数据源（Win / Mac 微信 4.0 兼容）</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                桌面端支持直连本机 <code>chatlog</code> HTTP 只读服务（默认 <code>http://127.0.0.1:5030</code>）自动拉取解密后的白名单增量消息并回执发送状态。未开启时仍可完整使用半自动一键上屏与粘贴归档。
              </p>
              {desktopBridge ? (
                <div className="mt-2.5 space-y-2">
                  <Input
                    value={chatlogUrl}
                    onChange={(e) => setChatlogUrl(e.target.value)}
                    placeholder="http://127.0.0.1:5030"
                    className="h-8 text-xs"
                  />
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={localAutoSync}
                      onChange={(e) => setLocalAutoSync(e.target.checked)}
                      className="size-3.5 accent-emerald-600"
                    />
                    在桌面端后台每 20 秒自动增量拉取一次白名单新消息
                  </label>
                  {bridgeStatus?.dataDir && (
                    <p className="truncate text-[11px] text-muted-foreground">检测到本机微信目录：{bridgeStatus.dataDir}</p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                  当前在浏览器中访问。请打开车车 CRM 桌面版（Windows / Mac）以启用本机桥接。
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>取消</Button>
            <Button disabled={pending} onClick={handleSaveSettings}>保存设置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 弹窗 4：编辑联系人搜索锚点 ── */}
      <Dialog open={editPeerOpen} onOpenChange={setEditPeerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑微信定位信息</DialogTitle>
            <DialogDescription>填写对方的微信号或精确备注名，可防止一键上屏搜索时重名串人。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium">微信号（最高优先级）</label>
              <Input value={editWechatNo} onChange={(e) => setEditWechatNo(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium">微信备注名</label>
              <Input value={editRemark} onChange={(e) => setEditRemark(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium">昵称 / 群名</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPeerOpen(false)}>取消</Button>
            <Button
              disabled={pending || !activeChat}
              onClick={() => {
                if (!activeChat) return;
                startTransition(async () => {
                  await updateWechatChatAction(activeChat.id, {
                    wechatNo: editWechatNo,
                    remark: editRemark,
                    name: editName,
                  });
                  setEditPeerOpen(false);
                  toast.success("已更新定位信息");
                  router.refresh();
                });
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 弹窗 5：关联 CRM 客户 ── */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>关联 CRM 客户</DialogTitle>
            <DialogDescription>关联后，该微信会话的沟通记录将归属到客户档案下，且自动纳入白名单同步。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              value={custQuery}
              onChange={async (e) => {
                const v = e.target.value;
                setCustQuery(v);
                const rows = await searchCustomersForWechatAction(v);
                setCustResults(rows);
              }}
              placeholder="输入客户名称或联系人搜索…"
            />
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {custResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    if (!activeChat) return;
                    startTransition(async () => {
                      await linkWechatCustomerAction(activeChat.id, c.id);
                      setLinkOpen(false);
                      toast.success(`已关联客户：${c.name}`);
                      router.refresh();
                    });
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {c.country || ""}
                    {activeChat?.customerId === c.id && <Check className="size-3.5 text-emerald-600" />}
                  </span>
                </button>
              ))}
              {custResults.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">未找到匹配的客户</p>}
            </div>
          </div>
          <DialogFooter>
            {activeChat?.customerId && (
              <Button
                variant="ghost"
                className="mr-auto text-destructive"
                onClick={() => {
                  if (!activeChat) return;
                  startTransition(async () => {
                    await linkWechatCustomerAction(activeChat.id, null);
                    setLinkOpen(false);
                    toast.success("已解除客户关联");
                    router.refresh();
                  });
                }}
              >
                解除关联
              </Button>
            )}
            <Button variant="outline" onClick={() => setLinkOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
