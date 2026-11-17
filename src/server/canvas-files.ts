import "server-only";
import { tenantDb } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";
import { getCustomerForUser } from "@/server/customers";
import {
  attachmentSource,
  createGeneratedFile,
  extractText,
  fileForUser,
  pdfPageImages,
  readFileBuffer,
  type BuildInput,
} from "@/server/files";
import {
  FILE_CATEGORIES,
  fileCategoryLabel,
  fileKind,
  fileSizeText,
  isFileCategory,
} from "@/lib/files";
import type { ActionCard, AiActionKind } from "@/lib/ai-actions";

/*
 * AI 和文件：列文件、读文件（客户资料 / 用户发来的 / WhatsApp 文件 / 邮件附件）、生成新文件，
 * 以及改、删、存附件、把文件发给客户这几种要用户确认的操作。
 */

type P = Record<string, unknown>;
const str = (v: unknown, max = 5000) =>
  v == null ? "" : String(v).trim().slice(0, max);
const list = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 10);

/** 一轮里最多给模型看几张图（扫描件页面 + 图片文件） */
const IMAGE_MAX = 8;

/** 一次 read_file 给模型的文字长度；更长的用 offset 往后翻 */
const PAGE = 9000;

export async function listFilesTool(
  user: CurrentUser,
  a: { customerId?: string; query?: string; category?: string },
) {
  const db = tenantDb(user.tenantId);
  const q = str(a.query, 60);
  const where: Record<string, unknown> = {};
  if (a.customerId) {
    const c = await getCustomerForUser(user, a.customerId);
    if (!c) return { error: "客户不存在或没有权限" };
    where.customerId = c.customer.id;
  } else {
    // 没给客户：用户自己传的、AI 给他生成的文件
    where.createdById = user.id;
  }
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (isFileCategory(a.category)) where.category = a.category;
  const rows = await db.crmFile.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      id: true,
      name: true,
      category: true,
      size: true,
      textState: true,
      note: true,
      source: true,
      createdAt: true,
      customer: { select: { id: true, name: true } },
    },
  });
  return {
    files: rows.map((f) => ({
      fileId: f.id,
      name: f.name,
      category: fileCategoryLabel(f.category),
      size: fileSizeText(f.size),
      readable:
        f.textState === "ok"
          ? "有文字"
          : f.textState === "empty"
            ? "扫描件 / 图片，没有文字"
            : f.textState === "failed"
              ? "解析失败"
              : "不是文档",
      note: f.note,
      source: f.source,
      date: f.createdAt.toISOString().slice(0, 10),
      customer: f.customer
        ? `${f.customer.name}（${f.customer.id}）`
        : "未归档（只有用户自己能看）",
    })),
    note: rows.length
      ? undefined
      : a.customerId
        ? "这个客户还没有文件"
        : "用户还没有上传过文件",
  };
}

/**
 * 读文件：fileId（客户资料 / 用户发来的 / 生成的）、waMessageId（WhatsApp 里的文件）、mailId+attId（邮件附件）。
 * 图片放进 images，下一步给模型看。
 */
