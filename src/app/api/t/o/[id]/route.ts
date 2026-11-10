import { recordOpen } from "@/server/mail/track";

// 1×1 透明 GIF
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(request: Request, { params }: RouteContext<"/api/t/o/[id]">) {
  const { id } = await params;
  // 带着本系统登录 cookie 的是自己在 CRM 里看已发送邮件，不算客户打开
  const self = /(?:^|;\s*)crm_session=/.test(request.headers.get("cookie") ?? "");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!self) await recordOpen(id, ip, request.headers.get("user-agent")).catch(() => {});
  return new Response(GIF, {
    headers: { "content-type": "image/gif", "cache-control": "no-store, no-cache, must-revalidate, private", "content-length": String(GIF.length) },
  });
}
