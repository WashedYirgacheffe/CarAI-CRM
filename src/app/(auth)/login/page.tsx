import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-normal tracking-tight">登录</h1>
        <p className="text-sm text-muted-foreground">使用企业账号邮箱登录。</p>
      </div>
      <LoginForm next={typeof next === "string" ? next : undefined} />
      <p className="text-sm text-muted-foreground">
        还没有企业账号？{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          免费注册
        </Link>
      </p>
    </div>
  );
}
