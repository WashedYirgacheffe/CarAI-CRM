import { after } from "next/server";
import { locateVisit, pingVisit, startVisit, type PingInput, type TrackKind } from "@/server/share-track";

/*
 * 公开页面的访问上报（ViewTracker 调用）：
 *   {op:"start", kind, token, referrer} → {id, sig}
 *   {op:"ping", id, sig, activeMs, maxScroll, sections, events}
 * 页面关闭时用 sendBeacon 发，content-type 是 text/plain，所以统一按文本读再解析。
 */

const KINDS = new Set<TrackKind>(["q", "inquiry", "shipping", "p"]);

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 32_000) return Response.json({ ok: false }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  // 带着 CRM 登录 cookie 的是我们自己（包括产品页里的预览），不算客户访问
  if (/(?:^|;\s*)crm_session=/.test(request.headers.get("cookie") ?? "")) return Response.json({ ok: true, skip: "self" });

  if (body.op === "start") {
    const kind = body.kind as TrackKind;
    if (!KINDS.has(kind) || typeof body.token !== "string") return Response.json({ ok: false }, { status: 400 });
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
    const r = await startVisit({
      kind,
      token: body.token,
      ip,
      ua: request.headers.get("user-agent") ?? "",
      referrer: typeof body.referrer === "string" ? body.referrer : null,
      at: Date.now(),
    }).catch(() => null);
    if (!r) return Response.json({ ok: true, skip: "ignored" });
    if (r.isNew) after(() => locateVisit(r.id).catch(() => {}));
    return Response.json({ ok: true, id: r.id, sig: r.sig });
  }

  if (body.op === "ping") {
    const ok = await pingVisit(body as unknown as PingInput).catch(() => false);
    return Response.json({ ok });
  }
  return Response.json({ ok: false }, { status: 400 });
}
