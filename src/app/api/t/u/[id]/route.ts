import { unsubscribe } from "@/server/mail/track";

const page = (body: string) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:Arial,sans-serif;max-width:420px;margin:80px auto;padding:0 20px;color:#1f2937;text-align:center">${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

// GET 只显示确认按钮：邮件安全网关会预先打开链接，不能一打开就退订
export async function GET() {
  return page(
    `<h1 style="font-size:20px">Unsubscribe</h1><p>You will no longer receive marketing emails from us.</p><form method="post"><button style="margin-top:12px;padding:10px 22px;border:0;border-radius:999px;background:#3c67e8;color:#fff;font-size:14px;cursor:pointer">Confirm unsubscribe</button></form>`,
  );
}

export async function POST(_request: Request, { params }: RouteContext<"/api/t/u/[id]">) {
  const { id } = await params;
  const ok = await unsubscribe(id).catch(() => false);
  return page(
    ok ? `<h1 style="font-size:20px">You have been unsubscribed</h1><p>Sorry to see you go.</p>` : `<h1 style="font-size:20px">Link expired</h1>`,
  );
}
