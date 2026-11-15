import { SocialIcon } from "@/components/crm/social-icon";
import { bioTheme, platformInfo, type BioLink } from "@/lib/social";

export type BioViewLink = BioLink & {
  /** 点击地址（公开页走 /b/<slug>/go/<id> 记点击；预览直接用原链接） */
  href: string;
  /** 二维码图片地址：上传的图，或按链接生成的 data URL */
  qr?: string | null;
};

/*
 * 聚合主页（Link-in-Bio）的样子：公开页 /b/<slug> 和编辑页的手机预览共用。
 * 不用 hooks，服务端 / 客户端组件都能放。
 */
export function BioView({
  title,
  bio,
  avatar,
  theme,
  links,
  company,
}: {
  title: string;
  bio?: string | null;
  avatar?: string | null;
  theme: string;
  links: BioViewLink[];
  company?: string | null;
}) {
  const t = bioTheme(theme);
  const buttons = links.filter((l) => l.kind === "link" && l.url);
  const qrs = links.filter((l) => l.kind === "qr" && (l.qr || l.image));
  return (
    <div className="min-h-full w-full px-5 pt-12 pb-10" style={{ background: t.bg, color: t.text }}>
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div
          className="flex size-24 items-center justify-center overflow-hidden rounded-full text-3xl font-semibold shadow-md ring-4 ring-white/70"
          style={{ background: t.card, color: t.accent }}
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- 头像走签名链接
            <img src={avatar} alt="" className="size-full object-cover" />
          ) : (
            Array.from(title.trim())[0]?.toUpperCase() ?? "·"
          )}
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight break-words">{title || "未命名"}</h1>
        {company && <p className="mt-0.5 text-sm opacity-70">{company}</p>}
        {bio && <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap opacity-85">{bio}</p>}

        {buttons.length > 0 && (
          <ul className="mt-7 w-full space-y-3">
            {buttons.map((l) => (
              <li key={l.id}>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-[15px] font-medium shadow-sm transition-transform active:scale-[0.98]"
                  style={{ background: t.card, color: t.text }}
                >
                  <SocialIcon platform={l.platform} className="size-8 rounded-xl" />
                  <span className="min-w-0 flex-1 truncate">{l.label || platformInfo(l.platform).label}</span>
                  <span aria-hidden className="opacity-40">
                    ›
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}

        {qrs.length > 0 && (
          <ul className="mt-6 grid w-full grid-cols-2 gap-3">
            {qrs.map((l) => (
              <li key={l.id} className="rounded-2xl p-3 shadow-sm" style={{ background: t.card, color: t.text }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- 二维码是 data URL / 签名链接 */}
                <img src={(l.image || l.qr)!} alt={l.label} className="aspect-square w-full rounded-lg bg-white object-contain p-1" />
                <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium">
                  <SocialIcon platform={l.platform} className="size-4 rounded" />
                  <span className="truncate">{l.label || platformInfo(l.platform).label}</span>
                </p>
              </li>
            ))}
          </ul>
        )}

        {!buttons.length && !qrs.length && <p className="mt-8 text-sm opacity-60">还没有添加链接</p>}
      </div>
    </div>
  );
}
