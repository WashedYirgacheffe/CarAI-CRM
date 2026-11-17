// 物流：状态、运输方式、船司 / 快递的查询链接、发货通知文本。前后端通用

export const SHIPMENT_STATUSES = [
  { value: "BOOKING", label: "待订舱", color: "slate" },
  { value: "BOOKED", label: "已订舱", color: "blue" },
  { value: "LOADED", label: "已装柜", color: "violet" },
  { value: "DEPARTED", label: "已开船", color: "amber" },
  { value: "ARRIVED", label: "已到港", color: "teal" },
  { value: "DELIVERED", label: "已签收", color: "emerald" },
  { value: "CANCELLED", label: "已取消", color: "slate" },
] as const;

export type ShipmentStatusValue = (typeof SHIPMENT_STATUSES)[number]["value"];

/** 不同运输方式下状态的叫法 */
const AIR_LABELS: Partial<Record<ShipmentStatusValue, string>> = { BOOKING: "待订舱", LOADED: "已交货代", DEPARTED: "已起飞", ARRIVED: "已到达" };
const EXPRESS_LABELS: Partial<Record<ShipmentStatusValue, string>> = { BOOKING: "待寄出", BOOKED: "已下单", LOADED: "已揽收", DEPARTED: "运输中", ARRIVED: "派送中" };

export function shipmentStatus(v: string, mode?: string | null) {
  const s = SHIPMENT_STATUSES.find((x) => x.value === v) ?? SHIPMENT_STATUSES[0];
  const alt = mode === "air" ? AIR_LABELS : mode === "express" ? EXPRESS_LABELS : null;
  return { ...s, label: alt?.[s.value] ?? s.label };
}

/** 还在路上的状态（物流页默认看这些） */
export const SHIPMENT_OPEN: ShipmentStatusValue[] = ["BOOKING", "BOOKED", "LOADED", "DEPARTED", "ARRIVED"];

export const SHIP_MODES = [
  { value: "sea", label: "海运" },
  { value: "air", label: "空运" },
  { value: "express", label: "快递" },
  { value: "rail", label: "铁路" },
  { value: "truck", label: "陆运" },
] as const;

export const shipMode = (v: string) => SHIP_MODES.find((m) => m.value === v)?.label ?? v;

export const CONTAINER_TYPES = ["20GP", "40GP", "40HQ", "45HQ", "20RF", "40RF", "LCL 拼箱"] as const;

/** 常用船司 / 快递：名字里包含关键词就能生成查询链接。{no} = 提单号或快递单号，{ctn} = 柜号 */
const CARRIERS: { keys: string[]; name: string; url: string; by: "bl" | "tracking" | "container" }[] = [
  { keys: ["maersk", "马士基"], name: "Maersk", url: "https://www.maersk.com/tracking/{no}", by: "bl" },
  { keys: ["msc", "地中海"], name: "MSC", url: "https://www.msc.com/en/track-a-shipment?trackingNumber={no}", by: "bl" },
  { keys: ["cma", "达飞"], name: "CMA CGM", url: "https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=BL&Reference={no}", by: "bl" },
  { keys: ["hapag", "赫伯罗特"], name: "Hapag-Lloyd", url: "https://www.hapag-lloyd.com/en/online-business/track/track-by-booking-solution.html?blno={no}", by: "bl" },
  { keys: ["cosco", "中远", "oocl", "东方海外"], name: "COSCO", url: "https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=BILLOFLADING&number={no}", by: "bl" },
  { keys: ["one", "海洋网联"], name: "ONE", url: "https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam={no}", by: "bl" },
  { keys: ["evergreen", "长荣"], name: "Evergreen", url: "https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do?BL={no}", by: "bl" },
  { keys: ["dhl"], name: "DHL", url: "https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id={no}", by: "tracking" },
  { keys: ["fedex", "联邦"], name: "FedEx", url: "https://www.fedex.com/fedextrack/?trknbr={no}", by: "tracking" },
  { keys: ["ups"], name: "UPS", url: "https://www.ups.com/track?tracknum={no}", by: "tracking" },
  { keys: ["tnt"], name: "TNT", url: "https://www.tnt.com/express/en_gc/site/shipping-tools/tracking.html?cons={no}", by: "tracking" },
  { keys: ["顺丰", "sf express", "sf"], name: "SF Express", url: "https://www.sf-international.com/us/en/dynamic_function/waybill/#search/bill-number/{no}", by: "tracking" },
];

