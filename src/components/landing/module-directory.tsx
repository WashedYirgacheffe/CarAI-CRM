"use client";

import { useState } from "react";
import {
  BarChart3,
  Bot,
  Globe,
  MessagesSquare,
  Package,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MODULE_GROUPS = [
  {
    id: "inbox",
    shortLabel: "多渠道沟通",
    title: "多渠道沟通与统一收件箱",
    summary: "把微信、WhatsApp、外贸邮箱与海外社媒私信汇总进同一工作台，外文消息实时翻译并关联客户档案。",
    color: "#12804a",
    icon: MessagesSquare,
    items: [
      {
        name: "个人微信独立工作台",
        detail: "白名单只读同步客户会话，发送时自动搜索定位并粘贴上屏，人工核对后发出并自动完成回执闭环。",
      },
      {
        name: "WhatsApp 双向直连",
        detail: "支持手机号配对码与扫码直连，收发消息、图片与报价单 PDF 文件，全部自动归档至对应客户。",
      },
      {
        name: "企业邮箱全量同步",
        detail: "兼容 IMAP 与 SMTP，按公司域名自动匹配归档客户往来邮件，支持多账号统一管理。",
      },
      {
        name: "海外社媒统一私信",
        detail: "汇集 TikTok、Instagram、Facebook、LinkedIn 与 X 的客户私信，在同一视图内回复跟进。",
      },
      {
        name: "25+ 语种外文秒译",
        detail: "阿语、俄语、西语、法语、英语等外文询盘自动翻译成中文，业务员直接看懂并快速回复。",
      },
      {
        name: "变量快捷回复模板",
        detail: "高频报价、装运与催款话术一键调用，自动替换客户名、联系人与公司抬头。",
      },
    ],
  },
  {
    id: "ai",
    shortLabel: "AI 副驾驶",
    title: "车车 AI 副驾驶与自动化执行",
    summary: "深度接入客户、商机、报价与文件上下文，替业务员完成背调、制单、审单与每日跟进整理。",
    color: "#0063d1",
    icon: Bot,
    items: [
      {
        name: "对话式全量业务执行",
        detail: "直接用自然语言查客户、更新字段、创建商机与跟进提醒，减少手工表单录入。",
      },
      {
        name: "客户长期记忆自动沉淀",
        detail: "从微信、WhatsApp 与邮件往来中持续提炼客户背景、车型偏好与下次跟进建议。",
      },
      {
        name: "联网客户背调",
        detail: "自动穿透买家官网、公开社媒与企业信息，快速生成可用于破冰的背景摘要。",
      },
      {
        name: "AI 外贸单据工作台",
        detail: "按本公司抬头与样本格式生成 PI、CI、PL、销售合同等 10 种常用外贸单据。",
      },
      {
        name: "邮件意图与高意向标注",
        detail: "自动识别询盘紧迫度与采购意向，生成邮件摘要并把高价值买家排在最前面。",
      },
      {
        name: "多模态文件解读",
        detail: "扫描版 PDF 信用证自动裁白边按页识别关键条款，Word 与 Excel 报价表在线原样预览。",
      },
    ],
  },
  {
    id: "social",
    shortLabel: "社媒与获客",
    title: "海外获客、社媒矩阵与邮件营销",
    summary: "独立指纹环境守护多账号安全，从社媒拓客、邮件序列触达到访客追踪形成完整获客链路。",
    color: "#7c4dff",
    icon: Globe,
    items: [
      {
        name: "内置车车浏览器防关联",
        detail: "基于 Camoufox 为每个海外社媒账号分配独立硬件指纹与代理 IP，避免多账号串号。",
      },
      {
        name: "桌面端静默监听私信",
        detail: "常驻后台持续拉取海外社媒新私信，账号状态与封面快照实时可见。",
      },
      {
        name: "浏览器环境加密迁移",
        detail: "支持把已登录的社媒浏览器环境加密打包，在多台电脑或云端之间切换免重复扫码。",
      },
      {
        name: "自动化邮件营销序列",
        detail: "编排多步开发信跟进节奏，全量追踪邮件打开、链接点击与退订状态。",
      },
      {
        name: "销售对外聚合主页",
        detail: "为每位业务员生成专属对外名片页，记录海外访客来源与浏览行为。",
      },
      {
        name: "陌生询盘自动建档",
        detail: "新来信与社媒询盘自动给出建档建议，大客户星级社媒动态持续跟踪。",
      },
    ],
  },
  {
    id: "trade",
    shortLabel: "交易与公海",
    title: "客户公海、商机看板与交易闭环",
    summary: "从线索分配、多币种报价到出运物流与分期收款，每一笔外贸订单的进度与资金状态一目了然。",
    color: "#00a896",
    icon: Package,
    items: [
      {
        name: "客户 360 度档案与查重",
        detail: "按邮箱域名、手机号、WhatsApp 与微信号多维查重，从录入源头杜绝内部撞单。",
      },
      {
        name: "公海自动回收流转",
        detail: "按客群自定义超期未跟进回收天数，支持设置每日领取上限与私海容量保护。",
      },
      {
        name: "商机看板与多币种产品库",
        detail: "可视化拖拽推进商机阶段，产品库支持高清图片、视频展示与多币种定价。",
      },
      {
        name: "锁定汇率报价一键转单",
        detail: "多币种报价单自动锁定汇率快照，切换币种即时折算，确认后一键转为正式订单。",
      },
      {
        name: "出运单证与分期回款",
        detail: "跟踪提单、报关单与产地证进度，管理定金与尾款计划，自动提醒逾期应收账款。",
      },
      {
        name: "外贸日常效率工作台",
        detail: "自定义工作台画布，集成重点市场世界时钟、实时汇率换算与每日待办中心。",
      },
    ],
  },
  {
    id: "security",
    shortLabel: "权限与风控",
    title: "团队权限隔离、审批流与安全审计",
    summary: "为多部门协作的外贸企业建立清晰的数据边界、规范的价格审批与可追溯的操作审计。",
    color: "#b25e00",
    icon: ShieldCheck,
    items: [
      {
        name: "多租户与树形部门架构",
        detail: "企业数据彻底隔离，灵活配置分公司、业务部门与自定义角色权限点。",
      },
      {
        name: "三级精细化数据可见范围",
        detail: "支持按仅本人、本部门及下级、全公司三级控制客户、商机与跟进记录可见范围。",
      },
      {
        name: "关键业务多级审批流",
        detail: "超折扣报价、退回公海、删除或转移客户自动触发主管审批，守住利润与客户资产。",
      },
      {
        name: "社媒联系方式脱敏保护",
        detail: "按角色隐藏海外买家的主页链接与直连方式，降低私下飞单与客户流失风险。",
      },
      {
        name: "全链路操作审计日志",
        detail: "客户转移、报价变更、审批通过与权限调整全部留痕，关键节点有据可查。",
      },
      {
        name: "业绩转化与跟进报表",
        detail: "统计团队签约额、询盘来源转化漏斗与每日沟通量，辅助管理者复盘业务。",
      },
    ],
  },
  {
    id: "deploy",
    shortLabel: "多端与部署",
    title: "多终端协作与企业级私有化部署",
    summary: "覆盖 Windows、macOS、Web 与移动端，同时支持云端开箱即用与企业自有服务器独立部署。",
    color: "#e5487a",
    icon: BarChart3,
    items: [
      {
        name: "Windows 桌面主力版",
        detail: "完整支持个人微信 4.0 与 3.9 本地桥接，系统托盘一键检测并静默自动更新。",
      },
      {
        name: "macOS 原生桌面版",
        detail: "同时提供 Apple Silicon 原生包与 Intel 兼容包，流畅运行本地社媒矩阵与快捷上屏。",
      },
      {
        name: "移动端 PWA 随时跟单",
        detail: "外出跑展会或拜访客户时，手机浏览器即可回消息、查报价、用 AI 助手与批审批。",
      },
      {
        name: "私有签名存储与在线预览",
        detail: "附件经阿里云 OSS 私有签名保护，PDF 与 Office 文档无需下载即可全宽原样预览。",
      },
      {
        name: "A4 规范报价单直接打印",
        detail: "内置外贸标准 A4 打印排版页，直接导出高清晰度 PDF 发给海外买家。",
      },
      {
        name: "Docker Compose 私有化部署",
        detail: "支持部署在企业自有阿里云或腾讯云服务器，配套自动 HTTPS 与每日定时备份。",
      },
    ],
  },
] as const;

export function ModuleDirectorySection() {
  const [activeId, setActiveId] = useState<(typeof MODULE_GROUPS)[number]["id"]>("inbox");
  const current = MODULE_GROUPS.find((g) => g.id === activeId) ?? MODULE_GROUPS[0];
  const Icon = current.icon;

  return (
    <section id="modules" className="mx-auto max-w-[1160px] scroll-mt-24 px-5 py-24 sm:py-32">
      <div className="max-w-3xl">
        <h2 className="lp-h2 font-brand font-semibold text-balance text-[#151514]">
          覆盖外贸全链路的 36 项落地能力
        </h2>
        <p className="lp-body mt-4 max-w-[58ch] text-[#5c5c58]">
          不止于收发消息和记录客户，从海外社媒获客、AI 制单审单到公海防撞单、出运物流与分期回款，全部开箱即用。
        </p>
      </div>

      {/* 连接式分段标签栏（非零散按钮堆砌） */}
      <div
        role="tablist"
        aria-label="功能模块分类"
        className="mt-10 inline-flex max-w-full flex-wrap items-center gap-1 rounded-2xl bg-[#f3f3f0] p-1.5"
      >
        {MODULE_GROUPS.map((g) => {
          const active = g.id === activeId;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveId(g.id)}
              className={cn(
                "lp-sm rounded-xl px-4 py-2 font-medium transition-colors duration-150",
                active
                  ? "bg-white text-[#151514] shadow-[0_1px_3px_rgba(21,21,20,0.08)]"
                  : "text-[#5c5c58] hover:text-[#151514]",
              )}
            >
              {g.shortLabel}
            </button>
          );
        })}
      </div>

      {/* 当前模块头部与 1px 细线分隔的 2 列编辑排版目录 */}
      <div
        role="tabpanel"
        className="mt-8 rounded-[28px] bg-white p-7 shadow-[0_1px_2px_rgba(21,21,20,0.04),0_12px_32px_-16px_rgba(21,21,20,0.08),0_0_0_1px_rgba(21,21,20,0.075)] sm:p-10"
      >
        <div className="flex flex-col gap-3 border-b border-black/[0.08] pb-7 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <span
              style={{ color: current.color, backgroundColor: `${current.color}14` }}
              className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl"
            >
              <Icon className="size-5" />
            </span>
            <div>
              <h3 className="lp-body font-semibold text-[#151514]">{current.title}</h3>
              <p className="lp-body mt-1 max-w-[60ch] text-[#5c5c58]">{current.summary}</p>
            </div>
          </div>
        </div>

        <ul className="mt-2 grid grid-cols-1 divide-y divide-black/[0.07] md:grid-cols-2 md:gap-x-12 md:divide-y-0">
          {current.items.map((item, idx) => (
            <li
              key={item.name}
              className={cn(
                "py-5 md:border-b md:border-black/[0.07]",
                idx >= current.items.length - 2 && "md:border-b-0 md:pb-1",
              )}
            >
              <p className="lp-body font-semibold text-[#151514]">{item.name}</p>
              <p className="lp-body mt-1.5 text-[#5c5c58]">{item.detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
