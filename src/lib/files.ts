/** 客户文件：分类、类型判断（前后端共用） */

export const FILE_CATEGORIES = [
  { value: "PI", label: "PI 形式发票" },
  { value: "CI", label: "CI 商业发票" },
  { value: "PL", label: "PL 装箱单" },
  { value: "CO", label: "CO 原产地证" },
  { value: "BL", label: "提单" },
  { value: "CONTRACT", label: "合同" },
  { value: "QUOTE", label: "报价" },
  { value: "CERT", label: "证书 / 检测报告" },
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
  "pdf" | "image" | "sheet" | "doc" | "text" | "video" | "audio" | "other";

const extOf = (name: string) =>
  /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? "";

/** 按扩展名和 MIME 判断怎么预览、怎么抽文字 */
export function fileKind(name: string, mime = ""): FileKind {
  const ext = extOf(name);
  const m = mime.toLowerCase();
  if (ext === "pdf" || m === "application/pdf") return "pdf";
  if (
    ["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext) ||
    m.startsWith("image/")
  )
    return "image";
  if (
    ["xlsx", "xls", "xlsm", "csv", "ods"].includes(ext) ||
    /spreadsheet|ms-excel|text\/csv/.test(m)
  )
    return "sheet";
  if (ext === "docx" || m.includes("wordprocessingml")) return "doc";
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

/** 能在线预览的类型 */
export const previewable = (name: string, mime = "") =>
  fileKind(name, mime) !== "other";

/** 从文件名猜分类（PI / CI / 装箱单 / 原产地证…） */
export function guessCategory(name: string, mime = ""): FileCategory {
  const n = name.toLowerCase();
  if (/proforma|\bpi\b|形式发票/.test(n)) return "PI";
  if (/packing|\bpl\b|装箱/.test(n)) return "PL";
  if (/origin|\bco\b|\bcoo\b|form ?[ae]\b|原产地/.test(n)) return "CO";
  if (/commercial|invoice|\bci\b|商业发票|发票/.test(n)) return "CI";
  if (/bill of lading|\bb\/?l\b|提单/.test(n)) return "BL";
  if (/contract|agreement|合同|协议/.test(n)) return "CONTRACT";
  if (/quot|price ?list|报价/.test(n)) return "QUOTE";
  if (/certificat|test report|\bce\b|\bfda\b|\bsgs\b|证书|检测|报告/.test(n))
    return "CERT";
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
