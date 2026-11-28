"use client";

import { useEffect, useRef, useState } from "react";
import { AgentAvatar } from "@/components/agentes/agent-avatar";

const NODES = [
  { id: "wechat", label: "个人微信", sub: "只读同步与一键上屏", color: "#12804a", angle: -155 },
  { id: "whatsapp", label: "WhatsApp", sub: "双向直连与外文秒译", color: "#16a34a", angle: -110 },
  { id: "mail", label: "外贸邮件", sub: "收发追踪与营销序列", color: "#4f46e5", angle: -65 },
  { id: "matrix", label: "社媒矩阵", sub: "独立指纹防关联监听", color: "#7c4dff", angle: -20 },
  { id: "doc", label: "AI 单据", sub: "10 种外贸单据套版", color: "#00a896", angle: 25 },
  { id: "files", label: "多模态文件", sub: "原样预览与条款审单", color: "#0063d1", angle: 70 },
  { id: "orders", label: "订单与物流", sub: "出运单证与分期回款", color: "#b25e00", angle: 115 },
  { id: "pool", label: "客户公海", sub: "查重防撞单与审批", color: "#e5487a", angle: 160 },
] as const;

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
      const rx = Math.min(w * 0.37, 400);
      const ry = Math.min(h * 0.35, 196);
      return { x: w / 2 + Math.cos(rad) * rx, y: h / 2 + Math.sin(rad) * ry };
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;

      const glow = ctx.createRadialGradient(cx, cy, 12, cx, cy, 190);
      glow.addColorStop(0, "rgba(0, 99, 209, 0.14)");
      glow.addColorStop(1, "rgba(246, 249, 253, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, 190, 0, Math.PI * 2);
      ctx.fill();

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
    <section className="relative overflow-hidden border-y border-black/[0.06] bg-[#f6f9fd] py-24 sm:py-32">
      <div className="mx-auto max-w-3xl px-5 text-center">
        <h2 className="lp-h2 font-brand font-semibold text-[#151514]">
          一个 AI 大脑，串联全部外贸链路
        </h2>
        <p className="lp-body mx-auto mt-4 max-w-[58ch] text-[#5c5c58]">
          微信、WhatsApp、邮件与海外社媒不再各自为战。所有对话、文件与报价实时汇入车车 AI 记忆中枢，自动驱动建档、翻译、审单与跟进。
        </p>
      </div>

      {/* 交互式网络画布舞台（桌面端极坐标排布） */}
      <div className="relative mx-auto mt-10 hidden h-[540px] max-w-[1140px] md:block">
        <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" />

        <div className="absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
          <div className="relative flex size-24 items-center justify-center rounded-[28px] bg-white shadow-[0_20px_50px_-14px_rgba(0,99,209,0.28),0_0_0_1px_rgba(0,99,209,0.18)]">
            <AgentAvatar name="CarAI Hub" size="lg" state="thinking" appearance={{ color: "sky", eyes: "dots" }} />
          </div>
          <p className="lp-sm mt-3 font-semibold text-[#151514]">车车 AI 中枢</p>
        </div>

        {NODES.map((n) => {
          const rad = (n.angle * Math.PI) / 180;
          const leftPct = 50 + Math.cos(rad) * 37;
          const topPct = 50 + Math.sin(rad) * 36;
          return (
            <div
              key={n.id}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ left: `${leftPct}%`, top: `${topPct}%` }}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-2xl bg-white px-4 py-3 shadow-[0_8px_24px_-10px_rgba(21,21,20,0.14),0_0_0_1px_rgba(21,21,20,0.08)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-105"
            >
              <div className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: n.color }} />
                <span className="lp-sm font-semibold text-[#151514]">{n.label}</span>
              </div>
              <p className="lp-sm mt-0.5 whitespace-nowrap text-[#5c5c58]">{n.sub}</p>
            </div>
          );
        })}
      </div>

      {/* 移动端简洁 2 列清单（无嵌套卡片） */}
      <div className="mx-auto mt-10 max-w-lg px-5 md:hidden">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-white shadow-[0_12px_28px_-10px_rgba(0,99,209,0.25),0_0_0_1px_rgba(0,99,209,0.16)]">
            <AgentAvatar name="CarAI Hub" size="md" state="thinking" appearance={{ color: "sky", eyes: "dots" }} />
          </div>
          <p className="lp-body font-semibold text-[#151514]">车车 AI 记忆中枢</p>
        </div>
        <div className="grid grid-cols-1 divide-y divide-black/[0.08] rounded-2xl bg-white px-5 shadow-[0_1px_2px_rgba(21,21,20,0.04),0_0_0_1px_rgba(21,21,20,0.07)]">
          {NODES.map((n) => (
            <div key={n.id} className="flex items-center justify-between gap-3 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: n.color }} />
                <span className="lp-body font-semibold text-[#151514]">{n.label}</span>
              </div>
              <span className="lp-sm text-[#5c5c58]">{n.sub}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
