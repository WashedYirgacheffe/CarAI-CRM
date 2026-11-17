/** 客户文件：分类、类型判断（前后端共用） */

/** 外贸常见单据；value 存在库里，旧值（PI…OTHER）保持不变 */
export const FILE_CATEGORIES = [
  { value: "QUOTE", label: "报价单" },
  { value: "PI", label: "PI 形式发票" },
  { value: "PO", label: "采购订单 / PO" },
  { value: "CONTRACT", label: "合同" },
  { value: "CI", label: "CI 商业发票" },
  { value: "PL", label: "PL 装箱单" },
  { value: "BOOKING", label: "订舱 / 补料" },
  { value: "BL", label: "提单" },
  { value: "CUSTOMS", label: "报关资料" },
  { value: "CO", label: "CO 原产地证" },
  { value: "LC", label: "信用证 LC" },
  { value: "PAYMENT", label: "付款水单" },
  { value: "INSURANCE", label: "保险单" },
  { value: "INSPECTION", label: "验货 / 商检" },
  { value: "CERT", label: "证书 / 检测报告" },
  { value: "CATALOG", label: "目录 / 规格书" },
  { value: "DRAWING", label: "图纸 / 设计稿" },
  { value: "PHOTO", label: "图片" },
  { value: "OTHER", label: "其他" },
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number]["value"];
export const isFileCategory = (v: unknown): v is FileCategory =>
  FILE_CATEGORIES.some((c) => c.value === v);
export const fileCategoryLabel = (v: string) =>
  FILE_CATEGORIES.find((c) => c.value === v)?.label ?? "其他";

