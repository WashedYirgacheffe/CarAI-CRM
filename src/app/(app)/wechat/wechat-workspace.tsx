"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Archive,
  Bell,
  BellOff,
  Bot,
  Building2,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  ImageIcon,
  Link2,
  LoaderCircle,
  MessageCircle,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Settings,
  Video,
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
  markAllWechatReadAction,
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
    syncIntervalSec?: number;
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
  saveConfig: (cfg: { dbKey?: string; decryptedDir?: string; chatlogUrl?: string; autoSync?: boolean; syncIntervalSec?: number; dataDir?: string }) => Promise<{ ok: boolean; error?: string }>;
  extractKey?: () => Promise<{ ok: boolean; method?: string; wxVersionString?: string | null; matchedCount?: number; totalCount?: number; inserted?: number; error?: string; code?: string }>;
  syncNow: () => Promise<{ ok: boolean; threads?: number; inserted?: number; confirmed?: number; error?: string }>;
  loadMedia?: (meta: Record<string, unknown>) => Promise<{ ok: boolean; dataUrl?: string; filePath?: string; hasVideoFile?: boolean; reason?: string }>;
  openMedia?: (meta: Record<string, unknown>, reveal?: boolean) => Promise<{ ok: boolean; error?: string }>;
  loadAvatar?: (wxKey: string) => Promise<{ ok: boolean; dataUrl?: string }>;
  onSynced?: (cb: (info: { inserted?: number; confirmed?: number }) => void) => () => void;
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
  avatarUrl: string | null;
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
  avatarUrl: string | null;
  isGroup: boolean;
  muted: boolean;
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
  senderAvatar: string | null;
  type: string;
  body: string;
  quoteSender: string | null;
  quoteText: string | null;
  translation: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  mediaMeta: Record<string, unknown> | null;
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
  avatarUrl: string | null;
  isGroup: boolean;
  muted: boolean;
  syncEnabled: boolean;
  customerId: string | null;
  customer: { id: string; name: string; country: string | null } | null;
  pinnedAt: string | null;
  archived: boolean;
  messages: ChatMessage[];
};

function fmtFileSize(bytes: number | null | undefined) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 内存头像缓存，避免列表重渲染重复请求本地 head_image.db
const localAvatarCache = new Map<string, string | null>();

