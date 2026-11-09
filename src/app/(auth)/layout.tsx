import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { getCurrentUser } from "@/server/auth";

const POINTS = [
  { title: "询盘不漏接", body: "邮件、独立站、B2B 平台的询盘统一进入线索池，自动查重分配。" },
  { title: "跟进不断档", body: "客户超期未跟进自动回到公海，团队里谁有空谁接手。" },
  { title: "报价有据可查", body: "多币种报价单、PI 和订单都挂在客户名下，历史价格一目了然。" },
];

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  // 已登录用户直接进后台
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[oklch(0.27_0.06_245)] p-10 text-white lg:flex">
        <Brand onDark className="h-8" />
        <div className="max-w-md space-y-8">
          <p className="text-3xl leading-tight font-semibold">
            给中小外贸团队的
            <br />
            多渠道客户跟进系统
          </p>
          <ul className="space-y-5">
            {POINTS.map((p) => (
              <li key={p.title} className="border-l-2 border-white/25 pl-4">
                <p className="font-medium">{p.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-white/70">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/50">© {new Date().getFullYear()} 车车外贸 CRM</p>
      </aside>
      <main className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <Brand className="mb-10 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