/** 单个文件上限：邮件附件合计 25MB，客户文件跟它一致，方便直接当附件发 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type FileKind =
  | "pdf"
  | "image"
  | "sheet"
  | "doc"
  | "slides"
  | "text"
  | "video"
  | "audio"
  | "other";

export const extOf = (name: string) =>
  /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? "";

const SHEET_EXT = ["xlsx", "xls", "xlsm", "xlsb", "csv", "ods", "numbers", "et"];
const DOC_EXT = ["docx", "doc", "docm", "rtf", "odt", "pages", "wps", "dotx"];
const SLIDES_EXT = ["pptx", "ppt", "pps", "ppsx", "odp", "key", "dps"];

/** 按扩展名和 MIME 判断怎么预览、怎么抽文字 */
export function fileKind(name: string, mime = ""): FileKind {
  const ext = extOf(name);
  const m = mime.toLowerCase();
  if (ext === "pdf" || m === "application/pdf") return "pdf";
  if (
    ["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext) ||
    (m.startsWith("image/") && !m.includes("svg"))
  )
    return "image";
  if (SHEET_EXT.includes(ext) || /spreadsheet|ms-excel|text\/csv/.test(m))
    return "sheet";
  if (DOC_EXT.includes(ext) || /wordprocessing|msword|rtf|opendocument\.text/.test(m))
    return "doc";
  if (SLIDES_EXT.includes(ext) || /presentation|powerpoint/.test(m))
    return "slides";
  if (
    ["txt", "md", "json", "xml", "html", "htm", "log", "eml"].includes(ext) ||
    m.startsWith("text/")
  )
    return "text";
  if (["mp4", "webm", "mov"].includes(ext) || m.startsWith("video/"))
    return "video";
  if (
    ["mp3", "ogg", "m4a", "wav", "opus"].includes(ext) ||
    m.startsWith("audio/")
  )
    return "audio";
  return "other";
}

/** 要用 LibreOffice 转成 PDF 才能原样预览的（Excel、Word、PPT…；CSV 直接按表格看） */
export const isOfficeFile = (name: string, mime = "") => {
  const k = fileKind(name, mime);
  return (k === "sheet" && extOf(name) !== "csv") || k === "doc" || k === "slides";
};

/** 能在线预览的类型 */
export const previewable = (name: string, mime = "") =>
  fileKind(name, mime) !== "other";

/** 列表里文件类型的小标签：PDF / XLS / DOC… */
export function fileBadge(name: string, mime = "") {
  const k = fileKind(name, mime);
  const ext = extOf(name).toUpperCase();
  const tone =
    k === "pdf"
      ? "bg-red-500"
      : k === "sheet"
        ? "bg-emerald-600"
        : k === "doc"
          ? "bg-blue-600"
          : k === "slides"
            ? "bg-orange-500"
            : k === "image"
              ? "bg-violet-500"
              : "bg-slate-500";
  return { label: ext.slice(0, 4) || "FILE", tone };
}

/** 文件类型筛选（WhatsApp 侧栏、文件列表） */
export const FILE_TYPE_FILTERS = [
  { value: "pdf", label: "PDF" },
  { value: "sheet", label: "表格" },
  { value: "doc", label: "文档" },
  { value: "image", label: "图片" },
] as const;

/* ── 识别是哪种单据：先看文件名，名字看不出再看文件里的文字 ── */

type Rule = [FileCategory, RegExp];

const NAME_RULES: Rule[] = [
  ["PI", /proforma|proform|\bp\.?i\b|形式发票/],
  ["LC", /\bl\/?c\b|letter of credit|documentary credit|信用证|\bmt ?700\b/],
  ["PAYMENT", /remittance|payment|bank ?slip|swift ?copy|\bmt ?103\b|水单|汇款|付款|回单|\btt\b/],
  ["BOOKING", /booking|shipping instruction|\bs\/?i\b|补料|订舱|托书|入仓/],
  ["BL", /bill of lading|\bb\/?l\b|\bbl\b|提单|电放|\bhbl\b|\bmbl\b|seaway/],
  ["CUSTOMS", /customs|declaration|报关|清关|申报要素/],
  ["CO", /origin|\bco\b|\bcoo\b|form ?[aefe]\b|原产地|产地证/],
  ["PL", /packing|\bp\.?l\b|装箱|唛头/],
  ["CI", /commercial|invoice|\bc\.?i\b|商业发票|发票/],
  ["PO", /purchase order|\bp\.?o\b|订单|采购单/],
  ["CONTRACT", /contract|agreement|\bs\/?c\b|合同|协议/],
  ["QUOTE", /quot|price ?list|offer|报价|价格表/],
  ["INSURANCE", /insurance|policy|保险/],
  ["INSPECTION", /inspection|\bqc\b|验货|商检|检验/],
  ["CERT", /certificat|test ?report|\bce\b|\bfda\b|\bsgs\b|\brohs\b|\biso\b|\bmsds\b|证书|检测|报告|认证/],
  ["CATALOG", /catalog|catalogue|brochure|datasheet|spec(ification)?s?\b|manual|目录|画册|规格书|说明书|参数/],
  ["DRAWING", /drawing|artwork|\bdwg\b|\bcad\b|design|图纸|设计|刀版|包装稿/],
];

/** 文件里的文字：标题一般在最前面，只看开头一段，免得正文里顺带提到的词误判 */
const TEXT_RULES: Rule[] = [
  ["PI", /PROFORMA\s+INVOICE|PROFORM\s+INVOICE|形式发票/],
  ["LC", /DOCUMENTARY\s+CREDIT|LETTER\s+OF\s+CREDIT|MT\s?700|:40A:|:31D:|信用证/],
  ["PAYMENT", /MT\s?103|:32A:[\s\S]*:50[AFK]:|REMITTANCE|PAYMENT\s+ADVICE|DEBIT\s+ADVICE|汇款|水单|付款回单/],
  ["BOOKING", /SHIPPING\s+INSTRUCTION|BOOKING\s+(CONFIRMATION|NOTE|REQUEST)|补料|订舱|托书/],
  ["BL", /BILL\s+OF\s+LADING|B\/L\s*NO|SEA\s?WAYBILL|提单/],
  ["CUSTOMS", /CUSTOMS\s+DECLARATION|报关单|出口货物报关|申报要素/],
  ["CO", /CERTIFICATE\s+OF\s+ORIGIN|原产地证/],
  ["INSURANCE", /INSURANCE\s+(POLICY|CERTIFICATE)|保险单/],
  ["PL", /PACKING\s+LIST|装箱单/],
  ["CI", /COMMERCIAL\s+INVOICE|商业发票|^\s*INVOICE\b/m],
  ["PO", /PURCHASE\s+ORDER|ORDER\s+CONFIRMATION|采购订单/],
  ["CONTRACT", /SALES\s+CONTRACT|PURCHASE\s+CONTRACT|AGREEMENT|合同/],
  ["QUOTE", /QUOTATION|PRICE\s+LIST|报价单/],
  ["INSPECTION", /INSPECTION\s+REPORT|验货报告|检验报告/],
  ["CERT", /TEST\s+REPORT|CERTIFICATE|检测报告|证书/],
  ["CATALOG", /CATALOGUE|CATALOG|DATASHEET|SPECIFICATION|USER\s+MANUAL|说明书/],
];

/** 从文件名（和文件里的文字）猜是哪种单据 */
export function guessCategory(
  name: string,
  mime = "",
  text?: string | null,
): FileCategory {
  // 「Xiamen YF Co., Ltd」里的 Co 不是原产地证
  const n = name
    .toLowerCase()
    .replace(/[_+]/g, " ")
    .replace(/\bco\.?,?\s*(ltd|limited|inc)\b/g, " ");
  for (const [c, re] of NAME_RULES) if (re.test(n)) return c;
  if (text) {
    const head = text.slice(0, 2500).toUpperCase();
    for (const [c, re] of TEXT_RULES) if (re.test(head)) return c;
  }
  if (fileKind(name, mime) === "image") return "PHOTO";
  return "OTHER";
}

export const fileSizeText = (n: number | null | undefined) =>
  n == null
    ? ""
    : n < 1024 * 1024
      ? `${Math.max(1, Math.round(n / 1024))} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** 预览接口（?preview=json）返回的内容 */
export type FilePreviewData =
  | {
      kind: "sheet";
      sheets: { name: string; rows: string[][]; truncated: boolean }[];
    }
  | { kind: "html"; html: string }
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "none"; message: string };
