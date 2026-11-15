import { platformInfo } from "@/lib/social";
import { cn } from "@/lib/utils";

/*
 * 社媒平台小图标：平台色圆角方块 + 简化字形（不用各平台的官方标志文件）。
 * 服务端、客户端组件都能用。
 */
function Glyph({ platform }: { platform: string }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (platform) {
    case "linkedin":
      return (
        <>
          <path d="M7 10v7M7 7v.01M11 17v-4a2 2 0 0 1 4 0v4M11 10v7" {...s} />
        </>
      );
    case "facebook":
      return <path d="M14 7h-1.5A2.5 2.5 0 0 0 10 9.5V18M8 12h5" {...s} />;
    case "instagram":
      return (
        <>
          <rect x="6" y="6" width="12" height="12" rx="3.5" {...s} />
          <circle cx="12" cy="12" r="2.8" {...s} />
          <circle cx="15.6" cy="8.4" r=".6" fill="currentColor" />
        </>
      );
    case "youtube":
      return <path d="M10 9l5 3-5 3z" fill="currentColor" />;
    case "tiktok":
      return <path d="M13 6v8.5a2.5 2.5 0 1 1-2.5-2.5M13 6c.4 1.8 1.7 3 3.5 3.2" {...s} />;
    case "x":
      return <path d="M7 7l10 10M17 7l-10 10" {...s} />;
    case "pinterest":
      return <path d="M12 6a4.5 4.5 0 0 0-1.6 8.7M11 11l-1.8 7M12 6a4.5 4.5 0 0 1 0 9c-1.2 0-2-.6-2-.6" {...s} />;
    case "vk":
      return <path d="M6 9c.5 4 2.5 6 6 6v-3c1.5 0 2.5 1.5 3 3M12 9v3c1.5 0 2.5-1.5 3-3" {...s} />;
    case "whatsapp":
      return <path d="M7.5 16.5l.7-2.4A4.8 4.8 0 1 1 10 16l-2.5.5zM10.5 10.5c.3 1.3 1.5 2.5 3 3" {...s} />;
    case "wechat":
      return (
        <>
          <ellipse cx="10.5" cy="10.5" rx="4" ry="3.2" {...s} />
          <ellipse cx="14" cy="14" rx="3.4" ry="2.6" {...s} />
        </>
      );
    case "email":
      return (
        <>
          <rect x="5.5" y="7.5" width="13" height="9" rx="1.5" {...s} />
          <path d="M6 8.5l6 4.5 6-4.5" {...s} />
        </>
      );
    case "telegram":
      return <path d="M6 11.5L17.5 7l-2 10-3.5-3-2 2v-3l5-4.5" {...s} />;
    default:
      return (
        <>
          <circle cx="12" cy="12" r="5.5" {...s} />
          <path d="M6.5 12h11M12 6.5c1.6 1.5 2.4 3.4 2.4 5.5S13.6 16 12 17.5M12 6.5C10.4 8 9.6 9.9 9.6 12s.8 4 2.4 5.5" {...s} />
        </>
      );
  }
}

export function SocialIcon({ platform, className, title }: { platform: string; className?: string; title?: string }) {
  const p = platformInfo(platform);
  const bg = platform === "instagram" ? "linear-gradient(135deg,#f58529 0%,#dd2a7b 50%,#8134af 100%)" : p.color;
  return (
    <span
      className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-white", className)}
      style={{ background: bg }}
      title={title ?? p.label}
    >
      <svg viewBox="0 0 24 24" className="size-[70%]" aria-hidden>
        <Glyph platform={p.key} />
      </svg>
    </span>
  );
}
