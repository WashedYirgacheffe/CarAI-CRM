import type { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { parseBioLinks } from "@/lib/social";

/** 聚合主页上的链接：记一次点击再跳过去（只跳主页里登记过的链接） */
export async function GET(_req: NextRequest, ctx: RouteContext<"/b/[slug]/go/[linkId]">) {
  const { slug, linkId } = await ctx.params;
  const page = await prisma.bioPage.findUnique({ where: { slug }, select: { id: true, published: true, links: true } });
  const link = page?.published ? parseBioLinks(page.links).find((l) => l.id === linkId) : null;
  if (!page || !link || !/^(https?:|mailto:|tel:)/i.test(link.url)) return new Response("Not found", { status: 404 });
  await prisma.$executeRaw`
    UPDATE "BioPage"
    SET "clicks" = jsonb_set("clicks", ARRAY[${linkId}]::text[], to_jsonb(COALESCE(("clicks"->>${linkId})::int, 0) + 1))
    WHERE "id" = ${page.id}`.catch(() => {});
  return new Response(null, { status: 302, headers: { location: link.url, "cache-control": "no-store" } });
}
