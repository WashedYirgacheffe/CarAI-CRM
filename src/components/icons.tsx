"use client";

import { createElement, type ComponentProps, type ComponentType } from "react";
import { icons, type IconName } from "@/lib/agentes/icons";
import { PixelSpinner } from "@/components/agentes/pixel-spinner";
import { cn } from "@/lib/utils";

/*
 * 全站图标：agentes 设计系统的图标集（20px 网格、1.6 线宽、圆头，日历 / 消息带 Agent 的切角）。
 * 导出名和 lucide-react 一致，页面里只需把 "lucide-react" 换成 "@/components/icons"。
 * 图标集里没有的（购物车、星标、打印机…）仍用 lucide，线宽在 globals.css 里统一调细。
 */

export type IconProps = Omit<ComponentProps<"svg">, "ref"> & {
  size?: number | string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
  ref?: React.Ref<SVGSVGElement>;
};
export type LucideIcon = ComponentType<IconProps>;

function icon(name: IconName, flip = false) {
  function AcIcon({ size = 24, className, strokeWidth, absoluteStrokeWidth, style, ...rest }: IconProps) {
    void strokeWidth;
    void absoluteStrokeWidth;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        data-icon={name}
        className={cn("ac-icon", className)}
        style={flip ? { transform: "scaleX(-1)", ...style } : style}
        {...rest}
      >
        {icons[name].map(([tag, attrs], i) =>
          createElement(tag, { key: i, ...(tag === "circle" && Number(attrs.r) < 1.6 ? { fill: "currentColor" } : null), ...attrs }),
        )}
      </svg>
    );
  }
  AcIcon.displayName = `Icon(${name})`;
  return AcIcon;
}

/** 加载中：像素轨道，不再是转圈（调用处的 animate-spin 去掉，像素自己会走） */
function Spinner({ size = 24, className, style }: IconProps) {
  const px = typeof size === "number" ? size : 16;
  return <PixelSpinner size={px} className={cn("size-4", className?.replace(/\banimate-spin\b/g, ""))} style={style} />;
}
export const Loader2 = Spinner;
export const Loader2Icon = Spinner;
export const LoaderCircle = Spinner;

export const AlarmClock = icon("clock");
export const Archive = icon("archiveBox");
export const ArrowDown = icon("arrowDown");
export const ArrowLeft = icon("arrowRight", true);
export const ArrowLeftRight = icon("swap");
export const ArrowRight = icon("arrowRight");
export const ArrowRightLeft = icon("swap");
export const ArrowUp = icon("arrowUp");
export const Ban = icon("block");
export const BarChart3 = icon("chart");
export const BellPlus = icon("bell");
export const Bot = icon("agent");
export const CalendarDays = icon("calendar");
export const Check = icon("check");
export const CheckCircle2 = icon("approve");
export const CheckIcon = icon("check");
export const ChevronDown = icon("chevronDown");
export const ChevronDownIcon = icon("chevronDown");
export const ChevronLeft = icon("chevronLeft");
export const ChevronRight = icon("chevronRight");
export const ChevronRightIcon = icon("chevronRight");
export const ChevronUpIcon = icon("chevronUp");
export const CircleAlert = icon("alert");
export const CircleCheckIcon = icon("approve");
export const Clock = icon("clock");
export const Copy = icon("copy");
export const Download = icon("download");
export const ExternalLink = icon("external");
export const Eye = icon("eye");
export const FileText = icon("document");
export const GripVertical = icon("grip");
export const Hand = icon("pointer");
export const ImageIcon = icon("image");
export const Inbox = icon("archiveBox");
export const InfoIcon = icon("info");
export const Keyboard = icon("keyboard");
export const Languages = icon("globe");
export const LayoutGrid = icon("grid");
export const ListChecks = icon("checks");
export const Lock = icon("lock");
export const LogOut = icon("power");
export const Mail = icon("mail");
export const Maximize2 = icon("expand");
export const MessageCircle = icon("message");
export const MessagesSquare = icon("thread");
export const Minimize2 = icon("shrink");
export const MoreHorizontal = icon("more");
export const MoreHorizontalIcon = icon("more");
export const MousePointerClick = icon("pointer");
export const PanelLeftIcon = icon("sidebar");
export const Paperclip = icon("attach");
export const Pause = icon("pause");
export const PenLine = icon("edit");
export const PenSquare = icon("edit");
export const Pencil = icon("edit");
export const Play = icon("play");
export const Plus = icon("plus");
export const Redo2 = icon("undo", true);
export const RefreshCcw = icon("refresh");
export const RefreshCw = icon("refresh");
export const Replace = icon("swap");
export const Reply = icon("reply");
export const RotateCcw = icon("replay");
export const Search = icon("search");
export const Send = icon("send");
export const Settings2 = icon("settings");
export const ShieldOff = icon("shield");
export const SlidersHorizontal = icon("settings");
export const Smartphone = icon("phone");
export const Square = icon("stop");
export const SquarePen = icon("edit");
export const Table2 = icon("table");
export const ThumbsDown = icon("thumbDown");
export const ThumbsUp = icon("thumbUp");
export const History = icon("clock");
export const Trash2 = icon("trash");
export const TriangleAlert = icon("alert");
export const TriangleAlertIcon = icon("alert");
export const Undo2 = icon("undo");
export const UserPlus = icon("personAdd");
export const UserRound = icon("person");
export const Users = icon("members");
export const Video = icon("video");
export const Wallet = icon("wallet");
export const X = icon("close");
export const XIcon = icon("close");

export const AlertCircle = icon("alert");
export const ArchiveRestore = icon("unarchive");
export const Bell = icon("bell");
export const CalendarClock = icon("calendar");
export const CalendarX2 = icon("calendar");
export const ChevronsLeft = icon("chevronLeft");
export const ClipboardList = icon("note");
export const Forward = icon("reply", true);
export const Globe = icon("globe");
export const Image = icon("image");
export const KanbanSquare = icon("grid");
export const LayoutDashboard = icon("home");
export const Link2 = icon("link");
export const ListTodo = icon("checks");
export const MapPin = icon("pin");
export const MessageSquareText = icon("message");
export const Minus = icon("dash");
export const NotebookPen = icon("note");
export const PanelRight = icon("sidebar", true);
export const Phone = icon("phone");
export const Pin = icon("pin");
export const RotateCw = icon("refresh");
export const Settings = icon("cog");

export {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUpRight,
  BookmarkPlus,
  Building2,
  ChevronsRight,
  ClipboardPaste,
  Construction,
  CornerDownLeft,
  FileOutput,
  FolderTree,
  Link2Off,
  MailCheck,
  MailOpen,
  MailWarning,
  Merge,
  MoreVertical,
  OctagonXIcon,
  Package,
  PackagePlus,
  PinOff,
  Printer,
  ReceiptText,
  ReplyAll,
  Share2,
  ShoppingCart,
  Sparkles,
  Star,
  StarOff,
  Tag,
  TrendingDown,
  TrendingUp,
  Truck,
  UserCheck,
  WandSparkles,
  Waves,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
