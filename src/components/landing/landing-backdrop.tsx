"use client";

import { useEffect, useState } from "react";
import { MeshGradient } from "@paper-design/shaders-react";

const HERO_COLORS = ["#050914", "#0b2563", "#1d4ed8", "#4f46e5", "#091224"];

export function LandingBackdrop() {
  const [still, setStill] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[920px] overflow-hidden">
      <MeshGradient
        colors={HERO_COLORS}
        distortion={0.78}
        swirl={0.32}
        grainMixer={0}
        grainOverlay={0.14}
        speed={still ? 0 : 0.28}
        maxPixelCount={1920 * 1080}
        className="absolute inset-0 size-full opacity-90"
      />
      {/* 细工程网格线 + 底部平滑融入深空底色 */}
      <div
        className="absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.12) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 25%, black 35%, transparent 100%)",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_0%,rgba(96,165,250,0.22),transparent_65%)]" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-[#050811] via-[#050811]/80 to-transparent" />
    </div>
  );
}
