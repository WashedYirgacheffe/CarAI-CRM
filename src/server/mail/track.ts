import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";

/** 对外访问的站点地址：追踪像素、点击跳转、退订链接都用它 */
export function appUrl() {
  const u = process.env.APP_URL || (process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : "http://localhost:3000");
  return u.replace(/\/+$/, "");
}

export const newTrackId = () => randomBytes(12).toString("base64url");

/** 给发出的 HTML 加打开像素、把链接改成跳转链接；群发邮件再加退订链接 */
export function decorateHtml(html: string, trackId: string, opts: { unsubscribe?: boolean } = {}) {
  const base = appUrl();
  const linked = html.replace(/href="(https?:\/\/[^"]+)"/g, (_, url: string) => {
    const raw = url.replace(/&amp;/g, "&");
    return `href="${base}/api/t/c/${trackId}?u=${encodeURIComponent(raw)}"`;
  });
  const footer = opts.unsubscribe
    ? `<p style="margin-top:24px;font-family:Arial,sans-serif;font-size:11px;color:#9ca3af">If you prefer not to receive these emails, <a href="${base}/api/t/u/${trackId}" style="color:#9ca3af">unsubscribe here</a>.</p>`
    : "";
  const pixel = `<img src="${base}/api/t/o/${trackId}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`;
  return `${linked}${footer}${pixel}`;
}

const BOT_UA = /bot|crawler|spider|preview|scanner|barracuda|proofpoint|mimecast/i;

export async function recordOpen(trackId: string, ip: string | null, userAgent: string | null) {
  const m = await prisma.mailMessage.findUnique({ where: { trackId }, select: { id: true, tenantId: true, date: true, openedAt: true } });
  if (!m) return;
  // 发出后 3 秒内的请求多半是自己邮箱的预览或安全扫描，不算
  if (Date.now() - m.date.getTime() < 3_000 || (userAgent && BOT_UA.test(userAgent))) return;
  const now = new Date();
  await prisma.$transaction([
    prisma.mailMessage.update({
      where: { id: m.id },
      data: { openCount: { increment: 1 }, lastOpenAt: now, ...(m.openedAt ? {} : { openedAt: now }) },
    }),
    prisma.mailEvent.create({ data: { tenantId: m.tenantId, messageId: m.id, type: "open", ip, userAgent: userAgent?.slice(0, 300) } }),
  ]);
}

/** 记录点击，返回要跳转的地址；只允许跳到这封邮件正文里出现过的链接 */
export async function recordClick(trackId: string, url: string, ip: string | null, userAgent: string | null, count = true) {
  if (!/^https?:\/\//i.test(url)) return null;
  const m = await prisma.mailMessage.findUnique({ where: { trackId }, select: { id: true, tenantId: true, text: true, openedAt: true } });
  if (!m || !m.text?.includes(url)) return null;
  if (count && !(userAgent && BOT_UA.test(userAgent))) {
    const now = new Date();
    await prisma.$transaction([
      // 点了链接一定打开过（图片被屏蔽时打开像素不会触发）
      prisma.mailMessage.update({
        where: { id: m.id },
        data: { clickCount: { increment: 1 }, ...(m.openedAt ? {} : { openedAt: now, lastOpenAt: now, openCount: { increment: 1 } }) },
      }),
      prisma.mailEvent.create({
        data: { tenantId: m.tenantId, messageId: m.id, type: "click", url: url.slice(0, 1000), ip, userAgent: userAgent?.slice(0, 300) },
      }),
    ]);
  }
  return url;
}

/** 退订：加进屏蔽名单，停掉这个地址在本企业所有进行中的序列 */
export async function unsubscribe(trackId: string) {
  const m = await prisma.mailMessage.findUnique({
    where: { trackId },
    select: { tenantId: true, toList: true, enrollment: { select: { email: true } } },
  });
  if (!m) return false;
  const list = Array.isArray(m.toList) ? (m.toList as { address?: string }[]) : [];
  const email = (m.enrollment?.email ?? list[0]?.address ?? "").toLowerCase();
  if (!email) return false;
  await prisma.mailSuppression.upsert({
    where: { tenantId_email: { tenantId: m.tenantId, email } },
    create: { tenantId: m.tenantId, email, reason: "unsubscribe" },
    update: {},
  });
  await prisma.mailEnrollment.updateMany({
    where: { tenantId: m.tenantId, email, status: "ACTIVE" },
    data: { status: "UNSUBSCRIBED", nextAt: null },
  });
  return true;
}

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery (sub)?system/i;
const BOUNCE_SUBJECT = /undeliver|delivery (status notification|failure|has failed)|returned mail|failure notice|退信|无法投递|系统退信/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * 新来信的后处理（邮件同步时调用）：
 * - 退信：找到原邮件标记退信，停掉对应序列，地址加进屏蔽名单
 * - 回复：对方回了序列里的邮件（或之后任何来信），序列自动停止
 */
export async function onInboundMail(m: {
  tenantId: string;
  accountId: string;
  fromAddr: string;
  fromName: string | null;
  subject: string;
  text: string | null;
  inReplyTo: string | null;
  references: string[];
  date: Date;
}) {
  const refs = [m.inReplyTo, ...m.references].filter((x): x is string => !!x);
  if (BOUNCE_FROM.test(`${m.fromAddr} ${m.fromName ?? ""}`) || BOUNCE_SUBJECT.test(m.subject)) {
    let original = refs.length
      ? await prisma.mailMessage.findFirst({ where: { accountId: m.accountId, folder: "SENT", messageId: { in: refs } }, orderBy: { date: "desc" } })
      : null;
    if (!original && m.text) {
      // 退信正文里一般会带上原收件人地址
      const own = await prisma.mailAccount.findUnique({ where: { id: m.accountId }, select: { email: true } });
      const candidates = [...new Set((m.text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))].filter(
        (e) => e !== own?.email.toLowerCase() && !BOUNCE_FROM.test(e),
      );
      for (const e of candidates.slice(0, 5)) {
        original = await prisma.mailMessage.findFirst({
          where: {
            accountId: m.accountId,
            folder: "SENT",
            trackId: { not: null },
            date: { gt: new Date(m.date.getTime() - 3 * 86_400_000) },
            toList: { array_contains: [{ address: e }] },
          },
          orderBy: { date: "desc" },
        });
        if (original) break;
      }
    }
    if (!original) return;
    await prisma.mailMessage.update({ where: { id: original.id }, data: { bouncedAt: m.date } });
    const to = (Array.isArray(original.toList) ? (original.toList as { address?: string }[]) : [])[0]?.address?.toLowerCase();
    if (to) {
      await prisma.mailSuppression.upsert({
        where: { tenantId_email: { tenantId: m.tenantId, email: to } },
        create: { tenantId: m.tenantId, email: to, reason: "bounce" },
        update: {},
      });
      await prisma.mailEnrollment.updateMany({
        where: { tenantId: m.tenantId, email: to, status: "ACTIVE" },
        data: { status: "BOUNCED", nextAt: null },
      });
    }
    return;
  }

  // 回复：这个地址在本企业里进行中的序列都停掉
  const email = m.fromAddr.toLowerCase();
  const active = await prisma.mailEnrollment.findMany({
    where: { tenantId: m.tenantId, email, status: "ACTIVE", lastSentAt: { not: null }, sequence: { stopOnReply: true } },
    select: { id: true },
  });
  if (active.length) {
    await prisma.mailEnrollment.updateMany({
      where: { id: { in: active.map((x) => x.id) } },
      data: { status: "REPLIED", repliedAt: m.date, nextAt: null },
    });
  }
}
