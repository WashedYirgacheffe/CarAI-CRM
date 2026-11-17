import "server-only";
import { randomBytes } from "node:crypto";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { prisma, tenantDb } from "@/server/db";
import type { CurrentUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import { deleteObject, getObject, putObject } from "@/server/storage";
import { asAttachments, attachmentKeyOf, readAttachment } from "@/server/mail/store";
import { officeAvailable, officeToPdf } from "@/server/office";
import {
  fileKind,
  guessCategory,
  isFileCategory,
  isOfficeFile,
  MAX_FILE_BYTES,
  type FilePreviewData,
} from "@/lib/files";

/*
 * 客户文件（PI、CI、CO、合同…）和发给 AI 看的文件：
 * 存到 <tenantId>/files/<随机名>.<扩展名>；上传时顺手抽出文字，AI 读文件、搜索都用这份文字。
 * 读取一律先过 fileForUser 的权限校验：挂在客户下的跟着客户权限走，没挂客户的只有上传人能看。
 */

/** 存给 AI 看的文字上限（约 2 万个英文词） */
const TEXT_MAX = 120_000;

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  md: "text/markdown",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  zip: "application/zip",
};

export const extOf = (name: string) =>
  /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
/** 浏览器给的 MIME 常常是空的或 octet-stream：按扩展名补上 */
export const mimeOf = (name: string, given?: string | null) => {
  const g = (given ?? "").split(";")[0].trim().toLowerCase();
  return g && g !== "application/octet-stream"
    ? g
    : (EXT_MIME[extOf(name)] ?? "application/octet-stream");
};
export const cleanName = (name: string) =>
  name
    .replace(/[\\/\r\n\t\0]/g, "_")
    .trim()
    .slice(0, 200) || "file";

// ── 抽文字 ──

async function pdfToText(buf: Buffer) {
  const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const r = await pdfText(pdf, { mergePages: false });
  return r.text
    .map((t, i) => (r.totalPages > 1 ? `--- 第 ${i + 1} 页 ---\n${t}` : t))
    .join("\n\n");
}

/**
 * 抽文字。旧版 .doc、PPT、WPS、Pages 这些读不了的，先用 LibreOffice 转成 PDF 再抽；
 * 转出来的 PDF 一并返回，调用方存起来给预览用。
 */
export async function extractText(
  buf: Buffer,
  name: string,
  mime: string,
): Promise<{ text: string | null; state: string; pdf?: Buffer }> {
  const kind = fileKind(name, mime);
  let pdf: Buffer | undefined;
  try {
    let text = "";
    const viaOffice = async () => {
      pdf = (await officeToPdf(buf, name)) ?? undefined;
      if (!pdf) throw new Error("office convert failed");
      return pdfToText(pdf);
    };
    if (kind === "pdf") {
      text = await pdfToText(buf);
    } else if (kind === "sheet") {
      try {
        const wb = XLSX.read(buf, {
          type: "buffer",
          cellDates: true,
          dense: true,
        });
        text = wb.SheetNames.map(
          (n) =>
            `## 工作表：${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t", blankrows: false })}`,
        ).join("\n\n");
      } catch {
        text = await viaOffice();
      }
    } else if (kind === "doc" && /\.docx$/i.test(name)) {
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } else if (kind === "doc" || kind === "slides") {
      text = await viaOffice();
    } else if (kind === "text") {
      text = buf.toString("utf8");
      if (/\.(html?|xml)$/i.test(name))
        text = text
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
          .replace(/<[^>]+>/g, " ");
    } else return { text: null, state: "skip" };
    text = text
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.replace(/\s|-|第 \d+ 页/g, "").length < 10)
      return { text: null, state: "empty", pdf };
    return { text: text.slice(0, TEXT_MAX), state: "ok", pdf };
  } catch (e) {
    console.error("[files] extract", name, e instanceof Error ? e.message : e);
    return { text: null, state: "failed", pdf };
  }
}

// ── 原样预览用的 PDF、缩略图：算一次存起来（和原文件放一起，key 后面加后缀） ──

const pdfKeyOf = (key: string) => `${key}.preview.pdf`;
const thumbKeyOf = (key: string) => `${key}.thumb.jpg`;
/** 转换失败的记号：免得每次打开都再转一遍 */
const failKeyOf = (key: string, what: "pdf" | "thumb") => `${key}.${what}.none`;

