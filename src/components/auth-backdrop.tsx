"use client";

import { useEffect, useState } from "react";
import { MeshGradient } from "@paper-design/shaders-react";

/*
 * 登录 / 注册页的动态背景：Paper Shaders 的 MeshGradient（Apache-2.0，https://github.com/paper-design/shaders）。
 * 暖色网格渐变缓慢流动，叠一层细颗粒；系统开了「减少动态效果」就停在一帧。
 */
const COLORS = ["#06142e", "#0a3f9c", "#2b74e6", "#78b4ff", "#101a3a"];

export function AuthBackdrop() {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[#06142e]">
      <MeshGradient
        colors={COLORS}
        distortion={0.85}
        swirl={0.35}
        grainMixer={0}
        grainOverlay={0.12}
        speed={still ? 0 : 0.35}
        maxPixelCount={1920 * 1080}
        className="absolute inset-0 size-full"
      />
      {/* 左侧压暗，保证白字对比度 */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_0%_100%,rgba(20,12,9,0.7),transparent_60%)]" />
    </div>
  );
}