export const CARRIER_SUGGESTIONS = ["Maersk", "MSC", "CMA CGM", "COSCO", "Hapag-Lloyd", "ONE", "Evergreen", "DHL", "FedEx", "UPS", "TNT", "顺丰"];

type Trackable = { carrier?: string | null; blNo?: string | null; trackingNo?: string | null; containerNo?: string | null; trackingUrl?: string | null };

/** 查询链接：手填的优先，其次按船司 / 快递公司生成；通用兜底用 track-trace 按柜号查 */
export function trackingLink(s: Trackable): string | null {
  if (s.trackingUrl && /^https?:\/\//i.test(s.trackingUrl)) return s.trackingUrl;
  const name = (s.carrier ?? "").toLowerCase().trim();
  const words = name.split(/[\s,，/()（）-]+/).filter(Boolean);
  const c = name
    ? CARRIERS.find((x) => x.keys.some((k) => (k.length <= 3 ? words.includes(k) : name.includes(k))))
    : undefined;
  const firstCtn = s.containerNo?.split(/[,，\s]+/).find(Boolean);
  if (c) {
    const no = c.by === "tracking" ? s.trackingNo || s.blNo : s.blNo || s.trackingNo;
    if (no) return c.url.replace("{no}", encodeURIComponent(no.trim()));
  }
  if (firstCtn) return `https://www.track-trace.com/container?number=${encodeURIComponent(firstCtn)}`;
  return null;
}

const enDate = (d: string | null | undefined) => {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/** 英文发货通知（复制到邮件 / WhatsApp 发给客户）。日期是 YYYY-MM-DD 字符串 */
export function shippingNotice(s: {
  orderNo: string;
  buyer?: string | null;
  contact?: string | null;
  mode: string;
  carrier?: string | null;
  vessel?: string | null;
  blNo?: string | null;
  bookingNo?: string | null;
  containerNo?: string | null;
  containerType?: string | null;
  trackingNo?: string | null;
  portLoading?: string | null;
  portDischarge?: string | null;
  packages?: number | null;
  grossWeight?: string | null;
  volume?: string | null;
  etd?: string | null;
  eta?: string | null;
  link?: string | null;
  seller?: string | null;
}) {
  const air = s.mode === "air";
  const express = s.mode === "express";
  const lines = [
    `Dear ${s.contact || s.buyer || "Customer"},`,
    "",
    `Good news! Your order ${s.orderNo} has been shipped. Here are the shipping details:`,
    "",
    s.carrier && `${express ? "Courier" : air ? "Airline" : "Carrier"}: ${s.carrier}`,
    s.vessel && `${air ? "Flight" : "Vessel / Voyage"}: ${s.vessel}`,
    s.blNo && `${air ? "AWB No." : "B/L No."}: ${s.blNo}`,
    !s.blNo && s.bookingNo && `Booking No.: ${s.bookingNo}`,
    s.containerNo && `Container No.: ${s.containerNo}${s.containerType ? ` (${s.containerType})` : ""}`,
    s.trackingNo && `Tracking No.: ${s.trackingNo}`,
    (s.portLoading || s.portDischarge) && `Route: ${s.portLoading || "—"} → ${s.portDischarge || "—"}`,
    s.etd && `ETD: ${enDate(s.etd)}`,
    s.eta && `ETA: ${enDate(s.eta)}`,
    (s.packages || s.grossWeight || s.volume) &&
      `Cargo: ${[s.packages && `${s.packages} packages`, s.grossWeight && `${Number(s.grossWeight)} kg`, s.volume && `${Number(s.volume)} CBM`].filter(Boolean).join(", ")}`,
    s.link && `Track online: ${s.link}`,
    "",
    "We will keep you updated on the progress. Please feel free to contact us if you have any questions.",
    "",
    "Best regards,",
    s.seller || "",
  ];
  return lines.filter((l) => l !== false && l !== null && l !== undefined).join("\n").trim();
}