const tryGet = (key: string) => getObject(key).catch(() => null);

/**
 * 原样预览的 PDF：PDF 就是自己；Excel / Word / PPT 用 LibreOffice 转（存起来下次直接用）；别的返回 null
 */
export async function previewPdf(
  key: string,
  name: string,
  mime: string,
  buf?: Buffer,
): Promise<Buffer | null> {
  if (fileKind(name, mime) === "pdf") return buf ?? getObject(key);
  if (!isOfficeFile(name, mime)) return null;
  const cached = await tryGet(pdfKeyOf(key));
  if (cached) return cached;
  if (await tryGet(failKeyOf(key, "pdf"))) return null;
  const pdf = await officeToPdf(buf ?? (await getObject(key)), name);
  if (pdf) await putObject(pdfKeyOf(key), pdf, { contentType: "application/pdf" });
  // 没装 LibreOffice 时不记失败：装上以后还能转
  else if (officeAvailable()) await putObject(failKeyOf(key, "pdf"), Buffer.from("1"), { contentType: "text/plain" });
  return pdf;
}

/** 缩略图（列表里像访达那样一眼认出是哪张单据）：PDF / Office 取第一页，图片缩小；做不了返回 null */
export async function thumbnail(
  key: string,
  name: string,
  mime: string,
): Promise<Buffer | null> {
  const cached = await tryGet(thumbKeyOf(key));
  if (cached) return cached;
  if (await tryGet(failKeyOf(key, "thumb"))) return null;
  const kind = fileKind(name, mime);
  let jpg: Buffer | null = null;
  try {
    if (kind === "image") {
      const canvas = await import("@napi-rs/canvas");
      const img = await canvas.loadImage(await getObject(key));
      const k = Math.min(1, 480 / Math.max(img.width, img.height));
      const c = canvas.createCanvas(
        Math.max(1, Math.round(img.width * k)),
        Math.max(1, Math.round(img.height * k)),
      );
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      jpg = Buffer.from(await c.encode("jpeg", 80));
    } else if (kind === "pdf" || isOfficeFile(name, mime)) {
      const pdf = await previewPdf(key, name, mime);
      if (pdf) {
        const { pages } = await pdfPageImages(pdf, {
          max: 1,
          crop: false,
          side: 480,
          render: 960,
        });
        if (pages[0])
          jpg = Buffer.from(pages[0].url.split(",")[1], "base64");
      }
    }
  } catch (e) {
    console.error("[files] thumb", name, e instanceof Error ? e.message : e);
  }
  if (jpg) await putObject(thumbKeyOf(key), jpg, { contentType: "image/jpeg" });
  else if (kind === "pdf" || kind === "image" || (isOfficeFile(name, mime) && officeAvailable()))
    await putObject(failKeyOf(key, "thumb"), Buffer.from("1"), { contentType: "text/plain" });
  return jpg;
}

/** 删文件时把预览 PDF、缩略图一起删掉 */
async function deleteDerived(key: string) {
  await Promise.all(
    [pdfKeyOf(key), thumbKeyOf(key), failKeyOf(key, "pdf"), failKeyOf(key, "thumb")].map((k) =>
      deleteObject(k).catch(() => {}),
    ),
  );
}

/**
 * 以前存的文件没抽到文字（旧版 .doc、PPT…，当时还不能转）：现在再试一次，抽到了顺手改分类
 */
export async function ensureFileText<
  T extends { id: string; key: string; name: string; mime: string; text: string | null; textState: string; category: string },
>(file: T): Promise<T> {
  if (file.text || !isOfficeFile(file.name, file.mime) || file.textState === "empty") return file;
  const pdf = await previewPdf(file.key, file.name, file.mime);
  if (!pdf) return file;
  let text: string | null = null;
  try {
    text = (await pdfToText(pdf)).replace(/\n{3,}/g, "\n\n").trim().slice(0, TEXT_MAX);
  } catch {}
  const ok = !!text && text.replace(/\s|-|第 \d+ 页/g, "").length >= 10;
  const category =
    file.category === "OTHER" ? guessCategory(file.name, file.mime, text) : file.category;
  await prisma.crmFile.update({
    where: { id: file.id },
    data: { text: ok ? text : null, textState: ok ? "ok" : "empty", category },
  });
  return { ...file, text: ok ? text : null, textState: ok ? "ok" : "empty", category };
}

