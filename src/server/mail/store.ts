import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR } from "@/server/uploads";

export type MailAddress = { name?: string | null; address: string };
export type MailAttachmentMeta = { id: string; filename: string; contentType: string; size: number };

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function attachmentPath(tenantId: string, id: string) {
  if (!/^[a-z0-9]+$/.test(id)) throw new Error("bad attachment id");
  return path.join(UPLOAD_DIR, tenantId, "mail", `${id}.bin`);
}

/** 把附件写到 UPLOAD_DIR/<tenantId>/mail/<id>.bin，返回元数据 */
export async function saveAttachment(
  tenantId: string,
  file: { filename?: string | null; contentType?: string | null; content: Buffer },
): Promise<MailAttachmentMeta> {
  const id = randomBytes(12).toString("hex");
  const p = attachmentPath(tenantId, id);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, file.content);
  return {
    id,
    filename: (file.filename || "attachment").slice(0, 200),
    contentType: file.contentType || "application/octet-stream",
    size: file.content.length,
  };
}

export function readAttachment(tenantId: string, id: string) {
  return readFile(attachmentPath(tenantId, id));
}

export function asAttachments(json: unknown): MailAttachmentMeta[] {
  return Array.isArray(json) ? (json as MailAttachmentMeta[]) : [];
}

export function asAddresses(json: unknown): MailAddress[] {
  return Array.isArray(json) ? (json as MailAddress[]) : [];
}

export function formatAddress(a: MailAddress) {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

/** HTML → 纯文本摘要 */
export function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function makeSnippet(text: string | null | undefined) {
  if (!text) return "";
  // 去掉引用的历史邮件
  const body = text.split(/\n(?:On .{5,200}wrote:|-{2,}\s*Original Message|发件人[:：]|From: )/)[0];
  return body.replace(/\s+/g, " ").trim().slice(0, 200);
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 纯文本正文 → 简单 HTML（保留换行，网址变链接） */
export function textToHtml(text: string) {
  const esc = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc}</div>`;
}
