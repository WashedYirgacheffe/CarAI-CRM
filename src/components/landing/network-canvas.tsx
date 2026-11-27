"use client";

import { useEffect, useRef, useState } from "react";
import { AgentAvatar } from "@/components/agentes/agent-avatar";

const NODES = [
  { id: "wechat", label: "个人微信", sub: "只读同步 + 一键上屏", color: "#12804a", angle: -155 },
  { id: "whatsapp", label: "WhatsApp", sub: "双端直连 + 外文秒译", color: "#16a34a", angle: -110 },
  { id: "mail", label: "外贸邮件", sub: "IMAP/SMTP 追踪与序列", color: "#4f46e5", angle: -65 },
  { id: "matrix", label: "社媒矩阵", sub: "TikTok/IG/LI 指纹防关联", color: "#7c4dff", angle: -20 },
  { id: "doc", label: "AI 单据", sub: "10 种外贸单据套版", color: "#00a896", angle: 25 },
  { id: "files", label: "多模态文件", sub: "PDF/Office 原样预览解读", color: "#0063d1", angle: 70 },
  { id: "orders", label: "订单与物流", sub: "出运单证与分期回款", color: "#b25e00", angle: 115 },
  { id: "pool", label: "客户公海", sub: "查重防撞单与审批审计", color: "#e5487a", angle: 160 },
] as const;

/**
 * 1:1 复刻 openbot.run Section 1 全宽协作粒子路由网络（适配 CarAI 亮白纸面与活体 AgentAvatar 中枢）
 */
export function NetworkCanvasSection() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0;
    let h = 0;

    type Packet = { nodeIdx: number; progress: number; speed: number; inbound: boolean };
    const packets: Packet[] = Array.from({ length: 28 }, (_, i) => ({
      nodeIdx: i % NODES.length,
      progress: Math.random(),
      speed: 0.004 + Math.random() * 0.004,
      inbound: i % 2 === 0,
    }));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const nodePos = (angleDeg: number) => {
      const rad = (angleDeg * Math.PI) / 180;
      const rx = Math.min(w * 0.38, 400);
      const ry = Math.min(h * 0.36, 200);
      return { x: w / 2 + Math.cos(rad) * rx, y: h / 2 + Math.sin(rad) * ry };
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;

      // 中心柔光晕
      const glow = ctx.createRadialGradient(cx, cy, 12, cx, cy, 190);
      glow.addColorStop(0, "rgba(0, 99, 209, 0.14)");
      glow.addColorStop(1, "rgba(251, 251, 250, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, 190, 0, Math.PI * 2);
      ctx.fill();

      // 虚线连接轨道
      NODES.forEach((n) => {
        const pos = nodePos(n.angle);
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = hovered === n.id ? n.color : "rgba(21, 21, 20, 0.14)";
        ctx.lineWidth = hovered === n.id ? 2 : 1.2;
        ctx.moveTo(cx, cy);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.restore();
      });

      // 流动像素光点
      for (const pk of packets) {
        if (!reduced) {
          pk.progress += pk.speed;
          if (pk.progress >= 1) pk.progress = 0;
        }
        const n = NODES[pk.nodeIdx];
        const pos = nodePos(n.angle);
        const t = pk.inbound ? 1 - pk.progress : pk.progress;
        const x = cx + (pos.x - cx) * t;
        const y = cy + (pos.y - cy) * t;

        ctx.fillStyle = n.color;
        ctx.globalAlpha = Math.sin(pk.progress * Math.PI) * 0.9;
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
      ctx.globalAlpha = 1;

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [hovered]);

  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      <div className="mx-auto max-w-3xl px-5 text-center">
        <p className="font-dot text-xs tracking-[0.2em] text-[#0063d1] uppercase">UNIFIED AI MEMORY HUB</p>
        <h2 className="mt-3 font-brand text-3xl font-semibold tracking-[-0.03em] text-[#151514] sm:text-5xl">
          一个 AI 大脑，串联全外贸链路。
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-[#5c5c58] sm:text-base">
          微信、WhatsApp、邮件与海外社媒不再是信息孤岛。所有对话、文件与报价实时汇入车车 AI 记忆中枢，自动驱动建档、翻译、审单与跟进。
        </p>
      </div>

      {/* 交互式网络画布舞台 */}
      <div className="relative mx-auto mt-10 h-[500px] max-w-[1140px] sm:h-[560px]">
        <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" />

        {/* 中央 CarAI 活体中枢 */}
        <div className="absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
          <div className="relative flex size-24 items-center justify-center rounded-[28px] bg-white shadow-[0_20px_50px_-14px_rgba(0,99,209,0.32),0_0_0_1px_rgba(0,99,209,0.2)]">
            <AgentAvatar name="CarAI Hub" size="lg" state="thinking" appearance={{ color: "sky", eyes: "dots" }} />
          </div>
          <span className="mt-2.5 rounded-full bg-[#151514] px-3 py-0.5 text-[11px] font-medium text-white shadow-xs">
            车车 AI 中枢
          </span>
        </div>

        {/* 周围 8 大外贸业务节点（按极坐标排布，移动端兜底网格在下方展示） */}
        <div className="hidden md:block">
          {NODES.map((n) => {
            const rad = (n.angle * Math.PI) / 180;
            const leftPct = 50 + Math.cos(rad) * 37;
            const topPct = 50 + Math.sin(rad) * 37;
            return (
              <div
                key={n.id}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-2xl bg-white px-3.5 py-2.5 shadow-[0_8px_24px_-8px_rgba(21,21,20,0.14),0_0_0_1px_rgba(21,21,20,0.08)] transition-transform duration-200 hover:scale-105"
              >
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: n.color }} />
                  <span className="text-xs font-semibold text-[#151514]">{n.label}</span>
                </div>
                <p className="mt-0.5 whitespace-nowrap text-[10px] text-[#6f6f6a]">{n.sub}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 移动端紧凑 2 列节点列表 */}
      <div className="mx-auto mt-2 grid max-w-md grid-cols-2 gap-2.5 px-5 md:hidden">
        {NODES.map((n) => (
          <div key={n.id} className="surface p-3">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: n.color }} />
              <span className="text-xs font-semibold">{n.label}</span>
            </div>
            <p className="mt-0.5 text-[10px] text-[#6f6f6a]">{n.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