// ── 扫描版 PDF：每页渲染成图片、裁掉白边，给 AI 看 ──

/** 给模型的图片长边：再大模型也会缩，白占流量 */
const PAGE_SIDE = 1568;

export type PdfPageImage = { url: string; page: number };

/**
 * 把 PDF 的第 from 页起最多 max 页渲染成 JPEG（data URL）。先按约 2 倍清晰度渲染，
 * 再把四周的白边裁掉（扫描件常有大片空白，裁掉后字更大、更好认），最后缩到长边 1568。
 */
export async function pdfPageImages(
  buf: Buffer,
  opts: { from?: number; max?: number; crop?: boolean; side?: number; render?: number } = {},
): Promise<{ pages: PdfPageImage[]; total: number }> {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const canvas = await import("@napi-rs/canvas");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const total = pdf.numPages;
  const from = Math.min(Math.max(1, Math.floor(opts.from ?? 1)), total);
  const to = Math.min(total, from + Math.max(1, opts.max ?? 4) - 1);
  const pages: PdfPageImage[] = [];
  for (let n = from; n <= to; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    // 按长边 2400 渲染（A4 约 2.8 倍），小票、名片这类小页面最多放大 4 倍
    const scale = Math.min(4, (opts.render ?? 2400) / Math.max(vp.width, vp.height));
    const png = await renderPageAsImage(pdf, n, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale,
    });
    const img = await canvas.loadImage(Buffer.from(png));
    const box =
      opts.crop === false
        ? { x: 0, y: 0, w: img.width, h: img.height }
        : contentBox(img, canvas);
    const k = Math.min(1, (opts.side ?? PAGE_SIDE) / Math.max(box.w, box.h));
    const out = canvas.createCanvas(
      Math.max(1, Math.round(box.w * k)),
      Math.max(1, Math.round(box.h * k)),
    );
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
    const jpg = await out.encode("jpeg", 82);
    pages.push({
      url: `data:image/jpeg;base64,${Buffer.from(jpg).toString("base64")}`,
      page: n,
    });
  }
  return { pages, total };
}

/** 找出页面上有内容的范围（四周近白色的行列裁掉，留一点边） */
function contentBox(
  img: import("@napi-rs/canvas").Image,
  canvas: typeof import("@napi-rs/canvas"),
) {
  const W = img.width;
  const H = img.height;
  // 缩小到 1/4 来找边界，快很多
  const s = 4;
  const w = Math.max(1, Math.floor(W / s));
  const h = Math.max(1, Math.floor(H / s));
  const c = canvas.createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const ink = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return d[i] < 225 || d[i + 1] < 225 || d[i + 2] < 225;
  };
  // 一行 / 一列里有几个深色点才算有内容，过滤扫描噪点
  const minInk = 3;
  const rowHas = (y: number) => {
    let n = 0;
    for (let x = 0; x < w; x++) if (ink(x, y) && ++n >= minInk) return true;
    return false;
  };
  const colHas = (x: number, y0: number, y1: number) => {
    let n = 0;
    for (let y = y0; y <= y1; y++) if (ink(x, y) && ++n >= minInk) return true;
    return false;
  };
  let top = 0;
  while (top < h - 1 && !rowHas(top)) top++;
  let bottom = h - 1;
  while (bottom > top && !rowHas(bottom)) bottom--;
  let left = 0;
  while (left < w - 1 && !colHas(left, top, bottom)) left++;
  let right = w - 1;
  while (right > left && !colHas(right, top, bottom)) right--;
  // 整页空白，或几乎没裁掉什么：用整页
  if (bottom - top < 4 || right - left < 4) return { x: 0, y: 0, w: W, h: H };
  const pad = 6;
  const x = Math.max(0, (left - pad) * s);
  const y = Math.max(0, (top - pad) * s);
  return {
    x,
    y,
    w: Math.min(W, (right + pad + 1) * s) - x,
    h: Math.min(H, (bottom + pad + 1) * s) - y,
  };
}

// ── 保存 / 读取 ──

