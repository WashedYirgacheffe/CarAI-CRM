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
import { parsePastedWechatLog, resolveWechatSearchKey, wechatDisplayName, WX_MSG_STATUS_LABEL, WX_SYNC_MODES, WX_SYNC_STATUS_LABEL, type ParsedWechatLine } from "@/lib/wechat";
import {
  clearWechatMessagesAction,
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
    wxVersion?: number | null;
    wxVersionString?: string | null;
    wxid?: string | null;
    dataDir: string | null;
    dbRoot?: string | null;
    decryptedDir?: string;
    hasDbKey?: boolean;
    keyCount?: number;
    syncSource: "native-db" | "chatlog" | "none";
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
  saveConfig: (cfg: { dbKey?: string; decryptedDir?: string; chatlogUrl?: string; autoSync?: boolean; dataDir?: string }) => Promise<{ ok: boolean; error?: string }>;
  extractKey?: () => Promise<{ ok: boolean; method?: string; wxVersionString?: string | null; matchedCount?: number; totalCount?: number; inserted?: number; error?: string; code?: string }>;
  syncNow: () => Promise<{ ok: boolean; threads?: number; inserted?: number; confirmed?: number; error?: string }>;
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

  // 桌面端本地桥接状态（精确区分：新版桌面端≥0.2.6 / 旧版桌面端需升级 / 普通浏览器）
  const [desktopApp, setDesktopApp] = useState<{ version: string; platform: string } | null>(null);
  const [desktopBridge, setDesktopBridge] = useState<DesktopWechatBridge | null>(null);
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
  const [pastePreview, setPastePreview] = useState<ParsedWechatLine[]>([]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncMode, setSyncMode] = useState<"whitelist" | "all">(account.syncMode);
  const [remarkPrefix, setRemarkPrefix] = useState(account.remarkPrefix);
  const [myWxName, setMyWxName] = useState(account.name || "");
  const [myWxNo, setMyWxNo] = useState(account.wechatNo || "");
  const [dbKeyInput, setDbKeyInput] = useState("");
  const [decryptedDir, setDecryptedDir] = useState("");
  const [chatlogUrl, setChatlogUrl] = useState("http://127.0.0.1:5030");
  const [localAutoSync, setLocalAutoSync] = useState(true);
  const [extractingKey, setExtractingKey] = useState(false);
  const [extractHint, setExtractHint] = useState<string | null>(null);

  const [editPeerOpen, setEditPeerOpen] = useState(false);
  const [editWechatNo, setEditWechatNo] = useState("");
  const [editRemark, setEditRemark] = useState("");
  const [editName, setEditName] = useState("");

  const [linkOpen, setLinkOpen] = useState(false);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<{ id: string; name: string; country: string | null }[]>([]);

  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const desk = window.chechedesktop;
    const uaMatch = /CheCheCRMDesktop\/([^\s]+)/.exec(navigator.userAgent);
    if (desk || uaMatch) {
      const inferredPlatform =
        desk?.platform || (navigator.userAgent.includes("Windows") ? "win32" : navigator.userAgent.includes("Mac") ? "darwin" : "desktop");
      setDesktopApp({
        version: desk?.version || uaMatch?.[1] || "",
        platform: inferredPlatform,
      });
    }
    const bridge = desk?.wechat;
    if (bridge) {
      setDesktopBridge(bridge);
      bridge
        .getStatus()
        .then((s) => {
          setBridgeStatus(s);
          if (s.chatlogUrl) setChatlogUrl(s.chatlogUrl);
          if (s.decryptedDir) setDecryptedDir(s.decryptedDir);
          setLocalAutoSync(s.autoSync);
        })
        .catch(() => null);
    }
  }, []);

  useEffect(() => {
    if (!pasteText.trim()) {
      setPastePreview([]);
      return;
    }
    setPastePreview(
      parsePastedWechatLog(pasteText, {
        myName: account.name,
        peerName: activeChat?.remark || activeChat?.name || null,
        defaultFromMe: pasteDefaultFromMe,
      }),
    );
  }, [pasteText, pasteDefaultFromMe, account.name, activeChat?.remark, activeChat?.name]);

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
        toast.success(`同步完成：${res.threads ?? 0} 个会话，新增 ${res.inserted ?? 0} 条，自动确认发出 ${res.confirmed ?? 0} 条`);
        const s = await desktopBridge.getStatus().catch(() => null);
        if (s) setBridgeStatus(s);
        router.refresh();
      } else {
        toast.error(res.error || "本地同步未就绪，请先在设置里配置微信密钥");
      }
    } finally {
      setSyncingNow(false);
    }
  };

  const handleExtractKey = async () => {
    if (!desktopBridge?.extractKey) {
      toast.info("请升级到车车桌面版 v0.2.9+ 以使用一键提取本机微信密钥功能");
      return;
    }
    setExtractingKey(true);
    setExtractHint(null);
    try {
      const res = await desktopBridge.extractKey();
      const s = await desktopBridge.getStatus().catch(() => null);
      if (s) setBridgeStatus(s);
      if (res.ok) {
        const msg = `成功通过纯只读引擎（${res.method || "codec-ctx"}）提取 ${res.matchedCount ?? 1}/${res.totalCount ?? res.matchedCount ?? 1} 个微信数据库密钥，已自动同步 ${res.inserted ?? 0} 条历史记录！`;
        setExtractHint(msg);
        toast.success(msg);
        router.refresh();
      } else {
        setExtractHint(res.error || "自动扫描未命中");
        toast.error(res.error || "自动扫描未命中，可手动填入 64 位密钥或已解密目录");
      }
    } finally {
      setExtractingKey(false);
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
    if (!activeChat || !pastePreview.length) return;
    startTransition(async () => {
      const res = await importPastedWechatLogAction({
        chatId: activeChat.id,
        items: pastePreview,
      });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      setImportOpen(false);
      setPasteText("");
      setPastePreview([]);
      toast.success(`已归档 ${"inserted" in res ? res.inserted : 0} 条聊天记录`);
      router.refresh();
    });
  };

  const handleSaveSettings = () => {
    startTransition(async () => {
      if (desktopBridge) {
        const localRes = await desktopBridge
          .saveConfig({
            ...(dbKeyInput.trim() ? { dbKey: dbKeyInput.trim() } : {}),
            decryptedDir: decryptedDir.trim(),
            chatlogUrl: chatlogUrl.trim(),
            autoSync: localAutoSync,
          })
          .catch(() => ({ ok: false, error: "保存本机配置失败" }));
        if (!localRes.ok) {
          toast.error(localRes.error || "本机密钥校验失败");
          return;
        }
        setDbKeyInput("");
        const s = await desktopBridge.getStatus().catch(() => null);
        if (s) setBridgeStatus(s);
      }
      const res = await updateWechatSettingsAction({
        syncMode,
        remarkPrefix,
        name: myWxName,
        wechatNo: myWxNo,
      });
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
  const desktopPlatform = desktopApp?.platform ?? null;
  const isWin = desktopPlatform === "win32";
  const isMac = desktopPlatform === "darwin";
  const isOutdatedDesktop = !!desktopApp && !desktopBridge;

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
                  ? `${isWin ? "Win" : isMac ? "Mac" : "桌面"}端就绪 · ${bridgeStatus.syncSource === "native-db" ? "内置全自动只读同步" : bridgeStatus.syncSource === "chatlog" ? "只读服务已连" : "半自动上屏"}`
                  : `${isWin ? "Win" : isMac ? "Mac" : "桌面"}端在线 · 等待打开本地微信`
                : isOutdatedDesktop
                  ? `${isWin ? "Win" : isMac ? "Mac" : "桌面"}端 v${desktopApp?.version || "旧版"} · 需升级至 v0.2.7`
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

        {/* 桌面端升级 / 下载提示条 */}
        {!desktopBridge && (
          <div
            className={cn(
              "mx-3 mb-2 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs",
              isOutdatedDesktop
                ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                : "border-emerald-500/20 bg-emerald-500/5 text-muted-foreground",
            )}
          >
            <span className="leading-snug">
              {isOutdatedDesktop
                ? `当前桌面版 v${desktopApp?.version || "旧版"} 暂未含微信桥接，升级至 v0.2.6 即可启用`
                : "用桌面版可一键上屏到微信并自动只读同步"}
            </span>
            <Link
              href={`/api/desktop/download?arch=${isMac ? "arm64" : "win"}`}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 font-medium hover:underline",
                isOutdatedDesktop ? "text-amber-700 dark:text-amber-200" : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              <Download className="size-3.5" />
              {isOutdatedDesktop ? "下载新版" : "Win版"}
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
                    {anchor?.ignoredRawWxid && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                        已跳过无法搜索的原始 wxid_
                      </span>
                    )}
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
                {activeChat.messages.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (!window.confirm("确定清空当前会话在 CRM 里的聊天记录吗？（不会影响你本地微信）")) return;
                      startTransition(async () => {
                        await clearWechatMessagesAction(activeChat.id);
                        toast.success("已清空当前会话记录");
                        router.refresh();
                      });
                    }}
                  >
                    清空记录
                  </Button>
                )}
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

              {/* 右侧留出 md:pr-16 避开右下角全局 AI 悬浮球 */}
              <div className="mt-2 flex items-center justify-between gap-2 md:pr-16">
                <p className="text-[11px] text-muted-foreground">
                  安全机制：自动点击右侧输入框防粘贴进搜索框，且绝不自动按最终回车键。
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加微信客户会话</DialogTitle>
            <DialogDescription>建议优先填写对方「微信号」或「微信精确备注名」，一键上屏时可精准定位防重名。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 py-1">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">微信号（推荐，唯一精准定位）</label>
              <Input value={newWechatNo} onChange={(e) => setNewWechatNo(e.target.value)} placeholder="如：wxid_xxx 或 alex_auto2026" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">微信备注名</label>
              <Input value={newRemark} onChange={(e) => setNewRemark(e.target.value)} placeholder="如：客户-迪拜Alex" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">微信昵称 / 群名</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="对方微信昵称或群名称" />
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={newIsGroup} onChange={(e) => setNewIsGroup(e.target.checked)} className="size-3.5 accent-emerald-600" />
              这是一个微信客户群
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewChatOpen(false)}>取消</Button>
            <Button disabled={pending} onClick={handleCreateChat}>确认添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 弹窗 2：粘贴导入聊天记录（支持微信 4.0/3.9 全格式 + 实时解析预览） ── */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>粘贴导入微信聊天记录</DialogTitle>
            <DialogDescription>
              直接粘贴从微信 4.0 / 3.9 复制出来的聊天记录，系统会自动拆分日期、发言人、时间与正文；点击下方预览标签可随时切换「对方 / 我方」。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              placeholder={"支持直接粘贴微信 4.0 复制的原文：\n2026年11月25日\n车车\n02:59\n[文件] 工业云平台使用说明书-外部版.pdf"}
            />
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={pasteDefaultFromMe}
                onChange={(e) => setPasteDefaultFromMe(e.target.checked)}
                className="size-3.5 accent-emerald-600"
              />
              若未识别出发言人（或双方同名），默认记为「我方发出」
            </label>

            {pastePreview.length > 0 && (
              <div className="rounded-xl border border-border/80 bg-muted/25 p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">解析预览（共识别 {pastePreview.length} 条）</span>
                  <span className="text-[11px] text-muted-foreground">点击左侧身份标签可切换「我方 / 对方」</span>
                </div>
                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {pastePreview.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 rounded-lg bg-card p-2 text-xs ring-1 ring-border/60">
                      <button
                        type="button"
                        onClick={() =>
                          setPastePreview((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, fromMe: !row.fromMe } : row)),
                          )
                        }
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                          item.fromMe ? "bg-emerald-600 text-white" : "bg-muted text-foreground",
                        )}
                      >
                        {item.fromMe ? "我方" : item.senderName || "对方"}
                      </button>
                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-all text-foreground/90">{item.text}</p>
                      {item.at && (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {new Date(item.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
            <Button disabled={pending || pastePreview.length === 0} onClick={handleImportPaste}>
              确认归档 ({pastePreview.length} 条)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 弹窗 3：微信本地同步与隐私设置 ── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>个人微信同步与隐私设置</DialogTitle>
            <DialogDescription>
              零封号架构：桌面端仅本地只读同步白名单客户会话，私人聊天绝不上传；发送采用半自动一键上屏。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1 text-sm">
            {/* 基本信息：严格单行标签，左右输入框水平对齐 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">我的微信昵称</label>
                <Input value={myWxName} onChange={(e) => setMyWxName(e.target.value)} placeholder="导入聊天记录时识别「我」" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">我的微信号</label>
                <Input value={myWxNo} onChange={(e) => setMyWxNo(e.target.value)} placeholder="选填，仅用于工作台展示" />
              </div>
            </div>

            {/* 同步隐私范围：桌面端 2 列并排卡片，紧凑美观 */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-foreground">同步隐私范围</label>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {WX_SYNC_MODES.map((m) => (
                  <label
                    key={m.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors",
                      syncMode === m.value
                        ? "border-emerald-600 bg-emerald-500/5 ring-1 ring-emerald-600/20"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <input
                      type="radio"
                      name="wx-sync-mode"
                      checked={syncMode === m.value}
                      onChange={() => setSyncMode(m.value)}
                      className="mt-0.5 shrink-0 accent-emerald-600"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-snug">{m.label}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{m.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {syncMode === "whitelist" && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">白名单自动同步备注前缀</label>
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <Input
                    value={remarkPrefix}
                    onChange={(e) => setRemarkPrefix(e.target.value)}
                    placeholder="客户-"
                    className="sm:max-w-44"
                  />
                  <p className="text-[11px] text-muted-foreground">微信里备注以该前缀开头的联系人会自动纳入同步。</p>
                </div>
              </div>
            )}

            {/* 本机全自动只读读取引擎状态区 */}
            <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">本机全自动只读引擎（内置 SQLCipher 3/4 解密）</p>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    desktopBridge
                      ? bridgeStatus?.syncSource !== "none"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                      : isOutdatedDesktop
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {desktopBridge
                    ? bridgeStatus?.hasDbKey
                      ? `已配置 ${bridgeStatus.keyCount || 1} 把密钥 · 自动读取`
                      : bridgeStatus?.syncSource === "chatlog"
                        ? "本地只读服务已连"
                        : `${isWin ? "Windows" : isMac ? "macOS" : "桌面"} v${desktopApp?.version || "0.2.9"} 待配密钥`
                    : isOutdatedDesktop
                      ? `${isWin ? "Windows" : isMac ? "macOS" : "桌面"} v${desktopApp?.version || "旧版"} 需升级`
                      : "浏览器模式"}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                桌面版已内置三引擎纯只读解密（兼容微信 4.2 / 4.1 / 4.0，零 DLL 注入、支持 WAL 实时新消息合并）。点一次「一键扫描本机微信密钥」即可长期自动同步全部符合隐私范围的历史对话与实时消息。
              </p>

              {desktopBridge ? (
                <div className="mt-3 space-y-2.5 border-t border-border/60 pt-3">
                  {isWin && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        检测到：{bridgeStatus?.wxVersionString ? `微信 ${bridgeStatus.wxVersionString}` : bridgeStatus?.wxVersion ? `微信 ${bridgeStatus.wxVersion}.x` : "本地微信"}
                        {bridgeStatus?.wxid ? ` (${bridgeStatus.wxid})` : ""}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={extractingKey}
                        onClick={handleExtractKey}
                      >
                        {extractingKey ? <LoaderCircle className="mr-1 size-3.5" /> : <RefreshCcw className="mr-1 size-3.5" />}
                        一键扫描本机微信密钥
                      </Button>
                    </div>
                  )}

                  {extractHint && (
                    <p className="rounded-lg bg-background/80 p-2 text-[11px] leading-relaxed text-muted-foreground ring-1 ring-border/60">
                      {extractHint}
                    </p>
                  )}

                  <div className="space-y-1">
                    <label className="block text-[11px] text-muted-foreground">
                      手动填入 64 位数据库密钥（Hex，仅加密存在本机钥匙串，绝不上云）
                    </label>
                    <Input
                      value={dbKeyInput}
                      onChange={(e) => setDbKeyInput(e.target.value)}
                      placeholder={bridgeStatus?.hasDbKey ? "已加密保存本机密钥（如需更换请粘贴新的 64 位 Hex）" : "粘贴 64 位十六进制密钥（可用 WeFlow 等工具一次性提取）"}
                      className="h-8 font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] text-muted-foreground">
                      或指定已解密明文 DB 目录（选填，例如 WeFlow 解密输出目录，免填密钥）
                    </label>
                    <Input
                      value={decryptedDir}
                      onChange={(e) => setDecryptedDir(e.target.value)}
                      placeholder="例如：C:\Users\你的用户名\WeFlow\decrypted"
                      className="h-8 font-mono text-xs"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[11px] text-muted-foreground">兼容只读 HTTP</span>
                    <Input
                      value={chatlogUrl}
                      onChange={(e) => setChatlogUrl(e.target.value)}
                      placeholder="http://127.0.0.1:5030"
                      className="h-8 font-mono text-xs"
                    />
                  </div>

                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={localAutoSync}
                      onChange={(e) => setLocalAutoSync(e.target.checked)}
                      className="size-3.5 accent-emerald-600"
                    />
                    在桌面端后台每 20 秒自动增量读取一次新消息并更新发送回执
                  </label>
                  {bridgeStatus?.dataDir && (
                    <p className="truncate text-[11px] text-muted-foreground">本机微信目录：{bridgeStatus.dataDir}</p>
                  )}
                </div>
              ) : isOutdatedDesktop ? (
                <div className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-800 sm:flex-row sm:items-center sm:justify-between dark:text-amber-200">
                  <span className="leading-relaxed">
                    检测到你正在使用旧版桌面端（v{desktopApp?.version || "0.2.5"}），请右键托盘图标点「检查更新」或下载安装 v0.2.9+ 启用微信本地桥接。
                  </span>
                  <Link
                    href={`/api/desktop/download?arch=${isMac ? "arm64" : "win"}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700"
                  >
                    <Download className="size-3" />
                    下载 v0.2.9
                  </Link>
                </div>
              ) : (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/60 p-2.5 text-[11px] text-muted-foreground">
                  <span>当前在浏览器中访问，下载安装车车 CRM 桌面版即可启用本机微信桥接。</span>
                  <Link
                    href="/api/desktop/download?arch=win"
                    className="inline-flex shrink-0 items-center gap-1 font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    <Download className="size-3" />
                    下载 Win 版
                  </Link>
                </div>
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑微信定位信息</DialogTitle>
            <DialogDescription>填写对方的微信号或精确备注名，可防止一键上屏搜索时重名串人。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 py-1">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">微信号（最高优先级）</label>
              <Input value={editWechatNo} onChange={(e) => setEditWechatNo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">微信备注名</label>
              <Input value={editRemark} onChange={(e) => setEditRemark(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">昵称 / 群名</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
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
        <DialogContent className="sm:max-w-md">
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
