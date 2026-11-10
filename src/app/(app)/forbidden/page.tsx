import type { Metadata } from "next";
import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "无权限" };

export default function ForbiddenPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldOff className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-medium">没有访问权限</h1>
      <p className="mt-2 text-sm text-muted-foreground">你的角色没有开通这个功能。需要的话请联系企业管理员，在「设置 → 角色权限」里调整。</p>
      <Button asChild className="mt-6" variant="outline">
        <Link href="/dashboard">回到工作台</Link>
      </Button>
    </div>
  );
}
