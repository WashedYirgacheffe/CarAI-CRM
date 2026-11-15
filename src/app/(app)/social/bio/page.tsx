import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { can, requireUser } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { bioUrl, ensureDepartmentBio, ensureUserBio, qrDataUrl } from "@/server/bio";
import { parseBioLinks } from "@/lib/social";
import { cn } from "@/lib/utils";
import { BioEditor } from "./bio-editor";

export const metadata: Metadata = { title: "我的主页" };

/** 对外聚合主页（Link-in-Bio）：自己的一个；有「部门与成员」权限的还能编辑各分公司 / 部门的 */
export default async function BioPage({ searchParams }: PageProps<"/social/bio">) {
  const user = await requireUser();
  const { dept } = await searchParams;
  const manageDepts = can(user, "settings.org");
  const depts = manageDepts
    ? await tenantDb(user.tenantId).department.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, parentId: true } })
    : [];
  const target = typeof dept === "string" ? depts.find((d) => d.id === dept) : undefined;
  const page = target ? await ensureDepartmentBio(user.tenantId, target) : await ensureUserBio(user);
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true, docCompanyName: true } });
  const url = bioUrl(page.slug);
  const clicks = (page.clicks ?? {}) as Record<string, number>;

  return (
    <>
      <PageHeader
        title={target ? `${target.name} 的主页` : "我的主页"}
        description="把社媒、WhatsApp、微信二维码放在一个页面里：发给客户，或者贴到各平台的简介（Link in Bio）"
      />
      {manageDepts && depts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-muted-foreground">编辑：</span>
          <Tab href="/social/bio" active={!target}>
            我自己
          </Tab>
          {depts.map((d) => (
            <Tab key={d.id} href={`/social/bio?dept=${d.id}`} active={target?.id === d.id}>
              {d.name}
            </Tab>
          ))}
        </div>
      )}
      <BioEditor
        key={page.id}
        page={{
          id: page.id,
          slug: page.slug,
          title: page.title,
          bio: page.bio ?? "",
          avatar: page.avatar,
          theme: page.theme,
          published: page.published,
          links: parseBioLinks(page.links),
        }}
        company={target ? null : (tenant?.docCompanyName ?? tenant?.name ?? null)}
        share={{ url, qr: await qrDataUrl(url, 480), views: page.views, clicks }}
      />
    </>
  );
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md border px-2.5 py-1 transition-colors",
        active ? "border-primary/40 bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
