import { redirect } from "next/navigation";
import { Bot, Languages, MailCheck, MessageCircle, RefreshCcw } from "lucide-react";
import { Brand } from "@/components/brand";
import { AuthBackdrop } from "@/components/auth-backdrop";
import { getCurrentUser } from "@/server/auth";

const POINTS = [
  { icon: MailCheck, title: "AI 读信，询盘不漏接", body: "来信自动摘要、判断意图和优先级，陌生询盘自动建成线索。" },
  { icon: Languages, title: "外文邮件双语对照", body: "原版排版里逐段嵌入中文译文，一键切换原文、双语、译文。" },
  { icon: MessageCircle, title: "WhatsApp 多账号统一回", body: "聊天自动翻译，中文写好一键译成客户的语言再发。" },
  { icon: RefreshCcw, title: "开发信自动跟进", body: "多封邮件按天自动发送，追踪打开和点击，客户一回复就停。" },
  { icon: Bot, title: "随叫随到的 AI 助手", body: "划词即可翻译、润色、裂变，一句话查客户、写跟进。" },
];

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  // 已登录用户直接进后台
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div className="relative isolate min-h-svh text-white">
      <AuthBackdrop />
      <div className="mx-auto grid min-h-svh max-w-7xl items-center gap-8 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-16 lg:px-12">
        <section className="space-y-7 lg:space-y-10">
          <Brand onDark className="h-7 lg:h-8" />
          <div className="space-y-4">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/85 ring-1 ring-white/15 backdrop-blur">
              <span className="size-1.5 rounded-full bg-[#f2b27e] shadow-[0_0_8px_#f2b27e]" />
              为中小外贸团队打造的 AI 客户跟进系统
            </p>
            <h1 className="max-w-xl text-[2rem] leading-[1.15] font-semibold tracking-tight text-balance lg:text-[3.25rem]">
              让 AI 替你盯住
              <br />
              <span className="bg-gradient-to-r from-[#ffd2ad] to-[#f2a36b] bg-clip-text text-transparent">每一个海外询盘</span>
            </h1>
            <p className="max-w-lg text-[15px] leading-relaxed text-white/75 lg:text-base">
              邮件、WhatsApp、报价、订单在一处跟进；外文自动翻译，该回的提醒你回，没人跟的自动回公海。
            </p>
          </div>
          {/* 手机：卖点压成一行胶囊；桌面：完整列表 */}
          <ul className="flex flex-wrap gap-2 lg:hidden">
            {POINTS.slice(0, 4).map((p) => (
              <li
                key={p.title}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/90 ring-1 ring-white/15 backdrop-blur"
              >
                <p.icon className="size-3.5 text-[#f6bf93]" />
                {p.title.split("，")[0]}
              </li>
            ))}
          </ul>
          <ul className="hidden max-w-xl gap-3 lg:grid lg:grid-cols-2">
            {POINTS.map((p, i) => (
              <li
                key={p.title}
                className={`rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/12 backdrop-blur-md transition-colors hover:bg-white/[0.11] ${i === 0 ? "col-span-2" : ""}`}
              >
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-[#f2a36b]/20 text-[#ffc89e]">
                    <p.icon className="size-4" />
                  </span>
                  {p.title}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-white/65">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <main className="w-full rounded-3xl bg-card p-6 text-card-foreground shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)] ring-1 ring-white/10 sm:p-8">
          {children}
        </main>
      </div>
      <p className="pb-6 text-center text-xs text-white/45 lg:absolute lg:bottom-6 lg:left-12 lg:pb-0 lg:text-left">
        © {new Date().getFullYear()} 车车外贸 CRM
      </p>
    </div>
  );
}