export async function readFileTool(
  user: CurrentUser,
  a: P,
  images: { url: string; note: string }[],
) {
  let name: string;
  let mime: string;
  let text: string | null;
  let state: string;
  let getBuf: () => Promise<Buffer>;
  let header: Record<string, unknown> = {};
  if (a.fileId) {
    const found = await fileForUser(user, str(a.fileId));
    if (!found) return { error: "文件不存在或没有权限" };
    const f = found.file;
    ({ name, mime, text, textState: state } = f);
    getBuf = () => readFileBuffer(f.key);
    header = {
      fileId: f.id,
      category: fileCategoryLabel(f.category),
      customer: found.customerName,
      note: f.note,
    };
  } else {
    const src = await attachmentSource(user, {
      waMessageId: str(a.waMessageId),
      mailId: str(a.mailId),
      attId: str(a.attId),
    });
    if (typeof src === "string") return { error: src };
    ({ name, mime } = src);
    const buf = src.buffer;
    getBuf = async () => buf;
    ({ text, state } = await extractText(buf, name, mime));
    header = {
      from: src.source === "whatsapp" ? "WhatsApp" : "邮件附件",
      note: "要存进客户资料就起草 save_attachment",
    };
  }
  const kind = fileKind(name, mime);
  // 扫描版 PDF（没有文字），或要看版面 / 印章 / 签名：按页渲染成裁好白边的图片
  if (kind === "pdf" && (!text || a.asImage === true || a.asImage === "true")) {
    const room = IMAGE_MAX - images.length;
    if (room <= 0) return { error: "这一轮看的图片太多了，先回答" };
    try {
      const { pages, total } = await pdfPageImages(await getBuf(), {
        from: Number(a.page) || 1,
        max: Math.min(4, room),
      });
      for (const p of pages)
        images.push({
          url: p.url,
          note: `「${name}」第 ${p.page} / ${total} 页`,
        });
      const last = pages.at(-1)?.page ?? 0;
      return {
        ...header,
        name,
        ok: true,
        scanned: !text,
        pages: `第 ${pages[0]?.page}～${last} 页，共 ${total} 页`,
        note: `页面图片会紧跟在工具结果后面给你，先认真读图上的文字、数字、印章${last < total ? `；后面还有，需要就用 page=${last + 1} 再读` : ""}`,
      };
    } catch (e) {
      console.error("[canvas-files] render pdf", e);
      return {
        ...header,
        name,
        error: "PDF 页面渲染失败（可能加密或损坏），请用户把要看的页面截图发来",
      };
    }
  }
  if (kind === "image") {
    if (images.length >= IMAGE_MAX)
      return { error: "这一轮看的图片太多了，先回答" };
    const buf = await getBuf();
    if (buf.length > 4_000_000) return { error: "图片太大，看不了" };
    const m = /^image\/(jpeg|png|webp|gif)$/.test(mime) ? mime : "image/jpeg";
    images.push({
      url: `data:${m};base64,${buf.toString("base64")}`,
      note: `文件「${name}」`,
    });
    return { ...header, name, ok: true, note: "图片会紧跟在工具结果后面给你" };
  }
  if (!text) {
    const why =
      state === "empty"
        ? "这个文件没有可读的文字。请用户把要看的内容截图发给你。"
        : state === "failed"
          ? "文件解析失败（可能损坏或是旧版 .doc / 加密文件），请用户另存为 PDF、docx 或 xlsx 再发。"
          : "这种文件（压缩包、视频等）读不了内容。";
    return { ...header, name, error: why };
  }
  const offset = Math.max(0, Number(a.offset) || 0);
  const chunk = text.slice(offset, offset + PAGE);
  const more = offset + PAGE < text.length;
  return {
    ...header,
    name,
    type: kind,
    length: text.length,
    content: chunk,
    ...(more
      ? {
          more: `还有 ${text.length - offset - PAGE} 字没给，需要就用 offset=${offset + PAGE} 再读`,
        }
      : {}),
  };
}

/** 生成新文件（AI 改好的报价单、PI、整理出的表格…）：先存成只有用户自己能看的草稿，再按需起草 update_file 归档 */
export async function createFileTool(user: CurrentUser, a: P) {
  const format = str(a.format).toLowerCase();
  if (!["xlsx", "csv", "docx", "txt", "md"].includes(format))
    return { error: "format 只能是 xlsx、csv、docx、txt、md" };
  let sheets: BuildInput["sheets"];
  if (format === "xlsx" || format === "csv") {
    const raw = typeof a.sheets === "string" ? safeJson(a.sheets) : a.sheets;
    if (!Array.isArray(raw))
      return { error: "sheets 要是数组：[{name, rows:[[表头...],[...]]}]" };
    sheets = raw.map((s: { name?: unknown; rows?: unknown }) => ({
      name: str(s?.name, 31),
      rows: Array.isArray(s?.rows) ? (s.rows as unknown[][]) : [],
    }));
  }
  const r = await createGeneratedFile(user, {
    format: format as BuildInput["format"],
    sheets,
    content: typeof a.content === "string" ? a.content : undefined,
    name: str(a.name, 120) || "AI 生成的文件",
    category: str(a.category) || null,
    note: str(a.note, 300) || null,
  });
  if (!r.ok) return { error: r.message };
  const f = (await fileForUser(user, r.fileId!))!.file;
  return {
    ok: true,
    file: { id: f.id, name: f.name, mime: f.mime, size: f.size },
  };
}

const safeJson = (s: string) => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
};

// ── 要用户确认的操作 ──

export const FILE_ACTION_KINDS = [
  "update_file",
  "delete_file",
  "send_file_whatsapp",
  "save_attachment",
] as const;
export const isFileActionKind = (
  k: string,
): k is (typeof FILE_ACTION_KINDS)[number] =>
  (FILE_ACTION_KINDS as readonly string[]).includes(k);

