"use client";

import {
  Check,
  CheckCircle2,
  FileSearch,
  FolderLock,
  Lock,
  MessagesSquare,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { AgentAvatar } from "@/components/agentes/agent-avatar";

const MARQUEE_ROW_1 = [
  "个人微信 4.0",
  "WhatsApp 直连",
  "IMAP / SMTP 邮箱",
  "TikTok 私信",
  "Instagram DM",
  "Facebook 专页",
  "LinkedIn 拓展",
  "X (Twitter)",
];

const MARQUEE_ROW_2 = [
  "DeepSeek / Claude",
  "10 种外贸单据",
  "Camoufox 车车浏览器",
  "LibreOffice 原样预览",
  "阿里云 OSS 加密",
  "Google 实时多语翻译",
  "PostgreSQL 多租户",
  "Windows / macOS 自动更新",
];

/**
 * 1:1 复刻 openbot.run Section 2 12 列不对称 Bento 网格（适配 CarAI 暖白纸面 + 高对比柔和色块 + 独立微动画）
 */
export function BentoFeaturesSection() {
  return (
    <section id="features" className="mx-auto max-w-[1160px] scroll-mt-24 px-5 py-20 sm:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-dot text-xs tracking-[0.2em] text-[#0063d1] uppercase">CORE CAPABILITIES</p>
        <h2 className="mt-3 font-brand text-3xl font-semibold tracking-[-0.03em] text-[#151514] sm:text-5xl">
          车车 CRM 能为你做什么
        </h2>
        <p className="mt-3 text-sm text-[#5c5c58] sm:text-base">
          从获客破冰、全渠道沟通、AI 制单审单到物流回款，把最繁琐的外贸环节全部自动化、安全化。
        </p>
      </div>

      {/* 12 列密集不对称 Bento Grid（严格对应 openbot.run 网格比例） */}
      <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 卡 1（7列×2行）：个人微信零封号工作台 */}
        <div className="lp-bento-card flex flex-col justify-between overflow-hidden p-6 sm:p-7 lg:col-span-7 lg:row-span-2">
          {/* 动态演示窗口 */}
          <div className="rounded-2xl bg-[#fbfbfa] p-4 ring-1 ring-black/[0.06]">
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-2.5 text-xs">
              <span className="inline-flex items-center gap-2 font-semibold text-[#151514]">
                <span className="flex size-6 items-center justify-center rounded-lg bg-[#dcf7e6] text-[#12804a]">
                  <MessagesSquare className="size-3.5" />
                </span>
                # 个人微信 · 客户-迪拜Alex
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#dcf7e6] px-2.5 py-0.5 text-[10px] font-medium text-[#12804a]">
                <ShieldCheck className="size-3" />
                零 Hook · 零协议封号
              </span>
            </div>

            <div className="mt-3.5 space-y-3 text-xs">
              <div className="flex items-start gap-2.5">
                <AgentAvatar name="Alex" size="sm" appearance={{ color: "green", eyes: "dots" }} />
                <div className="rounded-2xl rounded-tl-sm bg-white p-3 shadow-2xs ring-1 ring-black/[0.06]">
                  <p className="text-[#151514]">Please update PI with 5 units Song Plus EV & 3 units UNI-Z.</p>
                  <p className="mt-1 text-[11px] text-[#0063d1]">译文：请把 PI 更新为 5 台宋 Plus EV 和 3 台 UNI-Z。</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <AgentAvatar name="车车AI" size="sm" state="writing" appearance={{ color: "sky", eyes: "dots" }} />
                <div className="flex-1 rounded-2xl rounded-tl-sm border border-[#b25e00]/25 bg-[#ffefd2]/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-[#b25e00]">已上屏到微信输入框（精准定位：alex_auto_dxb）</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="lp-typing-dot size-1.5 rounded-full bg-[#b25e00]" />
                      <span className="lp-typing-dot size-1.5 rounded-full bg-[#b25e00]" />
                      <span className="lp-typing-dot size-1.5 rounded-full bg-[#b25e00]" />
                    </span>
                  </div>
                  <p className="mt-1.5 text-[#151514]">
                    Updated PI attached! Total FOB Shanghai $162,400. Ready for shipment in 18 days.
                  </p>
                  <div className="mt-2 flex items-center justify-between border-t border-[#b25e00]/15 pt-1.5 text-[10px]">
                    <span className="text-[#5c5c58]">业务员核对头像后按 Enter 发送</span>
                    <span className="inline-flex items-center gap-1 font-medium text-[#12804a]">
                      <CheckCircle2 className="size-3" />
                      本地回执自动翻转「已发送」
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2 text-[11px] ring-1 ring-black/[0.06]">
              <span className="text-[#6f6f6a]">支持微信 4.0 / 3.9 · 私人聊天白名单隔离</span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-[#12804a] px-2.5 py-1 font-medium text-white">
                <Send className="size-3" />
                一键上屏
              </span>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="font-brand text-2xl font-semibold text-[#151514]">个人微信零封号工作台</h3>
            <p className="mt-2 text-sm leading-relaxed text-[#5c5c58]">
              彻底告别高危内存 Hook 与外挂群控。桌面端仅本地只读同步白名单客户会话；发送时自动唤起微信并按微信号/精确备注定位粘贴，绝不自动按回车，零误发、零封号，且发出后自动完成状态回执。
            </p>
          </div>
        </div>

        {/* 卡 2（5列）：全渠道外贸生态 Marquee */}
        <div className="lp-bento-card flex flex-col justify-between overflow-hidden p-6 lg:col-span-5">
          <div className="lp-marquee-wrap -mx-6 space-y-2.5 overflow-hidden py-2 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
            <div className="lp-marquee-track gap-2">
              {[...MARQUEE_ROW_1, ...MARQUEE_ROW_1].map((item, idx) => (
                <span
                  key={`r1-${idx}`}
                  className="inline-flex shrink-0 items-center rounded-full bg-[#f3f3f0] px-3.5 py-1.5 text-xs font-medium text-[#151514] ring-1 ring-black/[0.05]"
                >
                  {item}
                </span>
              ))}
            </div>
            <div className="lp-marquee-track-rev gap-2">
              {[...MARQUEE_ROW_2, ...MARQUEE_ROW_2].map((item, idx) => (
                <span
                  key={`r2-${idx}`}
                  className="inline-flex shrink-0 items-center rounded-full bg-[#e3eefd]/75 px-3.5 py-1.5 text-xs font-medium text-[#0063d1] ring-1 ring-[#0063d1]/10"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <h3 className="font-brand text-xl font-semibold text-[#151514]">打通全部外贸沟通与工具</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[#5c5c58]">
              邮件、WhatsApp、个人微信、TikTok / IG / FB / LinkedIn / X、AI 大模型与文件预览原生打通，不必在十几个软件之间来回切窗。
            </p>
          </div>
        </div>

        {/* 卡 3（5列）：高对比淡蓝紫数据隐私与隔离树卡（1:1 复刻 openbot.run 薰衣草亮色卡） */}
        <div className="grid grid-cols-1 items-center gap-4 rounded-[28px] bg-[#e6dcff] p-6 text-[#151514] ring-1 ring-black/[0.08] sm:grid-cols-[1.15fr_1fr] lg:col-span-5">
          <div>
            <h3 className="font-brand text-xl font-semibold leading-snug">客户资产留在企业，隐私边界清晰</h3>
            <p className="mt-2 text-xs leading-relaxed text-[#151514]/75">
              桌面端钥匙串加密保存令牌，微信白名单模式确保私人聊天绝不上传；支持多租户隔离与自有服务器私有化部署。
            </p>
          </div>

          <div className="rounded-2xl bg-white/90 p-3.5 shadow-[0_12px_28px_-12px_rgba(21,21,20,0.2)] ring-1 ring-black/[0.08]">
            <div className="flex items-center justify-between border-b border-black/[0.07] pb-2 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1.5">
                <FolderLock className="size-3.5 text-[#7c4dff]" />
                本机 + 企业隔离
              </span>
              <Lock className="lp-lock-anim size-3.5 text-[#12804a]" />
            </div>
            <ul className="mt-2.5 space-y-1.5 font-mono text-[10px] text-[#2a2a28]">
              <li className="flex items-center justify-between">
                <span>├─ 微信白名单</span>
                <span className="text-[#12804a]">仅同步客户</span>
              </li>
              <li className="flex items-center justify-between">
                <span>├─ 设备令牌</span>
                <span className="text-[#0063d1]">钥匙串加密</span>
              </li>
              <li className="flex items-center justify-between">
                <span>├─ 车车浏览器</span>
                <span className="text-[#7c4dff]">独立指纹</span>
              </li>
              <li className="flex items-center justify-between">
                <span>└─ 操作审计</span>
                <span className="text-[#b25e00]">全量留痕</span>
              </li>
            </ul>
          </div>
        </div>

        {/* 卡 4（8列）：团队多人协同、防撞单与审批流 */}
        <div className="lp-bento-card flex flex-col justify-between p-6 sm:p-7 lg:col-span-8">
          <div className="rounded-2xl bg-[#fbfbfa] p-4 ring-1 ring-black/[0.06]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-[#151514] px-2.5 py-1 text-xs font-medium text-white"># 中东大客户跟进组</span>
                <span className="rounded-full bg-[#ffefd2] px-2.5 py-0.5 text-[11px] font-medium text-[#b25e00]">查重保护已开启</span>
              </div>
              <div className="flex items-center">
                <div className="flex -space-x-2">
                  <span className="flex size-8 items-center justify-center rounded-full bg-[#0063d1] text-xs font-medium text-white ring-2 ring-white">王</span>
                  <span className="flex size-8 items-center justify-center rounded-full bg-[#12804a] text-xs font-medium text-white ring-2 ring-white">李</span>
                  <span className="flex size-8 items-center justify-center rounded-full bg-white ring-2 ring-white">
                    <AgentAvatar name="AI" size="xs" appearance={{ color: "sky", eyes: "dots" }} framed={false} />
                  </span>
                </div>
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#e3eefd] px-2.5 py-1 text-[11px] font-medium text-[#0063d1]">
                  <UserPlus className="size-3" />
                  分配 / 协同
                </span>
              </div>
            </div>

            <div className="mt-3.5 grid gap-2.5 sm:grid-cols-3">
              {[
                { title: "防撞单查重", desc: "按邮箱域名、电话、微信号自动查重提示，防止内部抢客", badge: "实时拦截" },
                { title: "公海自动回收", desc: "超期未跟进客户自动回公海，支持按客群定制回收天数", badge: "每日限领" },
                { title: "多级审批流", desc: "超折扣报价、退公海、转移/删除客户一键推送主管审批", badge: "审计留痕" },
              ].map((b) => (
                <div key={b.title} className="rounded-xl bg-white p-3 ring-1 ring-black/[0.06]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#151514]">{b.title}</span>
                    <span className="rounded bg-[#f3f3f0] px-1.5 py-0.5 text-[9px] text-[#5c5c58]">{b.badge}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#6f6f6a]">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <h3 className="font-brand text-xl font-semibold text-[#151514]">多人协同、公海流转与规范审批</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[#5c5c58]">
              部门树与「仅本人 / 本部门 / 全公司」数据范围隔离，社媒联系方式支持脱敏权限；业务员离职后客户资产与聊天记录完整留存企业。
            </p>
          </div>
        </div>

        {/* 卡 5（4列×2行竖向高卡）：AI 自动化外贸工作流节点图 */}
        <div className="lp-bento-card flex flex-col justify-between p-6 lg:col-span-4 lg:row-span-2">
          <div className="rounded-2xl bg-[#fbfbfa] p-4 ring-1 ring-black/[0.06]">
            {/* 节点 1：触发 */}
            <div className="rounded-xl bg-white p-3 shadow-2xs ring-1 ring-black/[0.07]">
              <p className="font-mono text-[10px] text-[#0063d1]">TRIGGER · 实时触发</p>
              <p className="mt-0.5 text-xs font-semibold text-[#151514]">海外新询盘进入（邮件 / WA / 微信 / TikTok）</p>
            </div>

            {/* 虚线流动连线 */}
            <svg viewBox="0 0 220 34" className="mx-auto h-8 w-52">
              <path d="M110 0 V14 M110 14 H45 V34 M110 14 H175 V34" fill="none" stroke="#0063d1" strokeWidth="1.6" className="lp-dash-line" />
            </svg>

            {/* 节点 2：双路并行 AI */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white p-2.5 ring-1 ring-black/[0.07]">
                <div className="flex items-center gap-1.5">
                  <AgentAvatar name="译" size="xs" appearance={{ color: "green", eyes: "dots" }} framed={false} />
                  <span className="text-[11px] font-semibold">意图 & 翻译</span>
                </div>
                <p className="mt-1 text-[10px] text-[#6f6f6a]">识别高意向并秒译中文</p>
              </div>
              <div className="rounded-xl bg-white p-2.5 ring-1 ring-black/[0.07]">
                <div className="flex items-center gap-1.5">
                  <AgentAvatar name="研" size="xs" appearance={{ color: "violet", eyes: "dots" }} framed={false} />
                  <span className="text-[11px] font-semibold">联网背调</span>
                </div>
                <p className="mt-1 text-[10px] text-[#6f6f6a]">穿透官网与社媒背景</p>
              </div>
            </div>

            <svg viewBox="0 0 220 34" className="mx-auto h-8 w-52">
              <path d="M45 0 V18 H110 V34 M175 0 V18 H110" fill="none" stroke="#7c4dff" strokeWidth="1.6" className="lp-dash-line" />
            </svg>

            {/* 节点 3：AI 制单与记忆 */}
            <div className="rounded-xl bg-white p-3 ring-1 ring-black/[0.07]">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#151514]">
                <Sparkles className="size-3.5 text-[#0063d1]" />
                生成报价单 / PI + 写入客户记忆
              </div>
              <p className="mt-1 text-[10px] text-[#6f6f6a]">自动带入公司样本、汇率快照与付款条款</p>
            </div>

            <svg viewBox="0 0 220 28" className="mx-auto h-7 w-52">
              <path d="M110 0 V28" fill="none" stroke="#12804a" strokeWidth="1.6" className="lp-dash-line" />
            </svg>

            {/* 节点 4：人工拍板 */}
            <div className="flex items-center justify-between rounded-xl bg-[#dcf7e6]/75 p-3 ring-1 ring-[#12804a]/25">
              <div>
                <p className="font-mono text-[10px] text-[#12804a]">HUMAN-IN-THE-LOOP</p>
                <p className="text-xs font-semibold text-[#151514]">主管审批 / 业务员确认发出</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#12804a] px-2.5 py-1 text-[10px] font-medium text-white">
                <Check className="size-3" />
                已批准
              </span>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="font-brand text-xl font-semibold text-[#151514]">自动化外贸工作流</h3>
            <p className="mt-2 text-xs leading-relaxed text-[#5c5c58]">
              AI 处理 90% 的信息整理、背调、翻译与制单，把最关键的报价审批与最终发送交由人来拍板，效率与风控兼得。
            </p>
          </div>
        </div>

        {/* 卡 6（8列）：文件原样预览 + AI 多模态解读 */}
        <div className="lp-bento-card flex flex-col justify-between p-6 sm:p-7 lg:col-span-8">
          <div className="grid gap-3 rounded-2xl bg-[#fbfbfa] p-4 ring-1 ring-black/[0.06] sm:grid-cols-[1.2fr_1fr]">
            <div className="rounded-xl bg-white p-3.5 ring-1 ring-black/[0.06]">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#151514]">
                  <FileSearch className="size-4 text-[#0063d1]" />
                  L_C_Draft_Dubai_Scanned.pdf
                </span>
                <span className="rounded bg-[#e3eefd] px-1.5 py-0.5 text-[10px] font-medium text-[#0063d1]">扫描件逐页渲染</span>
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                {["第 1 页 · 信用证抬头", "第 2 页 · 装运条款", "第 3 页 · 单据清单"].map((p) => (
                  <div key={p} className="rounded-lg bg-[#f3f3f0] p-2 text-center">
                    <div className="mx-auto h-10 w-8 rounded bg-white shadow-2xs ring-1 ring-black/[0.06]" />
                    <p className="mt-1.5 text-[9px] text-[#5c5c58]">{p}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl bg-white p-3.5 ring-1 ring-[#0063d1]/18">
              <div>
                <p className="text-[11px] font-semibold text-[#0063d1]">AI 审单解读侧栏</p>
                <ul className="mt-2 space-y-1.5 text-[11px] text-[#2a2a28]">
                  <li>• 发现软条款：46A 要求买方检验证书</li>
                  <li>• 最迟装运期：2026-12-20（剩余 23 天）</li>
                  <li>• 自动关联至订单 SO-20261108 客户文件库</li>
                </ul>
              </div>
              <p className="mt-2 text-[10px] text-[#6f6f6a]">支持 Word / Excel / PPT 经 LibreOffice 原样转 PDF 在线预览</p>
            </div>
          </div>

          <div className="mt-5">
            <h3 className="font-brand text-xl font-semibold text-[#151514]">客户文件原样预览与 AI 多模态审单</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[#5c5c58]">
              PI、产地证 CO、信用证扫描件、Word/Excel 报价表无需下载即可全宽原样预览；扫描版 PDF 自动裁白边按页交由 AI 逐条解读，并支持一键通过邮件或 WhatsApp 发给客户。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
