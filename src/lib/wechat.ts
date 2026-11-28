// 微信前后端共用常量、状态文案、精准搜索锚点与全格式粘贴聊天记录解析器

export const WX_SYNC_STATUS_LABEL: Record<string, string> = {
  DISCONNECTED: "未连接桌面版",
  READY: "桌面版已连接",
  SYNCING: "同步中",
  ERROR: "同步异常",
};

export const WX_MSG_STATUS_LABEL: Record<string, string> = {
  STAGED: "待发送",
  SENT: "已发送",
  UNCONFIRMED: "未确认发出",
  RECEIVED: "已收到",
  FAILED: "发送失败",
};

export const WX_SYNC_MODES = [
  { value: "whitelist", label: "仅同步客户会话（推荐）", desc: "仅同步带备注前缀或已关联 CRM 客户的微信会话，私聊不同步" },
  { value: "all", label: "同步全部会话", desc: "同步当前微信账号下的所有近期会话（适合纯工作微信号）" },
] as const;

/** 判断是否为微信内部原始 wxid（微信 PC 搜索框无法搜到原始 wxid_xxx！） */
export function isRawWxid(value?: string | null): boolean {
  if (!value) return false;
  return /^wxid_[a-z0-9_-]{4,}$/i.test(value.trim());
}

/**
 * 半自动一键上屏时，定位联系人的最高优先级搜索词：
 * 绝不使用原始 wxid_xxx（微信搜索框搜不到，会导致焦点卡在搜索框把消息贴进去！）
 * 优先级：自定义微信号（非 wxid_） > 微信备注名 > 微信昵称/群名
 */
export function resolveWechatSearchKey(chat: { wechatNo?: string | null; remark?: string | null; name?: string | null }): {
  key: string;
  kind: "wechatNo" | "remark" | "name" | "none";
  label: string;
  ignoredRawWxid?: boolean;
} {
  const wechatNo = chat.wechatNo?.trim();
  const ignoredRawWxid = isRawWxid(wechatNo);
  if (wechatNo && !ignoredRawWxid) {
    return { key: wechatNo, kind: "wechatNo", label: "微信号" };
  }
  const remark = chat.remark?.trim();
  if (remark) {
    return { key: remark, kind: "remark", label: "备注名", ignoredRawWxid };
  }
  const name = chat.name?.trim();
  if (name) {
    return { key: name, kind: "name", label: "昵称", ignoredRawWxid };
  }
  return { key: "", kind: "none", label: "未设置", ignoredRawWxid };
}

export function wechatDisplayName(chat: { remark?: string | null; name?: string | null; wechatNo?: string | null; wxKey?: string }) {
  const wechatNo = chat.wechatNo?.trim();
  return chat.remark?.trim() || chat.name?.trim() || (wechatNo && !isRawWxid(wechatNo) ? wechatNo : "") || wechatNo || chat.wxKey || "未知微信联系人";
}

export type ParsedWechatLine = {
  fromMe: boolean;
  senderName?: string;
  text: string;
  at?: number;
};

