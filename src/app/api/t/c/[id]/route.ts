import { recordClick } from "@/server/mail/track";

export async function GET(request: Request, { params }: RouteContext<"/api/t/c/[id]">) {
  const { id } = await params;
  const url = new URL(request.url).searchParams.get("u") ?? "";
  // 带着本系统登录 cookie 的是自己在 CRM 里看已发送邮件，不算客户打开
  const self = /(?:^|;\s*)crm_session=/.test(request.headers.get("cookie") ?? "");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const target = await recordClick(id, url, ip, request.headers.get("user-agent"), !self).catch(() => null);
  if (!target) return new Response("Link not found", { status: 404 });
  return Response.redirect(target, 302);
}