export async function saveFile(
  user: CurrentUser,
  f: {
    customerId: string | null;
    name: string;
    mime?: string | null;
    buffer: Buffer;
    category?: string | null;
    source: string;
    note?: string | null;
  },
) {
  if (f.buffer.length > MAX_FILE_BYTES) throw new Error("文件不能超过 25MB");
  const name = cleanName(f.name);
  const mime = mimeOf(name, f.mime);
  const ext = extOf(name) || "bin";
  const key = `${user.tenantId}/files/${Date.now().toString(36)}${randomBytes(8).toString("hex")}.${ext}`;
  await putObject(key, f.buffer, { contentType: mime });
  const { text, state, pdf } = await extractText(f.buffer, name, mime);
  if (pdf) await putObject(pdfKeyOf(key), pdf, { contentType: "application/pdf" }).catch(() => {});
  // 缩略图在后台先做好，打开列表时就有
  void thumbnail(key, name, mime).catch(() => {});
  return prisma.crmFile.create({
    data: {
      tenantId: user.tenantId,
      customerId: f.customerId,
      category: isFileCategory(f.category)
        ? f.category
        : guessCategory(name, mime, text),
      name,
      mime,
      size: f.buffer.length,
      key,
      text,
      textState: state,
      note: f.note?.trim().slice(0, 500) || null,
      source: f.source,
      createdById: user.id,
    },
  });
}

/** 能看这个文件吗；edit = 能改名、删除、发出去 */
export async function fileForUser(user: CurrentUser, id: string) {
  if (!id) return null;
  const file = await tenantDb(user.tenantId).crmFile.findFirst({
    where: { id },
  });
  if (!file) return null;
  if (!file.customerId)
    return file.createdById === user.id
      ? { file, edit: true, customerName: null as string | null }
      : null;
  const found = await getCustomerForUser(user, file.customerId);
  if (!found) return null;
  return { file, edit: found.access.edit, customerName: found.customer.name };
}

export const readFileBuffer = (key: string) => getObject(key);

// ── 在线预览 ──

const ROW_MAX = 1000;
const COL_MAX = 60;

export async function previewData(
  buf: Buffer,
  name: string,
  mime: string,
): Promise<FilePreviewData> {
  const kind = fileKind(name, mime);
  try {
    if (kind === "sheet") {
      const wb = XLSX.read(buf, {
        type: "buffer",
        cellDates: true,
        dense: true,
      });
      return {
        kind: "sheet",
        sheets: wb.SheetNames.slice(0, 20).map((n) => {
          const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], {
            header: 1,
            raw: false,
            defval: "",
            blankrows: false,
          });
          return {
            name: n,
            rows: rows
              .slice(0, ROW_MAX)
              .map((r) => r.slice(0, COL_MAX).map((c) => String(c ?? ""))),
            truncated: rows.length > ROW_MAX,
          };
        }),
      };
    }
    if (kind === "doc") {
      const { value } = await mammoth.convertToHtml({ buffer: buf });
      return { kind: "html", html: value };
    }
    if (kind === "text") {
      const text = buf.toString("utf8");
      return {
        kind: "text",
        text: text.slice(0, 300_000),
        truncated: text.length > 300_000,
      };
    }
    return { kind: "none", message: "这种文件不能在线预览，请下载后打开" };
  } catch (e) {
    console.error("[files] preview", name, e instanceof Error ? e.message : e);
    return {
      kind: "none",
      message: "文件打不开（可能已损坏或是旧版格式），请下载后查看",
    };
  }
}

/**
 * 预览接口（调用方已做完权限校验）：
 * - ?preview=raw   原样返回（图片、视频、音频；PDF 也行）。从我们自己的域名内嵌，不跳 OSS 链接（OSS 默认域名会强制下载）
 * - ?preview=pdf   原样预览用的 PDF：PDF 本身，或 Excel / Word / PPT 转出来的
 * - ?preview=pages 上面这个 PDF 有几页；?preview=page&n=1 某一页的图片（浏览器不能内嵌 PDF 时用：桌面版、安卓）
 * - ?preview=thumb 缩略图
 * - ?preview=json  表格 / Word / 文本的内容（数据视图）
 */
