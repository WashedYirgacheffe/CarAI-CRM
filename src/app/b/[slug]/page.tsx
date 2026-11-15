import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/server/db";
import { publicImageUrl } from "@/server/share";
import { publicLinks } from "@/server/bio";
import { BioView } from "@/components/social/bio-view";
import { bioTheme } from "@/lib/social";

export const dynamic = "force-dynamic";

const load = cache(async (slug: string) => {
  const page = await prisma.bioPage.findUnique({
    where: { slug },
    include: { tenant: { select: { name: true, docCompanyName: true } }, department: { select: { name: true } } },
  });
  return page?.published ? page : null;
});

export async function generateMetadata({ params }: PageProps<"/b/[slug]">): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: { absolute: "Not found" } };
  const image = publicImageUrl(p.avatar);
  return {
    title: { absolute: p.title },
    description: p.bio ?? p.tenant.docCompanyName ?? p.tenant.name,
    openGraph: { title: p.title, description: p.bio ?? undefined, images: image ? [image] : undefined },
  };
}

export async function generateViewport({ params }: PageProps<"/b/[slug]">): Promise<Viewport> {
  const p = await load((await params).slug);
  const t = bioTheme(p?.theme ?? "sky");
  return { themeColor: t.card === "#ffffff" ? "#ffffff" : t.card, width: "device-width", initialScale: 1 };
}

/** 对外的聚合主页（Link-in-Bio）：销售 / 分公司的社媒、WhatsApp、二维码放在一页，发给客户或放在社媒简介里 */
export default async function BioPublicPage({ params }: PageProps<"/b/[slug]">) {
  const { slug } = await params;
  const p = await load(slug);
  if (!p) notFound();
  // 浏览数：不精确去重，够看热度
  await prisma.bioPage.update({ where: { id: p.id }, data: { views: { increment: 1 } } }).catch(() => {});
  const links = await publicLinks(p.slug, p.links, true);
  return (
    <main lang="en" className="flex min-h-dvh">
      <BioView
        title={p.title}
        bio={p.bio}
        avatar={publicImageUrl(p.avatar)}
        theme={p.theme}
        links={links}
        company={p.userId ? (p.tenant.docCompanyName ?? p.tenant.name) : null}
      />
    </main>
  );
}