export async function prepareFileAction(
  user: CurrentUser,
  kind: AiActionKind,
  p: P,
): Promise<ActionCard | string> {
  switch (kind) {
    case "update_file": {
      const found = await fileForUser(user, str(p.fileId));
      if (!found) return "fileId 无效（先 list_files 找文件）";
      if (!found.edit) return "用户没有修改这个文件的权限";
      const f = found.file;
      const params: Record<string, string> = { fileId: f.id };
      const fields: ActionCard["fields"] = [{ label: "文件", value: f.name }];
      if (str(p.name)) params.name = str(p.name, 200);
      if (str(p.category)) {
        if (!isFileCategory(str(p.category)))
          return `category 取 ${FILE_CATEGORIES.map((c) => `${c.value}=${c.label}`).join("，")}`;
        params.category = str(p.category);
        fields.push({
          label: "分类",
          value: `${fileCategoryLabel(f.category)} → ${fileCategoryLabel(params.category)}`,
        });
      }
      if (p.note != null) params.note = str(p.note, 500);
      if (str(p.customerId) && str(p.customerId) !== f.customerId) {
        const c = await getCustomerForUser(user, str(p.customerId));
        if (!c?.access.edit) return "customerId 无效，或没有编辑这个客户的权限";
        params.customerId = c.customer.id;
        fields.push({ label: "存到客户", value: c.customer.name });
      }
      if (Object.keys(params).length === 1)
        return "没有要改的内容（可改 name、category、note、customerId）";
      return {
        kind,
        title:
          params.customerId && !f.customerId
            ? `把「${f.name}」存到客户资料`
            : `修改文件「${f.name}」`,
        fields,
        edit: [
          ...(params.name ? [{ key: "name", label: "新文件名" }] : []),
          ...(params.note != null ? [{ key: "note", label: "备注" }] : []),
        ],
        params,
        confirm: "保存",
      };
    }
    case "delete_file": {
      const found = await fileForUser(user, str(p.fileId));
      if (!found) return "fileId 无效（先 list_files 找文件）";
      if (!found.edit) return "用户没有删除这个文件的权限";
      const f = found.file;
      return {
        kind,
        title: `删除文件「${f.name}」`,
        fields: [
          { label: "分类", value: fileCategoryLabel(f.category) },
          { label: "所属客户", value: found.customerName ?? "未归档" },
        ],
        params: { fileId: f.id },
        confirm: "删除",
        danger: true,
      };
    }
    case "send_file_whatsapp": {
      if (!can(user, "whatsapp.use")) return "用户没有 WhatsApp 权限";
      const chat = await tenantDb(user.tenantId).waChat.findFirst({
        where: { id: str(p.chatId), account: { userId: user.id } },
      });
      if (!chat)
        return "chatId 无效（必须是用户自己的 WhatsApp 会话，先 customer_channels 或 list_whatsapp_chats）";
      const fileIds = list(p.fileIds ?? p.fileId);
      if (!fileIds.length) return "fileIds 不能为空（先 list_files 找文件）";
      const names: string[] = [];
      for (const id of fileIds) {
        const found = await fileForUser(user, id);
        if (!found) return `文件 ${id} 不存在或没有权限`;
        names.push(`${found.file.name}（${fileSizeText(found.file.size)}）`);
      }
      return {
        kind,
        title: `用 WhatsApp 发文件给 ${chat.name || (chat.phone ? `+${chat.phone}` : "对方")}`,
        fields: [
          {
            label: fileIds.length > 1 ? `文件（${fileIds.length} 个）` : "文件",
            value: names.join("\n"),
          },
        ],
        edit: [
          {
            key: "caption",
            label: "附言（随第一个文件发出）",
            multiline: true,
          },
        ],
        params: {
          chatId: chat.id,
          fileIds: fileIds.join(","),
          caption: str(p.caption ?? p.text, 1000),
        },
        confirm: "发送",
        outward: true,
      };
    }
    case "save_attachment": {
      const src = await attachmentSource(user, {
        waMessageId: str(p.waMessageId),
        mailId: str(p.mailId),
        attId: str(p.attId),
      });
      if (typeof src === "string") return src;
      const customerId = str(p.customerId) || src.customerId;
      if (!customerId) return "这个会话 / 邮件没关联客户，要给 customerId";
      const c = await getCustomerForUser(user, customerId);
      if (!c?.access.edit) return "customerId 无效，或没有编辑这个客户的权限";
      const category = isFileCategory(str(p.category)) ? str(p.category) : "";
      return {
        kind,
        title: `把「${src.name}」存到客户资料`,
        fields: [
          { label: "客户", value: c.customer.name },
          {
            label: "来自",
            value: src.source === "whatsapp" ? "WhatsApp" : "邮件附件",
          },
          ...(category
            ? [{ label: "分类", value: fileCategoryLabel(category) }]
            : []),
        ],
        params: {
          customerId: c.customer.id,
          waMessageId: str(p.waMessageId),
          mailId: str(p.mailId),
          attId: str(p.attId),
          category,
          note: str(p.note, 500),
        },
        confirm: "保存",
      };
    }
    default:
      return "未知的文件操作";
  }
}
