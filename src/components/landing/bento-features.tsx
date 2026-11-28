"use client";

import {
  CheckCircle2,
  FileSearch,
  FolderLock,
  MessagesSquare,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AgentAvatar } from "@/components/agentes/agent-avatar";

const MARQUEE_ROW_1 = [
  "个人微信 4.0",
  "WhatsApp 直连",
  "IMAP 与 SMTP 邮箱",
  "TikTok 私信",
  "Instagram DM",
  "Facebook 专页",
  "LinkedIn 拓展",
  "X 社媒消息",
];

const MARQUEE_ROW_2 = [
  "10 种外贸单据",
  "车车浏览器防关联",
  "PDF 与 Office 原样预览",
  "25+ 语种实时翻译",
  "客户长期记忆",
  "多级折扣审批",
  "公海防撞单",
  "Windows 与 macOS 自动更新",
];

export function BentoFeaturesSection() {
  return (
    <section id="features" className="mx-auto max-w-[1160px] scroll-mt-24 px-5 py-24 sm:py-32">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="lp-h2 font-brand font-semibold text-[#151514]">
          把繁琐的外贸环节交由系统与 AI 接管
        </h2>
        <p className="lp-body mx-auto mt-4 max-w-[56ch] text-[#5c5c58]">
          从个人微信安全跟单、海外多渠道整合，到自动化背调制单与信用证条款审核，全部在一套界面里完成。
        </p>
      </div>

      {/* 12 列不对称编辑布局：无卡片套卡片、无装饰标签、强明暗节奏 */}
      <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* 面板 1（7列×2行）：个人微信零封号工作台 */}
        <article className="lp-surface-panel flex flex-col justify-between overflow-hidden p-7 sm:p-9 lg:col-span-7 lg:row-span-2">
          <div>
            <div className="flex items-center justify-between border-b border-black/[0.08] pb-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-[#dcf7e6] text-[#12804a]">
                  <MessagesSquare className="size-4" />
                </span>
                <div>
                  <p className="lp-body font-semibold text-[#151514]">客户-迪拜Alex</p>
                  <p className="lp-sm text-[#5c5c58]">精准定位微信号 alex_auto_dxb</p>
                </div>
              </div>
              <span className="lp-sm inline-flex items-center gap-1.5 font-medium text-[#12804a]">
                <ShieldCheck className="size-4" />
                零 Hook 只读同步
              </span>
            </div>

            <div className="mt-6 space-y-5">
              <div className="flex items-start gap-3">
                <AgentAvatar name="Alex" size="sm" appearance={{ color: "green", eyes: "dots" }} />
                <div className="flex-1 rounded-2xl rounded-tl-sm bg-[#f3f3f0] px-4 py-3.5">
                  <p className="lp-sm text-[#151514]">
                    Please update PI with 5 units Song Plus EV &amp; 3 units UNI-Z.
                  </p>
                  <p className="lp-sm mt-1.5 text-[#0063d1]">
                    译文：请把形式发票更新为 5 台宋 Plus EV 和 3 台 UNI-Z。
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <AgentAvatar name="车车AI" size="sm" state="writing" appearance={{ color: "sky", eyes: "dots" }} />
                <div className="flex-1 rounded-2xl rounded-tl-sm bg-[#ffefd2]/70 px-4 py-3.5">
                  <p className="lp-sm font-medium text-[#b25e00]">已粘贴至微信输入框，等待人工核对发送</p>
                  <p className="lp-sm mt-1.5 text-[#151514] tabular-nums">
                    Updated PI attached. Total FOB Shanghai $162,400, ready for shipment in 18 days.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#b25e00]/15 pt-2.5">
                    <span className="lp-sm text-[#5c5c58]">核对头像后按 Enter 发出</span>
                    <span className="lp-sm inline-flex items-center gap-1 font-medium text-[#12804a]">
                      <CheckCircle2 className="size-4" />
                      发出后自动回执
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.08] pt-4">
              <span className="lp-sm text-[#5c5c58]">兼容微信 4.0 与 3.9，私人聊天白名单隔离</span>
              <span className="lp-sm inline-flex items-center gap-1.5 font-semibold text-[#12804a]">
                <Send className="size-3.5" />
                半自动一键上屏
              </span>
            </div>
          </div>

          <div className="mt-8 border-t border-black/[0.08] pt-6">
            <h3 className="lp-body font-semibold text-[#151514]">个人微信零封号工作台</h3>
            <p className="lp-body mt-2 text-[#5c5c58]">
              彻底告别高危内存 Hook 与外挂群控。桌面端仅本地只读同步白名单客户会话；发送时自动唤起微信并定位粘贴，绝不自动按回车，零误发、零封号，且发出后自动完成状态回执。
            </p>
          </div>
        </article>

        {/* 面板 2（5列）：全渠道外贸生态流动带 */}
        <article className="lp-surface-panel flex flex-col justify-between overflow-hidden p-7 lg:col-span-5">
          <div className="lp-marquee-wrap -mx-7 space-y-3 overflow-hidden py-3 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
            <div className="lp-marquee-track gap-6">
              {[...MARQUEE_ROW_1, ...MARQUEE_ROW_1].map((item, idx) => (
                <span key={`r1-${idx}`} className="lp-body shrink-0 font-medium text-[#151514]">
                  {item}
                </span>
              ))}
            </div>
            <div className="lp-marquee-track-rev gap-6">
              {[...MARQUEE_ROW_2, ...MARQUEE_ROW_2].map((item, idx) => (
                <span key={`r2-${idx}`} className="lp-body shrink-0 font-medium text-[#0063d1]">
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-black/[0.08] pt-5">
            <h3 className="lp-body font-semibold text-[#151514]">打通全部外贸沟通与效率工具</h3>
            <p className="lp-body mt-2 text-[#5c5c58]">
              邮件、WhatsApp、个人微信、五大海外社媒与多模态文件预览原生互通，不必在十几个窗口之间反复切换。
            </p>
          </div>
        </article>

        {/* 面板 3（5列）：深墨色高对比隐私与隔离建筑卡 */}
        <article className="flex flex-col justify-between rounded-[28px] bg-[#151514] p-7 text-white shadow-[0_20px_48px_-20px_rgba(21,21,20,0.45)] lg:col-span-5">
          <div>
            <div className="flex items-center gap-2.5 text-[#8cc3ff]">
              <FolderLock className="size-5" />
              <span className="lp-sm font-medium">本机与企业双重边界</span>
            </div>
            <h3 className="lp-body mt-4 font-semibold text-white">客户资产留在企业，隐私边界清晰</h3>
            <p className="lp-body mt-2 text-white/72">
              桌面端钥匙串加密保存令牌，微信白名单模式确保私人聊天绝不上传，并支持自有服务器私有化部署。
            </p>
          </div>

          <dl className="mt-6 divide-y divide-white/12 border-t border-white/12">
            {[
              { k: "微信白名单", v: "仅同步客户会话" },
              { k: "设备令牌", v: "系统钥匙串加密" },
              { k: "车车浏览器", v: "独立指纹与代理" },
              { k: "操作审计", v: "全链路日志留痕" },
            ].map((row) => (
              <div key={row.k} className="flex items-center justify-between py-2.5">
                <dt className="lp-sm text-white/65">{row.k}</dt>
                <dd className="lp-sm font-medium text-white">{row.v}</dd>
              </div>
            ))}
          </dl>
        </article>

        {/* 面板 4（8列）：团队多人协同、防撞单与审批流 */}
        <article className="lp-surface-panel flex flex-col justify-between p-7 sm:p-8 lg:col-span-8">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.08] pb-5">
              <div>
                <p className="lp-body font-semibold text-[#151514]">中东大客户跟进组</p>
                <p className="lp-sm text-[#5c5c58]">查重保护与多级审批已开启</p>
              </div>
              <div className="flex -space-x-2">
                <span className="lp-sm flex size-9 items-center justify-center rounded-full bg-[#0063d1] font-medium text-white ring-2 ring-white">
                  王
                </span>
                <span className="lp-sm flex size-9 items-center justify-center rounded-full bg-[#12804a] font-medium text-white ring-2 ring-white">
                  李
                </span>
                <span className="flex size-9 items-center justify-center rounded-full bg-[#f6f9fd] ring-2 ring-white">
                  <AgentAvatar name="AI" size="xs" appearance={{ color: "sky", eyes: "dots" }} framed={false} />
                </span>
              </div>
            </div>

            <div className="mt-5 grid gap-6 sm:grid-cols-3">
              {[
                {
                  title: "防撞单查重",
                  desc: "按邮箱域名、电话、微信号实时查重拦截，避免内部抢客。",
                },
                {
                  title: "公海自动回收",
                  desc: "超期未跟进自动回公海，支持按客群定制天数与每日限领。",
                },
                {
                  title: "多级审批流",
                  desc: "超折扣报价、退公海、转移或删除客户一键推送主管审批。",
                },
              ].map((b) => (
                <div key={b.title}>
                  <p className="lp-sm font-semibold text-[#151514]">{b.title}</p>
                  <p className="lp-sm mt-1.5 text-[#5c5c58]">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-7 border-t border-black/[0.08] pt-5">
            <h3 className="lp-body font-semibold text-[#151514]">多人协同、公海流转与规范审批</h3>
            <p className="lp-body mt-2 text-[#5c5c58]">
              支持树形部门与三级数据范围隔离，社媒联系方式可开启脱敏权限；业务员离职后客户资产与聊天记录完整留存企业。
            </p>
          </div>
        </article>

        {/* 面板 5（4列×2行）：自动化外贸工作流 */}
        <article className="lp-surface-panel flex flex-col justify-between p-7 lg:col-span-4 lg:row-span-2">
          <div>
            <div className="border-b border-black/[0.08] pb-4">
              <p className="lp-sm font-medium text-[#0063d1]">实时触发</p>
              <p className="lp-body mt-1 font-semibold text-[#151514]">海外新询盘进入工作台</p>
              <p className="lp-sm text-[#5c5c58]">邮件、WhatsApp、微信或 TikTok 私信</p>
            </div>

            <svg viewBox="0 0 220 32" className="mx-auto h-8 w-48" aria-hidden>
              <path
                d="M110 0 V14 M110 14 H52 V32 M110 14 H168 V32"
                fill="none"
                stroke="#0063d1"
                strokeWidth="1.6"
                className="lp-dash-line"
              />
            </svg>

            <div className="grid grid-cols-2 gap-4 border-y border-black/[0.08] py-4">
              <div>
                <p className="lp-sm font-semibold text-[#151514]">意图与翻译</p>
                <p className="lp-sm mt-1 text-[#5c5c58]">识别高意向并译中文</p>
              </div>
              <div>
                <p className="lp-sm font-semibold text-[#151514]">联网背调</p>
                <p className="lp-sm mt-1 text-[#5c5c58]">穿透官网与社媒背景</p>
              </div>
            </div>

            <svg viewBox="0 0 220 32" className="mx-auto h-8 w-48" aria-hidden>
              <path
                d="M52 0 V18 H110 V32 M168 0 V18 H110"
                fill="none"
                stroke="#7c4dff"
                strokeWidth="1.6"
                className="lp-dash-line"
              />
            </svg>

            <div className="border-y border-black/[0.08] py-4">
              <p className="lp-sm inline-flex items-center gap-1.5 font-semibold text-[#151514]">
                <Sparkles className="size-4 text-[#0063d1]" />
                生成报价单与写入记忆
              </p>
              <p className="lp-sm mt-1 text-[#5c5c58]">自动套用公司样本、汇率快照与条款</p>
            </div>

            <svg viewBox="0 0 220 26" className="mx-auto h-7 w-48" aria-hidden>
              <path d="M110 0 V26" fill="none" stroke="#12804a" strokeWidth="1.6" className="lp-dash-line" />
            </svg>

            <div className="rounded-2xl bg-[#dcf7e6]/70 px-4 py-3.5">
              <p className="lp-sm font-semibold text-[#12804a]">人工核对拍板</p>
              <p className="lp-sm mt-0.5 text-[#151514]">主管审批或业务员确认后发出</p>
            </div>
          </div>

          <div className="mt-7 border-t border-black/[0.08] pt-5">
            <h3 className="lp-body font-semibold text-[#151514]">自动化外贸工作流</h3>
            <p className="lp-body mt-2 text-[#5c5c58]">
              AI 处理九成的信息整理、背调、翻译与制单，把报价审批与最终发送交由人来拍板，效率与风控兼得。
            </p>
          </div>
        </article>

        {/* 面板 6（8列）：客户文件原样预览与 AI 多模态审单 */}
        <article className="lp-surface-panel flex flex-col justify-between p-7 sm:p-8 lg:col-span-8">
          <div className="grid gap-6 border-b border-black/[0.08] pb-6 sm:grid-cols-[1.05fr_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <FileSearch className="size-4 text-[#0063d1]" />
                <span className="lp-sm font-semibold text-[#151514]">L_C_Draft_Dubai_Scanned.pdf</span>
              </div>
              <p className="lp-sm mt-1 text-[#5c5c58]">扫描件自动裁白边逐页渲染，支持 Word 与 Excel 原样预览</p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {["第 1 页 抬头", "第 2 页 装运", "第 3 页 单据"].map((p) => (
                  <div key={p} className="rounded-xl bg-[#f3f3f0] px-3 py-3 text-center">
                    <div className="mx-auto h-10 w-8 rounded bg-white shadow-2xs ring-1 ring-black/[0.06]" />
                    <p className="lp-sm mt-2 text-[#5c5c58]">{p}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-black/[0.08] pt-5 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
              <p className="lp-sm font-semibold text-[#0063d1]">AI 审单解读</p>
              <ul className="mt-3 space-y-2 text-[#2a2a28]">
                <li className="lp-sm">发现软条款：46A 要求买方检验证书</li>
                <li className="lp-sm tabular-nums">最迟装运期：2026-12-20（剩余 23 天）</li>
                <li className="lp-sm">已自动关联至订单 SO-20261108 文件库</li>
              </ul>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="lp-body font-semibold text-[#151514]">客户文件原样预览与 AI 多模态审单</h3>
            <p className="lp-body mt-2 text-[#5c5c58]">
              形式发票、产地证、信用证扫描件与报价表无需下载即可全宽在线预览；扫描版 PDF 自动交由 AI 逐页识别条款，并支持一键发给客户。
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
