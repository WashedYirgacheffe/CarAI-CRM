import { NextResponse, type NextRequest } from "next/server";

// 乐观检查：没有会话 cookie 就跳登录页。
// 真正的会话校验和权限判断在服务端 getCurrentUser / requirePermission 中完成。
// /api/t：邮件打开像素、链接跳转、退订（收件人没有登录）
// /s：发给客户的报价单、表单、图片链接（带签名）
// /b：销售 / 分公司对外的聚合主页（Link-in-Bio）
// /api/matrix/runner：社媒矩阵运行器（用企业令牌鉴权，不走登录 Cookie）
const PUBLIC_PATHS = ["/login", "/register", "/api/t", "/s", "/b", "/api/matrix/runner"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
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
