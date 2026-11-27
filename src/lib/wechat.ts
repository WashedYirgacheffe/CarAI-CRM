// 微信前后端共用常量、状态文案、精准搜索锚点与粘贴聊天记录解析器

export const WX_SYNC_STATUS_LABEL: Record<string, string> = {
  DISCONNECTED: "未连接桌面端",
  READY: "桌面端已就绪",
  SYNCING: "本地只读同步中",
  ERROR: "同步异常（仍可半自动上屏）",
};

export const WX_MSG_STATUS_LABEL: Record<string, string> = {
  STAGED: "已上屏，待在微信按回车发送",
  SENT: "已发送",
  UNCONFIRMED: "超时未确认发出",
  RECEIVED: "已收到",
  FAILED: "上屏失败",
};

export const WX_SYNC_MODES = [
  { value: "whitelist", label: "白名单模式（推荐，保护私人聊天）", desc: "仅同步备注带指定前缀、已在 CRM 关联或手动开启同步的客户会话" },
  { value: "all", label: "全量模式", desc: "同步该微信账号下所有近期会话（适合纯公司工作微信）" },
] as const;

/** 半自动一键上屏时，定位联系人的最高优先级搜索词：微信号 > 精确备注 > 昵称 */
export function resolveWechatSearchKey(chat: { wechatNo?: string | null; remark?: string | null; name?: string | null }): {
  key: string;
  kind: "wechatNo" | "remark" | "name" | "none";
  label: string;
} {
  const wechatNo = chat.wechatNo?.trim();
  if (wechatNo) return { key: wechatNo, kind: "wechatNo", label: "微信号（精准）" };
  const remark = chat.remark?.trim();
  if (remark) return { key: remark, kind: "remark", label: "备注名（精准）" };
  const name = chat.name?.trim();
  if (name) return { key: name, kind: "name", label: "昵称（建议补充微信号防重名）" };
  return { key: "", kind: "none", label: "未设置搜索锚点" };
}

export function wechatDisplayName(chat: { remark?: string | null; name?: string | null; wechatNo?: string | null; wxKey?: string }) {
  return chat.remark?.trim() || chat.name?.trim() || chat.wechatNo?.trim() || chat.wxKey || "未知微信联系人";
}

export type ParsedWechatLine = {
  fromMe: boolean;
  senderName?: string;
  text: string;
  at?: number;
};

/**
 * 解析从 PC/Mac 微信复制出来的多条聊天记录：
 * 典型格式：
 *   张三 2026-11-27 10:20:30
 *   你好，这款车型的 FOB 报价是多少？
 *
 *   我 2026-11-27 10:21:05
 *   您好，稍等发您最新报价单。
 *
 * 如果无法识别头行格式，则按整段文本作为 1 条消息返回。
 */
export function parsePastedWechatLog(raw: string, options?: { myName?: string | null; defaultFromMe?: boolean }): ParsedWechatLine[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const myName = options?.myName?.trim().toLowerCase() || "";
  const headerRe = /^(.+?)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}(?::\d{2})?)\s*:?$/;
  const lines = text.split("\n");
  const blocks: { sender: string; timeStr: string; body: string[] }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const m = headerRe.exec(trimmed);
    if (m && m[1].length <= 60) {
      blocks.push({ sender: m[1].trim(), timeStr: m[2].trim(), body: [] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].body.push(line);
    }
  }

  if (blocks.length > 0) {
    const out: ParsedWechatLine[] = [];
    for (const b of blocks) {
      const content = b.body.join("\n").trim();
      if (!content) continue;
      const lower = b.sender.toLowerCase();
      const fromMe =
        lower === "我" ||
        lower === "me" ||
        lower === "myself" ||
        (!!myName && lower === myName);
      const parsedTime = parseWechatTimestamp(b.timeStr);
      out.push({
        fromMe,
        senderName: fromMe ? undefined : b.sender,
        text: content,
        at: parsedTime ?? undefined,
      });
    }
    if (out.length > 0) return out;
  }

  return [
    {
      fromMe: options?.defaultFromMe ?? false,
      text,
      at: Date.now(),
    },
  ];
}

function parseWechatTimestamp(timeStr: string): number | null {
  if (/^\d{1,2}:\d{2}/.test(timeStr)) {
    const now = new Date();
    const [hh, mm, ss = "0"] = timeStr.split(":");
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(hh), Number(mm), Number(ss));
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  const normalized = timeStr.replace(/\//g, "-").replace(" ", "T");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