function WxAvatar({
  src,
  wxKey,
  label,
  isGroup,
  bridge,
  sizeClass = "size-9",
}: {
  src?: string | null;
  wxKey?: string | null;
  label: string;
  isGroup?: boolean;
  bridge?: DesktopWechatBridge | null;
  sizeClass?: string;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(src || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setImgSrc(src || null);
    setFailed(false);
  }, [src, wxKey]);

  useEffect(() => {
    if ((imgSrc && !failed) || !wxKey || !bridge?.loadAvatar) return;
    if (localAvatarCache.has(wxKey)) {
      const hit = localAvatarCache.get(wxKey);
      if (hit) {
        setImgSrc(hit);
        setFailed(false);
      }
      return;
    }
    let cancelled = false;
    bridge
      .loadAvatar(wxKey)
      .then((res) => {
        if (cancelled) return;
        const url = res.ok && res.dataUrl ? res.dataUrl : null;
        localAvatarCache.set(wxKey, url);
        if (url) {
          setImgSrc(url);
          setFailed(false);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [imgSrc, failed, wxKey, bridge]);

  if (imgSrc && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imgSrc}
        alt={label}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn(sizeClass, "shrink-0 rounded-full object-cover ring-1 ring-border/50")}
      />
    );
  }

  return (
    <div
      className={cn(
        sizeClass,
        "flex shrink-0 items-center justify-center rounded-full bg-emerald-600/15 text-xs font-medium text-emerald-700 dark:text-emerald-300",
      )}
    >
      {isGroup ? "群" : (label || "微").slice(0, 1).toUpperCase()}
    </div>
  );
}

function WxImageBubble({
  mediaMeta,
  fallbackText,
  bridge,
}: {
  mediaMeta: Record<string, unknown> | null;
  fallbackText: string;
  bridge: DesktopWechatBridge | null;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [reason, setReason] = useState<string | null>(null);
  const md5 = typeof mediaMeta?.md5 === "string" ? mediaMeta.md5 : typeof mediaMeta?.thumbMd5 === "string" ? mediaMeta.thumbMd5 : "";

  const load = () => {
    if (!bridge?.loadMedia || !mediaMeta || !md5) return;
    setState("loading");
    setReason(null);
    bridge
      .loadMedia(mediaMeta)
      .then((res) => {
        if (res.ok && res.dataUrl) {
          setDataUrl(res.dataUrl);
          setState("idle");
        } else {
          setReason(res.reason || "error");
          setState("error");
        }
      })
      .catch(() => {
        setReason("error");
        setState("error");
      });
  };

  useEffect(() => {
    if (bridge?.loadMedia && mediaMeta && md5) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, md5]);

  if (dataUrl) {
    return (
      <button
        type="button"
        onClick={() => bridge?.openMedia?.(mediaMeta!, false)}
        className="group relative block overflow-hidden rounded-xl"
        title="点击查看大图"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUrl}
          alt="图片"
          className="max-h-60 max-w-[240px] rounded-xl object-cover transition-transform group-hover:scale-[1.02]"
        />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <ImageIcon className="size-4 shrink-0 opacity-70" />
      <span>
        {state === "loading"
          ? "图片加载中…"
          : reason === "not_downloaded" || reason === "need_view_in_wechat"
            ? "图片未缓存，请先在微信查看一次"
            : fallbackText || "[图片]"}
      </span>
      {bridge?.loadMedia && md5 && state === "error" && (
        <button type="button" onClick={load} className="shrink-0 underline opacity-80 hover:opacity-100">
          重试
        </button>
      )}
    </div>
  );
}

function WxVideoBubble({
  mediaMeta,
  bridge,
}: {
  mediaMeta: Record<string, unknown> | null;
  bridge: DesktopWechatBridge | null;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const md5 = typeof mediaMeta?.md5 === "string" ? mediaMeta.md5 : "";
  const duration = typeof mediaMeta?.duration === "number" && mediaMeta.duration > 0 ? mediaMeta.duration : 0;

  useEffect(() => {
    if (!bridge?.loadMedia || !mediaMeta || !md5) return;
    setLoading(true);
    bridge
      .loadMedia(mediaMeta)
      .then((res) => {
        if (res.ok && res.dataUrl) setThumbUrl(res.dataUrl);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, md5]);

  const fmtDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleOpen = async () => {
    if (!bridge?.openMedia || !mediaMeta) return;
    const res = await bridge.openMedia(mediaMeta, false);
    if (!res.ok) toast.error(res.error || "请先在微信点击播放一次视频");
  };

  if (thumbUrl) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="group relative block overflow-hidden rounded-xl"
        title="点击播放视频"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbUrl}
          alt="视频封面"
          className="max-h-56 max-w-[240px] rounded-xl object-cover brightness-90 transition-all group-hover:brightness-75"
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-xs">
            <Play className="ml-0.5 size-5" />
          </span>
        </span>
        {duration > 0 && (
          <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
            {fmtDuration(duration)}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="flex items-center gap-2 text-left text-xs hover:underline"
    >
      <Video className="size-4 shrink-0 opacity-75" />
      <span>{loading ? "视频加载中…" : duration > 0 ? `视频 (${fmtDuration(duration)}) · 点击播放` : "视频 · 点击播放"}</span>
    </button>
  );
}

type ForwardRecordMeta = {
  title: string;
  desc?: string;
  count?: number;
  items?: { sender: string; time?: string; kind: string; text: string; md5?: string; filename?: string }[];
  chatMd5?: string;
  month?: string;
};

const FILTERS = [
  { key: "", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "dm", label: "单聊" },
  { key: "group", label: "群聊" },
  { key: "customer", label: "客户" },
  { key: "unlinked", label: "未关联" },
] as const;

const SYNC_INTERVAL_OPTIONS = [
  { value: 5, label: "5 秒" },
  { value: 8, label: "8 秒（推荐）" },
  { value: 15, label: "15 秒" },
  { value: 30, label: "30 秒" },
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
  totalUnreadAny,
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
  totalUnreadAny: number;
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
  const [syncIntervalSec, setSyncIntervalSec] = useState(8);
  const [extractingKey, setExtractingKey] = useState(false);
  const [extractHint, setExtractHint] = useState<string | null>(null);
  const [forwardModal, setForwardModal] = useState<ForwardRecordMeta | null>(null);

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
          if (s.syncIntervalSec) setSyncIntervalSec(s.syncIntervalSec);
          setLocalAutoSync(s.autoSync);
        })
        .catch(() => null);
      // 监听桌面端推送的新消息/已发出回执，自动静默刷新列表与聊天内容
      const unsub = bridge.onSynced?.(() => {
        router.refresh();
      });
      return () => {
        unsub?.();
      };
    }
  }, [router]);

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
          // 关键防闪退：当微信已被置顶上屏后，不在后台立刻 router.refresh() 触发骨架屏抢焦点，
          // 改为用户回到 CRM 窗口获得焦点时再静默刷新消息状态！
          if (sendRes.mode === "located_and_pasted" || sendRes.mode === "pasted") {
            toast.success(sendRes.hint || "已上屏到微信输入框，请核对对方头像后按 Enter 发送");
            window.addEventListener("focus", () => router.refresh(), { once: true });
            return;
          }
          toast.success(sendRes.hint || "已复制到剪贴板，请切到微信 Ctrl+V 发送");
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
      toast.info("请升级到最新桌面版 v0.3.1+ 后再连接微信");
      return;
    }
    setExtractingKey(true);
    setExtractHint(null);
    try {
      const res = await desktopBridge.extractKey();
      const s = await desktopBridge.getStatus().catch(() => null);
      if (s) setBridgeStatus(s);
      if (res.ok) {
        const msg = `微信已连接，同步了 ${res.inserted ?? 0} 条聊天记录`;
        setExtractHint(msg);
        toast.success(msg);
        router.refresh();
      } else {
        setExtractHint(res.error || "连接未成功，请确认本机微信已登录并打开聊天窗口后重试");
        toast.error(res.error || "连接未成功，请确认微信已登录");
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
            syncIntervalSec,
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
            {account.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={account.avatarUrl}
                alt={account.name || "我"}
                referrerPolicy="no-referrer"
                className="size-10 rounded-full object-cover ring-1 ring-border/50"
              />
            ) : (
              <MessageCircle className="size-5" />
            )}
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
              <p className="truncate font-medium">{account.name || "微信"}</p>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {desktopBridge
                ? bridgeStatus?.wechatRunning
                  ? bridgeStatus.syncSource !== "none"
                    ? `已连接 · 每 ${bridgeStatus.syncIntervalSec || 8} 秒自动同步`
                    : "桌面版已就绪 · 待连接本机微信"
                  : "等待打开本机微信"
                : isOutdatedDesktop
                  ? `桌面版 v${desktopApp?.version || "旧版"} 需升级`
                  : WX_SYNC_STATUS_LABEL[account.status] || "建议使用桌面版"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {totalUnreadAny > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                title={`一键已读（清除全部 ${totalUnreadAny} 个未读会话）`}
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const res = await markAllWechatReadAction();
                    if ("ok" in res) {
                      toast.success(`已清除全部未读提醒（${res.count} 个会话）`);
                      router.refresh();
                    }
                  });
                }}
              >
                <CheckCheck className="size-4" />
              </Button>
            )}
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
                      selected
                        ? "bg-emerald-500/10 text-foreground"
                        : c.pinnedAt
                          ? "bg-muted/35 hover:bg-muted/65"
                          : "hover:bg-muted/60",
                    )}
                  >
                    <WxAvatar
                      src={c.avatarUrl}
                      wxKey={c.wxKey}
                      label={title}
                      isGroup={c.isGroup}
                      bridge={desktopBridge}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
                          {c.pinnedAt && (
                            <Pin className="size-3 shrink-0 text-emerald-600/80 dark:text-emerald-400" aria-label="置顶" />
                          )}
                          <span className="truncate">{title}</span>
                          {c.muted && (
                            <BellOff className="size-3 shrink-0 text-muted-foreground/70" aria-label="消息免打扰" />
                          )}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{fmtTime(c.lastMessageAt)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-muted-foreground">
                          {c.lastFromMe ? "我: " : ""}
                          {c.lastText || (c.wechatNo ? `微信号: ${c.wechatNo}` : "点击开始半自动沟通")}
                        </p>
                        {c.unread > 0 &&
                          (c.muted ? (
                            <span
                              className="size-2 shrink-0 rounded-full bg-muted-foreground/45"
                              title={`免打扰会话 · ${c.unread} 条新消息`}
                            />
                          ) : (
                            <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-medium text-white">
                              {c.unread > 99 ? "99+" : c.unread}
                            </span>
                          ))}
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
            <h2 className="mt-4 font-brand text-lg font-medium">微信工作台</h2>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
              选择左侧会话查看聊天记录、关联 CRM 客户，或使用 AI 起草回复并一键发送到微信。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => setNewChatOpen(true)}>
                <Plus className="mr-1.5 size-3.5" />
                添加微信客户
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
                <Settings className="mr-1.5 size-3.5" />
                连接本机微信
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
                <WxAvatar
                  src={activeChat.avatarUrl}
                  wxKey={activeChat.wxKey}
                  label={wechatDisplayName(activeChat)}
                  isGroup={activeChat.isGroup}
                  bridge={desktopBridge}
                />
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
                      修改定位名称
                    </button>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      匹配名：
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
                  title={activeChat.pinnedAt ? "取消置顶" : "置顶该会话"}
                  onClick={() => {
                    startTransition(async () => {
                      await updateWechatChatAction(activeChat.id, { pinned: !activeChat.pinnedAt });
                      toast.success(activeChat.pinnedAt ? "已取消置顶" : "已置顶该会话");
                      router.refresh();
                    });
                  }}
                >
                  {activeChat.pinnedAt ? <PinOff className="mr-1 size-3.5 text-emerald-600" /> : <Pin className="mr-1 size-3.5" />}
                  {activeChat.pinnedAt ? "取消置顶" : "置顶"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  title={activeChat.muted ? "已开启消息免打扰，点击恢复提醒" : "开启免打扰"}
                  onClick={() => {
                    startTransition(async () => {
                      await updateWechatChatAction(activeChat.id, { muted: !activeChat.muted });
                      toast.success(activeChat.muted ? "已取消免打扰" : "已设为免打扰");
                      router.refresh();
                    });
                  }}
                >
                  {activeChat.muted ? <BellOff className="mr-1 size-3.5 text-muted-foreground" /> : <Bell className="mr-1 size-3.5" />}
                  {activeChat.muted ? "已免打扰" : "免打扰"}
                </Button>
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
                activeChat.messages.map((m) => {
                  const fileMeta = m.mediaMeta?.kind === "file" ? m.mediaMeta : null;
                  const imageMeta = m.mediaMeta?.kind === "image" ? m.mediaMeta : null;
                  const videoMeta = m.mediaMeta?.kind === "video" ? m.mediaMeta : null;
                  const forwardMeta = m.mediaMeta?.kind === "forward" ? (m.mediaMeta as unknown as ForwardRecordMeta) : null;
                  const linkMeta = m.mediaMeta?.kind === "link" ? m.mediaMeta : null;
                  const cardMeta = m.mediaMeta?.kind === "card" ? m.mediaMeta : null;
                  const fileDisplayName = m.mediaName || (typeof fileMeta?.filename === "string" ? fileMeta.filename : m.body.replace(/^\[文件\]\s*/, ""));
                  const fileExt = typeof fileMeta?.ext === "string" ? fileMeta.ext.toUpperCase() : "";
                  const fileSizeText = fmtFileSize(m.mediaSize ?? (typeof fileMeta?.size === "number" ? fileMeta.size : null));

                  return (
                    <div key={m.id} className={cn("flex items-start gap-2.5", m.fromMe ? "flex-row-reverse" : "flex-row")}>
                      <WxAvatar
                        src={m.fromMe ? account.avatarUrl : m.senderAvatar || (!activeChat.isGroup ? activeChat.avatarUrl : null)}
                        wxKey={!m.fromMe && !activeChat.isGroup ? activeChat.wxKey : null}
                        label={m.fromMe ? account.name || "我" : m.senderName || wechatDisplayName(activeChat)}
                        bridge={desktopBridge}
                        sizeClass="size-8 mt-0.5"
                      />
                      <div className={cn("flex min-w-0 max-w-[76%] flex-col", m.fromMe ? "items-end" : "items-start")}>
                        {!m.fromMe && m.senderName && (
                          <span className="mb-1 px-1 text-[11px] text-muted-foreground">{m.senderName}</span>
                        )}
                        <div
                          className={cn(
                            "rounded-2xl px-3.5 py-2.5 text-sm shadow-xs",
                            m.fromMe
                              ? m.status === "STAGED"
                                ? "border border-amber-400/50 bg-amber-50 text-foreground dark:bg-amber-950/40"
                                : m.status === "UNCONFIRMED" || m.status === "FAILED"
                                  ? "border border-destructive/40 bg-destructive/10 text-foreground"
                                  : "bg-emerald-600 text-white"
                              : "border border-border/60 bg-card text-foreground",
                          )}
                        >
                          {/* 1) 图片消息 */}
                          {m.type === "image" && (imageMeta?.md5 || imageMeta?.thumbMd5) ? (
                            <WxImageBubble mediaMeta={imageMeta} fallbackText={m.body} bridge={desktopBridge} />
                          ) : m.type === "video" && videoMeta ? (
                            /* 2) 视频消息 */
                            <WxVideoBubble mediaMeta={videoMeta} bridge={desktopBridge} />
                          ) : forwardMeta ? (
                            /* 3) 合并转发聊天记录卡片（点击弹窗逐条查看） */
                            <button
                              type="button"
                              onClick={() => setForwardModal(forwardMeta)}
                              className="min-w-[220px] max-w-[300px] text-left"
                            >
                              <p className="text-xs font-semibold leading-snug">{forwardMeta.title || "聊天记录"}</p>
                              {forwardMeta.desc ? (
                                <p
                                  className={cn(
                                    "mt-1.5 line-clamp-4 whitespace-pre-line text-[11px] leading-relaxed",
                                    m.fromMe && m.status === "SENT" ? "text-white/80" : "text-muted-foreground",
                                  )}
                                >
                                  {forwardMeta.desc}
                                </p>
                              ) : forwardMeta.items?.length ? (
                                <div
                                  className={cn(
                                    "mt-1.5 space-y-0.5 text-[11px]",
                                    m.fromMe && m.status === "SENT" ? "text-white/80" : "text-muted-foreground",
                                  )}
                                >
                                  {forwardMeta.items.slice(0, 3).map((it, idx) => (
                                    <p key={idx} className="truncate">
                                      {it.sender}：{it.text}
                                    </p>
                                  ))}
                                </div>
                              ) : null}
                              <div
                                className={cn(
                                  "mt-2 flex items-center justify-between border-t pt-1.5 text-[11px]",
                                  m.fromMe && m.status === "SENT" ? "border-white/25 text-white/85" : "border-border/60 text-muted-foreground",
                                )}
                              >
                                <span>聊天记录{forwardMeta.count ? ` · 共 ${forwardMeta.count} 条` : ""}</span>
                                <span className="font-medium">查看详情 →</span>
                              </div>
                            </button>
                          ) : linkMeta && typeof linkMeta.url === "string" ? (
                            /* 4) 链接卡片 */
                            <a
                              href={linkMeta.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block min-w-[210px] max-w-[300px] space-y-1 hover:opacity-90"
                            >
                              <p className="text-xs font-semibold leading-snug">{String(linkMeta.title || "网页链接")}</p>
                              {typeof linkMeta.desc === "string" && linkMeta.desc && (
                                <p
                                  className={cn(
                                    "line-clamp-2 text-[11px] leading-relaxed",
                                    m.fromMe && m.status === "SENT" ? "text-white/80" : "text-muted-foreground",
                                  )}
                                >
                                  {linkMeta.desc}
                                </p>
                              )}
                              <div
                                className={cn(
                                  "mt-1.5 flex items-center gap-1 border-t pt-1 text-[11px]",
                                  m.fromMe && m.status === "SENT" ? "border-white/25 text-white/80" : "border-border/60 text-muted-foreground",
                                )}
                              >
                                <Link2 className="size-3 shrink-0" />
                                <span className="truncate">{String(linkMeta.source || "打开链接")}</span>
                              </div>
                            </a>
                          ) : cardMeta ? (
                            /* 5) 小程序 / 视频号卡片 */
                            <div className="min-w-[200px] max-w-[280px] space-y-1">
                              <span
                                className={cn(
                                  "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
                                  m.fromMe && m.status === "SENT" ? "bg-white/20 text-white" : "bg-muted text-muted-foreground",
                                )}
                              >
                                {String(cardMeta.badge || "卡片")}
                              </span>
                              <p className="text-xs font-medium leading-snug">{String(cardMeta.title || m.body)}</p>
                              {typeof cardMeta.desc === "string" && cardMeta.desc && (
                                <p
                                  className={cn(
                                    "line-clamp-2 text-[11px]",
                                    m.fromMe && m.status === "SENT" ? "text-white/80" : "text-muted-foreground",
                                  )}
                                >
                                  {cardMeta.desc}
                                </p>
                              )}
                            </div>
                          ) : m.type === "document" && (fileMeta || m.mediaName) ? (
                            /* 6) 文件卡片 */
                            <div className="min-w-[210px] space-y-2">
                              <div className="flex items-start gap-2.5">
                                <span
                                  className={cn(
                                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                                    m.fromMe ? "bg-white/15 text-white" : "bg-muted text-foreground/80",
                                  )}
                                >
                                  <FileText className="size-4" />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="break-all text-xs font-medium leading-snug">{fileDisplayName}</p>
                                  <p className={cn("mt-0.5 text-[11px]", m.fromMe ? "text-white/75" : "text-muted-foreground")}>
                                    {[fileExt, fileSizeText].filter(Boolean).join(" · ") || "文件"}
                                  </p>
                                </div>
                              </div>
                              {desktopBridge?.openMedia && (
                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const res = await desktopBridge.openMedia!(
                                        fileMeta || { kind: "file", filename: fileDisplayName },
                                        false,
                                      );
                                      if (!res.ok) toast.error(res.error || "无法打开文件");
                                    }}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                                      m.fromMe
                                        ? "bg-white/20 text-white hover:bg-white/30"
                                        : "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
                                    )}
                                  >
                                    <ExternalLink className="size-3" />
                                    打开文件
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const res = await desktopBridge.openMedia!(
                                        fileMeta || { kind: "file", filename: fileDisplayName },
                                        true,
                                      );
                                      if (!res.ok) toast.error(res.error || "未找到文件");
                                    }}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors",
                                      m.fromMe
                                        ? "bg-white/10 text-white/90 hover:bg-white/20"
                                        : "bg-muted text-muted-foreground hover:text-foreground",
                                    )}
                                  >
                                    <FolderOpen className="size-3" />
                                    所在文件夹
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          )}

                          {/* 引用回复内嵌卡片（还原微信原生引用展示） */}
                          {m.quoteText && (
                            <div
                              className={cn(
                                "mt-2 rounded-lg border-l-2 px-2.5 py-1.5 text-xs leading-relaxed",
                                m.fromMe && m.status === "SENT"
                                  ? "border-white/50 bg-black/15 text-white/90"
                                  : "border-emerald-500/60 bg-muted/60 text-muted-foreground",
                              )}
                            >
                              {m.quoteSender && <span className="font-medium">{m.quoteSender}：</span>}
                              <span className="line-clamp-3 whitespace-pre-wrap break-words">{m.quoteText}</span>
                            </div>
                          )}

                          {m.translation && (
                            <p
                              className={cn(
                                "mt-2 border-t pt-1.5 text-xs",
                                m.fromMe && m.status === "SENT"
                                  ? "border-white/25 text-white/85"
                                  : "border-border/50 text-muted-foreground",
                              )}
                            >
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
                    </div>
                  );
                })
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
                    自动定位联系人
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
                placeholder="输入要发给客户的微信消息（Ctrl / Cmd + Enter 一键填入微信输入框）…"
                rows={3}
                className="resize-none text-sm"
              />

              {/* 右侧留出 md:pr-16 避开右下角全局 AI 悬浮球 */}
              <div className="mt-2 flex items-center justify-end gap-2 md:pr-16">
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

      {/* ── 弹窗 3：微信同步设置（简洁明了，专业配置折叠在高级设置中） ── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>微信同步设置</DialogTitle>
            <DialogDescription>
              选择需要同步的微信会话范围与消息刷新频率。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1 text-sm">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">我的微信昵称</label>
                <Input value={myWxName} onChange={(e) => setMyWxName(e.target.value)} placeholder="导入记录时区分自己" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">我的微信号</label>
                <Input value={myWxNo} onChange={(e) => setMyWxNo(e.target.value)} placeholder="选填" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-foreground">同步范围</label>
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
                <label className="block text-xs font-medium text-foreground">客户备注前缀</label>
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <Input
                    value={remarkPrefix}
                    onChange={(e) => setRemarkPrefix(e.target.value)}
                    placeholder="客户-"
                    className="sm:max-w-44"
                  />
                  <p className="text-[11px] text-muted-foreground">备注以该前缀开头的联系人会自动同步到 CRM。</p>
                </div>
              </div>
            )}

            {/* 连接本机微信 */}
            <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">本机微信连接</p>
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
                      ? "已连接 · 自动同步"
                      : bridgeStatus?.syncSource === "chatlog"
                        ? "已连接"
                        : `桌面版 v${desktopApp?.version || "0.3.1"} 待连接`
                    : isOutdatedDesktop
                      ? `旧版 v${desktopApp?.version || ""} 需升级`
                      : "网页模式"}
                </span>
              </div>

              {desktopBridge ? (
                <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
                  {isWin && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        当前本机：{bridgeStatus?.wxVersionString ? `微信 ${bridgeStatus.wxVersionString}` : "微信桌面版"}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant={bridgeStatus?.hasDbKey ? "outline" : "default"}
                        className="h-7 text-xs"
                        disabled={extractingKey}
                        onClick={handleExtractKey}
                      >
                        {extractingKey ? <LoaderCircle className="mr-1 size-3.5" /> : <RefreshCcw className="mr-1 size-3.5" />}
                        {bridgeStatus?.hasDbKey ? "重新连接微信" : "一键连接本机微信"}
                      </Button>
                    </div>
                  )}

                  {extractHint && (
                    <p className="rounded-lg bg-background/80 p-2 text-[11px] leading-relaxed text-muted-foreground ring-1 ring-border/60">
                      {extractHint}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground/90">
                      <input
                        type="checkbox"
                        checked={localAutoSync}
                        onChange={(e) => setLocalAutoSync(e.target.checked)}
                        className="size-3.5 accent-emerald-600"
                      />
                      自动刷新新消息
                    </label>
                    {localAutoSync && (
                      <div className="flex items-center gap-1">
                        {SYNC_INTERVAL_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setSyncIntervalSec(opt.value)}
                            className={cn(
                              "rounded-md px-2 py-1 text-[11px] transition-colors",
                              syncIntervalSec === opt.value
                                ? "bg-emerald-600 font-medium text-white"
                                : "bg-background text-muted-foreground ring-1 ring-border/70 hover:text-foreground",
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 高级选项默认折叠，普通业务员无需关心 */}
                  <details className="rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs">
                    <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
                      高级配置（手动指定密钥或数据目录）
                    </summary>
                    <div className="mt-2.5 space-y-2.5">
                      <div className="space-y-1">
                        <label className="block text-[11px] text-muted-foreground">手动填入密钥（仅存于本机）</label>
                        <Input
                          value={dbKeyInput}
                          onChange={(e) => setDbKeyInput(e.target.value)}
                          placeholder={bridgeStatus?.hasDbKey ? "已保存（如需更换请粘贴新密钥）" : "选填"}
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[11px] text-muted-foreground">自定义数据目录</label>
                        <Input
                          value={decryptedDir}
                          onChange={(e) => setDecryptedDir(e.target.value)}
                          placeholder="留空则自动识别"
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-[11px] text-muted-foreground">本地服务地址</span>
                        <Input
                          value={chatlogUrl}
                          onChange={(e) => setChatlogUrl(e.target.value)}
                          placeholder="http://127.0.0.1:5030"
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      {bridgeStatus?.dataDir && (
                        <p className="truncate text-[11px] text-muted-foreground">微信目录：{bridgeStatus.dataDir}</p>
                      )}
                    </div>
                  </details>
                </div>
              ) : isOutdatedDesktop ? (
                <div className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-800 sm:flex-row sm:items-center sm:justify-between dark:text-amber-200">
                  <span className="leading-relaxed">
                    当前桌面版（v{desktopApp?.version || "旧版"}）版本较低，请升级至 v0.3.1 以获得完整微信功能。
                  </span>
                  <Link
                    href={`/api/desktop/download?arch=${isMac ? "arm64" : "win"}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700"
                  >
                    <Download className="size-3" />
                    下载 v0.3.1
                  </Link>
                </div>
              ) : (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/60 p-2.5 text-[11px] text-muted-foreground">
                  <span>请下载安装车车 CRM 桌面版以同步本机微信。</span>
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

      {/* ── 弹窗 6：合并转发聊天记录详情查看 ── */}
      <Dialog open={!!forwardModal} onOpenChange={(o) => !o && setForwardModal(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{forwardModal?.title || "聊天记录"}</DialogTitle>
            <DialogDescription>
              {forwardModal?.count ? `共 ${forwardModal.count} 条转发消息` : "合并转发的聊天内容"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2.5 overflow-y-auto py-1 pr-1">
            {forwardModal?.items?.length ? (
              forwardModal.items.map((it, idx) => (
                <div key={idx} className="rounded-xl border border-border/60 bg-muted/25 p-3">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground/85">{it.sender}</span>
                    {it.time && <span>{it.time}</span>}
                  </div>
                  <div className="mt-1.5 text-xs leading-relaxed text-foreground/90">
                    {it.kind === "image" && it.md5 ? (
                      <WxImageBubble
                        mediaMeta={{ kind: "image", md5: it.md5, chatMd5: forwardModal.chatMd5, month: forwardModal.month }}
                        fallbackText={it.text}
                        bridge={desktopBridge}
                      />
                    ) : it.kind === "video" && it.md5 ? (
                      <WxVideoBubble
                        mediaMeta={{ kind: "video", md5: it.md5, month: forwardModal.month }}
                        bridge={desktopBridge}
                      />
                    ) : it.kind === "file" && it.filename && desktopBridge?.openMedia ? (
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await desktopBridge.openMedia!(
                            { kind: "file", filename: it.filename, month: forwardModal.month },
                            false,
                          );
                          if (!res.ok) toast.error(res.error || "请先在微信下载该文件");
                        }}
                        className="inline-flex items-center gap-1.5 text-emerald-700 hover:underline dark:text-emerald-400"
                      >
                        <FileText className="size-3.5" />
                        {it.filename}
                      </button>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{it.text}</p>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {forwardModal?.desc || "暂无明细内容"}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForwardModal(null)}>关闭</Button>
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
