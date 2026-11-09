"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** 名字 → 固定色相，同一个人每次颜色一样 */
function hueOf(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** 取首字：中文取最后一个字（姓名里的名），英文取前两个单词首字母，纯号码取后两位 */
function initialsOf(name: string | null, phone: string | null) {
  const n = name?.trim();
  if (n) {
    if (/^[一-龥]/.test(n)) return n.slice(-1);
    const words = n.replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean);
    if (words.length) return (words[0][0] + (words[1]?.[0] ?? "")).toUpperCase();
  }
  return phone ? phone.slice(-2) : "?";
}

/**
 * WhatsApp 头像：有图显示图（走鉴权接口），没有或加载失败时显示彩色首字。
 * src 变化（换头像）时重新尝试加载。
 */
export function WaAvatar({
  src,
  name,
  phone,
  className,
}: {
  src?: string | null;
  name: string | null;
  phone: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const hue = hueOf(name || phone || "?");
  const showImg = src && failed !== src;
  return (
    <span
      className={cn("relative inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none", className)}
      style={{ background: `oklch(0.93 0.045 ${hue})`, color: `oklch(0.42 0.12 ${hue})` }}
      aria-hidden
    >
      <span className="text-[0.95em] leading-none">{initialsOf(name, phone)}</span>
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element -- 走鉴权接口，不能用 next/image
        <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} className="absolute inset-0 size-full object-cover" />
      )}
    </span>
  );
}