const CN_DATE_ONLY_RE = /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日$/;
const ISO_DATE_ONLY_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const REL_DATE_ONLY_RE = /^(今天|昨天|前天|星期[一二三四五六日天]|周[一二三四五六日天])$/;
const TIME_ONLY_RE = /^(?:(上午|下午|凌晨|早上|中午|晚上)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const INLINE_HEADER_RE =
  /^(.{1,60}?)\s+(?:(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?)\s+)?(?:(上午|下午|凌晨|早上|中午|晚上)\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s*:?$/;
const COLON_SENDER_RE = /^([^\s:：][^:：]{0,40})[:：]\s*$/;

function parseDateAnchor(line: string): Date | null {
  const s = line.trim();
  const cn = CN_DATE_ONLY_RE.exec(s);
  if (cn) return new Date(Number(cn[1]), Number(cn[2]) - 1, Number(cn[3]));
  const iso = ISO_DATE_ONLY_RE.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  if (REL_DATE_ONLY_RE.test(s)) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (s === "昨天") d.setDate(d.getDate() - 1);
    else if (s === "前天") d.setDate(d.getDate() - 2);
    return d;
  }
  return null;
}

function buildTimestamp(baseDate: Date | null, timeStr: string, period?: string): number | undefined {
  const m = TIME_ONLY_RE.exec(timeStr.trim());
  if (!m) return undefined;
  const p = period || m[1];
  let hh = Number(m[2]);
  const mm = Number(m[3]);
  const ss = Number(m[4] || "0");
  if ((p === "下午" || p === "晚上") && hh < 12) hh += 12;
  if (p === "凌晨" && hh === 12) hh = 0;
  const d = baseDate ? new Date(baseDate.getTime()) : new Date();
  d.setHours(hh, mm, ss, 0);
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}

function judgeFromMe(sender: string, options?: { myName?: string | null; peerName?: string | null; defaultFromMe?: boolean }): boolean {
  const s = sender.trim().toLowerCase();
  if (!s) return options?.defaultFromMe ?? false;
  if (s === "我" || s === "me" || s === "myself" || s === "self") return true;
  const my = options?.myName?.trim().toLowerCase() || "";
  const peer = options?.peerName?.trim().toLowerCase() || "";
  // 如果自己昵称和对方名字恰好同名，避免误把对方全当成自己：优先听 defaultFromMe，否则按 myName 匹配
  if (my && peer && my === peer) return options?.defaultFromMe ?? false;
  if (my && s === my) return true;
  if (peer && s === peer) return false;
  return false;
}

/**
 * 全格式微信聊天记录粘贴解析器，兼容：
 * 1) 微信 4.0 多行复制格式：
 *      2026年11月25日
 *      车车
 *      02:59
 *      [文件] 工业云平台使用说明书-外部版.pdf
 * 2) 微信 4.0/3.9 无日期头多行格式（昵称行 + HH:MM 行 + 正文）
 * 3) 单行头格式（张三 2026-11-27 10:20:30 / 张三 10:20）
 * 4) 微信 3.9/4.0 冒号复制格式（张三:\n正文）
 * 5) 纯文本单条兜底
 */
export function parsePastedWechatLog(
  raw: string,
  options?: { myName?: string | null; peerName?: string | null; defaultFromMe?: boolean },
): ParsedWechatLine[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const lines = text.split("\n");
  const blocks: { sender: string; at?: number; body: string[] }[] = [];
  let currentDate: Date | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // 空行：保留在当前消息段落里（后面会 trim），不新建消息
    if (!trimmed) {
      if (blocks.length > 0) blocks[blocks.length - 1].body.push("");
      continue;
    }

    // 1) 独立日期分隔行（如「2026年11月25日」「2026-11-25」「昨天」）
    const dateAnchor = parseDateAnchor(trimmed);
    if (dateAnchor) {
      currentDate = dateAnchor;
      continue;
    }

    // 2) 微信 4.0 多行头：当前行是发言人（短文本、不含 URL），下一行是纯时间 HH:MM（跳过可能夹杂的单个空行）
    let nextIdx = i + 1;
    while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
    const nextTrimmed = nextIdx < lines.length ? lines[nextIdx].trim() : "";
    if (
      trimmed.length <= 50 &&
      !/^https?:\/\//i.test(trimmed) &&
      !trimmed.startsWith("[") &&
      TIME_ONLY_RE.test(nextTrimmed)
    ) {
      blocks.push({
        sender: trimmed.replace(/[:：]$/, "").trim(),
        at: buildTimestamp(currentDate, nextTrimmed),
        body: [],
      });
      i = nextIdx;
      continue;
    }

    // 3) 独立时间行（例如微信 4.0 有时候是「2026年11月25日」后紧跟「02:59」再跟正文，没有单独昵称行，或上一条末尾刚好没被识别）
    if (TIME_ONLY_RE.test(trimmed)) {
      // 回看上一条 body 最后一行是不是被误吞的昵称行（短且非 URL）
      let recoveredSender = options?.peerName?.trim() || "";
      if (blocks.length > 0) {
        const prevBody = blocks[blocks.length - 1].body;
        while (prevBody.length > 0 && !prevBody[prevBody.length - 1].trim()) prevBody.pop();
        const tail = prevBody.length > 0 ? prevBody[prevBody.length - 1].trim() : "";
        if (tail && tail.length <= 40 && !/^https?:\/\//i.test(tail) && !tail.startsWith("[")) {
          recoveredSender = prevBody.pop()!.trim();
        }
      }
      blocks.push({
        sender: recoveredSender,
        at: buildTimestamp(currentDate, trimmed),
        body: [],
      });
      continue;
    }

    // 4) 单行头格式：张三 2026-11-27 10:20:30 或 张三 10:20
    const inlineMatch = INLINE_HEADER_RE.exec(trimmed);
    if (inlineMatch && !/^https?:\/\//i.test(inlineMatch[1])) {
      const sender = inlineMatch[1].trim();
      const datePart: Date | null = inlineMatch[2] ? parseDateAnchor(inlineMatch[2]) : currentDate;
      if (datePart) currentDate = datePart;
      blocks.push({
        sender,
        at: buildTimestamp(currentDate, inlineMatch[4], inlineMatch[3]),
        body: [],
      });
      continue;
    }

    // 5) 冒号格式（如「车车:」紧跟下一行正文）
    const colonMatch = COLON_SENDER_RE.exec(trimmed);
    if (colonMatch && !/^https?$/i.test(colonMatch[1]) && nextTrimmed) {
      blocks.push({
        sender: colonMatch[1].trim(),
        at: currentDate ? currentDate.getTime() : undefined,
        body: [],
      });
      continue;
    }

    // 普通正文行
    if (blocks.length > 0) {
      blocks[blocks.length - 1].body.push(lines[i]);
    } else {
      blocks.push({
        sender: "",
        at: currentDate ? currentDate.getTime() : undefined,
        body: [lines[i]],
      });
    }
  }

  const out: ParsedWechatLine[] = [];
  for (const b of blocks) {
    const content = b.body.join("\n").trim();
    if (!content) continue;
    const fromMe = judgeFromMe(b.sender, options);
    out.push({
      fromMe,
      senderName: fromMe ? undefined : b.sender || undefined,
      text: content,
      at: b.at,
    });
  }

  if (out.length > 0) return out;

  return [
    {
      fromMe: options?.defaultFromMe ?? false,
      text,
      at: Date.now(),
    },
  ];
}
