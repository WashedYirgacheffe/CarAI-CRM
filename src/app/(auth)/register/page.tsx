import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "注册企业" };

export default function RegisterPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">注册企业账号</h1>
        <p className="text-sm text-muted-foreground">
          注册人即为企业主账号，之后可在「设置 → 成员」里为业务员开子账号。
        </p>
      </div>
      <RegisterForm />
      <p className="text-sm text-muted-foreground">
        已有账号？{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          去登录
        </Link>
      </p>
    </div>
  );
}
