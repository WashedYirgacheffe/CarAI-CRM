import { NextResponse, type NextRequest } from "next/server";

// 乐观检查：没有会话 cookie 就跳登录页。
// 真正的会话校验和权限判断在服务端 getCurrentUser / requirePermission 中完成。
// /api/t：邮件打开像素、链接跳转、退订（收件人没有登录）
// /s：发给客户的报价单、表单、图片链接（带签名）
// /b：销售 / 分公司对外的聚合主页（Link-in-Bio）
// /api/matrix/runner：社媒矩阵运行器（用企业令牌鉴权，不走登录 Cookie）
// /api/desktop：桌面版配对，接口自己校验登录，没登录返回 401（不跳登录页）
// /api/wechat：桌面版微信本地桥接（支持设备令牌 Bearer md_... 或登录 Cookie，接口内严格鉴权）
// /landing：官网落地页（caraicrm.com 根域名首页重写到此路由）
const PUBLIC_PATHS = ["/login", "/register", "/landing", "/api/t", "/s", "/b", "/api/matrix/runner", "/api/desktop", "/api/wechat"];

const LANDING_HOSTS = new Set(["caraicrm.com", "www.caraicrm.com"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(":")[0].toLowerCase();

  if (LANDING_HOSTS.has(host) && pathname === "/") {
    return NextResponse.rewrite(new URL("/landing", request.url));
  }

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isPublic) return NextResponse.next();

  if (!request.cookies.has("crm_session")) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // /api/upload 自己校验登录；不经过 proxy，避免大视频受 proxyClientMaxBodySize 限制
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/upload|.*\\.[\\w]+$).*)"],
};
