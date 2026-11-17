"use client";

import { MAX_FILE_BYTES } from "@/lib/files";

/** 上传一个文件到 /api/upload/file（请求体就是文件本身）。不带 customerId = 给 AI 看的临时文件 */
export async function uploadCrmFile(
  file: File,
  opts: { customerId?: string; category?: string } = {},
) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`「${file.name}」超过 25MB`);
  const headers: Record<string, string> = {
    "x-file-name": encodeURIComponent(file.name),
    "content-type": file.type || "application/octet-stream",
  };
  if (opts.customerId) headers["x-customer-id"] = opts.customerId;
  if (opts.category) headers["x-category"] = opts.category;
  const r = await fetch("/api/upload/file", {
    method: "POST",
    headers,
    body: file,
  });
  const d = (await r.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    error?: string;
    textState?: string;
    mime?: string;
    size?: number;
  };
  if (!r.ok || !d.id) throw new Error(d.error || "上传失败");
  return d as {
    id: string;
    name: string;
    textState: string;
    mime: string;
    size: number;
  };
}