export async function previewResponse(
  mode: string,
  key: string,
  name: string,
  mime: string,
  page?: string | null,
) {
  if (mode === "thumb") {
    const jpg = await thumbnail(key, name, mime);
    if (!jpg) return new Response("No thumbnail", { status: 404, headers: { "Cache-Control": "private, max-age=600" } });
    return new Response(new Uint8Array(jpg), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
    });
  }
  if (mode === "pdf" || mode === "pages" || mode === "page") {
    try {
      const pdf = await previewPdf(key, name, mime);
      if (!pdf) return new Response("不能转成 PDF", { status: 415 });
      if (mode === "pdf")
        return new Response(new Uint8Array(pdf), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name.replace(/\.[a-z0-9]{1,8}$/i, "") + ".pdf")}`,
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
          },
        });
      if (mode === "pages") {
        const { getDocumentProxy } = await import("unpdf");
        const doc = await getDocumentProxy(new Uint8Array(pdf));
        return Response.json(
          { total: doc.numPages },
          { headers: { "Cache-Control": "private, max-age=3600" } },
        );
      }
      const { pages } = await pdfPageImages(pdf, {
        from: Number(page) || 1,
        max: 1,
        crop: false,
        side: 1800,
      });
      if (!pages[0]) return new Response("Not found", { status: 404 });
      return new Response(
        new Uint8Array(Buffer.from(pages[0].url.split(",")[1], "base64")),
        {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, max-age=86400",
          },
        },
      );
    } catch (e) {
      console.error("[files] render page", name, e);
      return new Response("Render failed", { status: 500 });
    }
  }
  const buf = await getObject(key);
  if (mode === "json")
    return Response.json(await previewData(buf, name, mime), {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  const kind = fileKind(name, mime);
  // 只内嵌安全的类型；HTML 之类按纯文本给，免得在我们的域名下执行脚本
  const type =
    kind === "pdf"
      ? "application/pdf"
      : kind === "image" || kind === "video" || kind === "audio"
        ? mime
        : "text/plain; charset=utf-8";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  // Chrome 不在 sandbox 里渲染 PDF，所以只给纯文本兜底加
  if (type.startsWith("text/"))
    headers["Content-Security-Policy"] = "sandbox; default-src 'none'";
  return new Response(new Uint8Array(buf), { headers });
}

// ── AI 生成文件（改出来的新版本） ──

export type BuildInput = {
  format: "xlsx" | "csv" | "docx" | "txt" | "md";
  /** xlsx / csv：每张表一组行 */
  sheets?: { name?: string; rows: unknown[][] }[];
  /** docx / txt / md：正文（docx 支持 # 标题、- 列表、| 表格 |、**加粗**） */
  content?: string;
};

export async function buildFile(
  input: BuildInput,
): Promise<{ buffer: Buffer; mime: string } | string> {
  const { format } = input;
  if (format === "xlsx" || format === "csv") {
    const sheets = (input.sheets ?? [])
      .filter((s) => Array.isArray(s?.rows) && s.rows.length)
      .slice(0, 20);
    if (!sheets.length)
      return "sheets 至少要有一张表，每张表 rows 是二维数组（第一行是表头）";
    const cell = (v: unknown) =>
      typeof v === "number" || typeof v === "boolean"
        ? v
        : v == null
          ? ""
          : String(v).slice(0, 32000);
    const wb = XLSX.utils.book_new();
    const used = new Set<string>();
    for (const [i, s] of sheets.entries()) {
      const rows = s.rows
        .slice(0, 20000)
        .map((r) => (Array.isArray(r) ? r.slice(0, 200).map(cell) : [cell(r)]));
      const ws = XLSX.utils.aoa_to_sheet(rows);
      // 列宽按内容大概算一下
      const widths: number[] = [];
      for (const r of rows.slice(0, 200))
        r.forEach(
          (c, j) =>
            (widths[j] = Math.min(
              60,
              Math.max(widths[j] ?? 8, String(c).length + 2),
            )),
        );
      ws["!cols"] = widths.map((w) => ({ wch: w }));
      let n =
        (s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) ||
        `Sheet${i + 1}`;
      while (used.has(n)) n = `${n.slice(0, 28)}_${i}`;
      used.add(n);
      XLSX.utils.book_append_sheet(wb, ws, n);
    }
    if (format === "csv")
      return {
        buffer: Buffer.from(
          "﻿" + XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]),
          "utf8",
        ),
        mime: "text/csv",
      };
    return {
      buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer,
      mime: EXT_MIME.xlsx,
    };
  }
  const content = String(input.content ?? "").slice(0, 200_000);
  if (!content.trim()) return "content（正文）不能为空";
  if (format === "txt" || format === "md")
    return {
      buffer: Buffer.from(content, "utf8"),
      mime: format === "md" ? "text/markdown" : "text/plain",
    };
  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 21 } } } },
    sections: [{ children: markdownToDocx(content) }],
  });
  return { buffer: await Packer.toBuffer(doc), mime: EXT_MIME.docx };
}

/** 一行里的 **加粗** */
function runs(line: string, bold = false) {
  return line
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((t) =>
      t.startsWith("**") && t.endsWith("**")
        ? new TextRun({ text: t.slice(2, -2), bold: true })
        : new TextRun({ text: t, bold }),
    );
}

function markdownToDocx(md: string) {
  const out: (Paragraph | Table)[] = [];
  const lines = md.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 表格：连续的 | a | b | 行，跳过 |---| 分隔行
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i]))
          rows.push(
            lines[i]
              .trim()
              .slice(1, -1)
              .split("|")
              .map((c) => c.trim()),
          );
        i++;
      }
      i--;
      const cols = Math.max(...rows.map((r) => r.length));
      out.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(
            (r, ri) =>
              new TableRow({
                children: Array.from(
                  { length: cols },
                  (_, ci) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: runs(r[ci] ?? "", ri === 0),
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
      ][h[1].length - 1];
      out.push(
        new Paragraph({
          heading: level,
          children: runs(h[2]),
          alignment: h[1].length === 1 ? AlignmentType.CENTER : undefined,
        }),
      );
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      out.push(new Paragraph({ bullet: { level: 0 }, children: runs(li[1]) }));
      continue;
    }
    out.push(new Paragraph({ children: runs(line) }));
  }
  return out;
}

// ── 改、删、存附件、生成：页面和 AI 共用，返回给人看的结果 ──

type Done =
  | { ok: true; message: string; fileId?: string; customerId?: string | null }
  | { ok: false; message: string };

/** 改名、改分类、改备注，或把给 AI 的临时文件挂到客户名下 */
export async function updateFile(
  user: CurrentUser,
  id: string,
  patch: {
    name?: string | null;
    category?: string | null;
    note?: string | null;
    customerId?: string | null;
  },
): Promise<Done> {
  const found = await fileForUser(user, id);
  if (!found) return { ok: false, message: "文件不存在或没有权限" };
  if (!found.edit) return { ok: false, message: "没有修改这个文件的权限" };
  const data: {
    name?: string;
    category?: string;
    note?: string | null;
    customerId?: string;
  } = {};
  if (patch.name?.trim()) {
    let name = cleanName(patch.name);
    // 没写扩展名就沿用原来的，免得改完打不开
    const ext = extOf(found.file.name);
    if (ext && !extOf(name)) name = `${name}.${ext}`;
    data.name = name;
  }
  if (patch.category) {
    if (!isFileCategory(patch.category))
      return { ok: false, message: "分类不对" };
    data.category = patch.category;
  }
  if (patch.note !== undefined && patch.note !== null)
    data.note = patch.note.trim().slice(0, 500) || null;
  if (patch.customerId && patch.customerId !== found.file.customerId) {
    const c = await getCustomerForUser(user, patch.customerId);
    if (!c?.access.edit)
      return { ok: false, message: "客户不存在或没有编辑权限" };
    data.customerId = c.customer.id;
  }
  if (!Object.keys(data).length)
    return { ok: false, message: "没有要改的内容" };
  const f = await prisma.crmFile.update({ where: { id: found.file.id }, data });
  return {
    ok: true,
    message: data.customerId ? "已存到客户资料" : "文件已更新",
    fileId: f.id,
    customerId: f.customerId,
  };
}

export async function deleteFile(user: CurrentUser, id: string): Promise<Done> {
  const found = await fileForUser(user, id);
  if (!found) return { ok: false, message: "文件不存在或没有权限" };
  if (!found.edit) return { ok: false, message: "没有删除这个文件的权限" };
  await prisma.crmFile.delete({ where: { id: found.file.id } });
  await deleteObject(found.file.key).catch((e) =>
    console.error("[files] delete object", e),
  );
  await deleteDerived(found.file.key);
  return {
    ok: true,
    message: `已删除「${found.file.name}」`,
    customerId: found.file.customerId,
  };
}

/** WhatsApp 收到的文件 / 邮件附件：读出原文件（带权限校验） */
export async function attachmentSource(
  user: CurrentUser,
  src: {
    waMessageId?: string | null;
    mailId?: string | null;
    attId?: string | null;
  },
): Promise<
  | {
      name: string;
      mime: string;
      buffer: Buffer;
      /** 存储里的 key（转 PDF、缩略图的缓存跟着它） */
      key: string;
      source: string;
      customerId: string | null;
    }
  | string
> {
  const db = tenantDb(user.tenantId);
  if (src.waMessageId) {
    const m = await db.waMessage.findFirst({
      where: { id: src.waMessageId },
      select: {
        mediaKey: true,
        mediaMime: true,
        mediaName: true,
        type: true,
        account: { select: { userId: true } },
        chat: { select: { customerId: true } },
      },
    });
    if (!m?.mediaKey) return "这条 WhatsApp 消息没有文件";
    const ok =
      m.account.userId === user.id ||
      (m.chat.customerId &&
        (await getCustomerForUser(user, m.chat.customerId)));
    if (!ok) return "没有权限查看这条消息";
    const mime = m.mediaMime ?? "application/octet-stream";
    const ext =
      Object.entries(EXT_MIME).find(([, v]) => v === mime)?.[0] ?? "bin";
    return {
      name: m.mediaName || `whatsapp-${m.type}.${ext}`,
      mime,
      buffer: await getObject(m.mediaKey),
      key: m.mediaKey,
      source: "whatsapp",
      customerId: m.chat.customerId,
    };
  }
  if (src.mailId && src.attId) {
    const m = await db.mailMessage.findFirst({
      where: { id: src.mailId },
      include: { account: { select: { userId: true } } },
    });
    if (!m) return "邮件不存在";
    const ok =
      m.account.userId === user.id ||
      (m.customerId && (await getCustomerForUser(user, m.customerId)));
    if (!ok) return "没有权限查看这封邮件";
    const att = asAttachments(m.attachments).find((a) => a.id === src.attId);
    if (!att) return "邮件里没有这个附件";
    return {
      name: att.filename,
      mime: att.contentType,
      buffer: await readAttachment(user.tenantId, att.id),
      key: attachmentKeyOf(user.tenantId, att.id),
      source: "mail",
      customerId: m.customerId,
    };
  }
  return "要给 waMessageId，或 mailId + attId";
}

/** 把 WhatsApp 文件 / 邮件附件存进客户资料 */
export async function saveAttachment(
  user: CurrentUser,
  p: {
    customerId?: string | null;
    waMessageId?: string | null;
    mailId?: string | null;
    attId?: string | null;
    category?: string | null;
    note?: string | null;
  },
): Promise<Done> {
  const src = await attachmentSource(user, p);
  if (typeof src === "string") return { ok: false, message: src };
  const customerId = p.customerId || src.customerId;
  if (!customerId)
    return { ok: false, message: "这个会话还没关联客户，请先选一个客户" };
  const c = await getCustomerForUser(user, customerId);
  if (!c?.access.edit)
    return { ok: false, message: "客户不存在或没有编辑权限" };
  if (src.buffer.length > MAX_FILE_BYTES)
    return { ok: false, message: "文件超过 25MB，不能存进客户资料" };
  const f = await saveFile(user, {
    customerId: c.customer.id,
    name: src.name,
    mime: src.mime,
    buffer: src.buffer,
    category: p.category,
    source: src.source,
    note: p.note,
  });
  return {
    ok: true,
    message: `已存到「${c.customer.name}」的资料`,
    fileId: f.id,
    customerId: f.customerId,
  };
}

/** AI 按内容生成一个新文件（新报价单、改过的 PI…）；不挂客户时是只有自己能看的临时文件 */
export async function createGeneratedFile(
  user: CurrentUser,
  p: BuildInput & {
    name: string;
    customerId?: string | null;
    category?: string | null;
    note?: string | null;
  },
): Promise<Done> {
  if (p.customerId) {
    const c = await getCustomerForUser(user, p.customerId);
    if (!c?.access.edit)
      return { ok: false, message: "客户不存在或没有编辑权限" };
  }
  const built = await buildFile(p);
  if (typeof built === "string") return { ok: false, message: built };
  let name = cleanName(p.name || "file").replace(/\.[a-z0-9]{1,8}$/i, "");
  name = `${name}.${p.format}`;
  const f = await saveFile(user, {
    customerId: p.customerId || null,
    name,
    mime: built.mime,
    buffer: built.buffer,
    category: p.category,
    source: "ai",
    note: p.note,
  });
  return {
    ok: true,
    message: `已生成「${f.name}」`,
    fileId: f.id,
    customerId: f.customerId,
  };
}
