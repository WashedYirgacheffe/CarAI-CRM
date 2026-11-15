import "server-only";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { prisma } from "@/server/db";
import { appUrl, publicImageUrl } from "@/server/share";
import { normalizeSocialUrl, parseBioLinks, SLUG_RE, type BioLink } from "@/lib/social";
import type { BioViewLink } from "@/components/social/bio-view";

/** 公开地址里不能用的路径名 */
const RESERVED = new Set(["admin", "api", "app", "login", "register", "settings", "social", "www", "help", "support", "go"]);

export const bioUrl = (slug: string) => `${appUrl()}/b/${slug}`;

export function qrDataUrl(text: string, width = 320) {
  return QRCode.toDataURL(text, { margin: 1, width, errorCorrectionLevel: "M" });
}

export function checkSlug(slug: string): string | null {
  if (!SLUG_RE.test(slug)) return "地址只能用小写字母、数字和中划线，3～40 位，不能以中划线开头或结尾";
  if (RESERVED.has(slug)) return "这个地址被系统占用了，换一个";
  return null;
}

/** 新主页的默认地址：邮箱前缀 + 3 位随机，保证不重复 */
async function freeSlug(base: string) {
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "sales";
  for (let i = 0; i < 6; i++) {
    const slug = i === 0 && clean.length >= 3 && !RESERVED.has(clean) ? clean : `${clean}-${randomBytes(2).toString("hex")}`;
    if (!(await prisma.bioPage.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `p-${randomBytes(5).toString("hex")}`;
}

/** 销售自己的主页；第一次打开时按个人资料建一个（带上邮箱和 WhatsApp） */
export async function ensureUserBio(user: { id: string; tenantId: string; name: string; email: string }) {
  const existing = await prisma.bioPage.findUnique({ where: { userId: user.id } });
  if (existing) return existing;
  const [me, wa, tenant] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { phone: true } }),
    prisma.waAccount.findFirst({ where: { userId: user.id, tenantId: user.tenantId }, select: { phone: true } }),
    prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true, docCompanyName: true, docWebsite: true } }),
  ]);
  const links: BioLink[] = [];
  const id = () => randomBytes(4).toString("hex");
  const waPhone = (wa?.phone ?? me?.phone ?? "").replace(/[^\d]/g, "");
  if (waPhone.length >= 8) links.push({ id: id(), kind: "link", platform: "whatsapp", label: "WhatsApp", url: `https://wa.me/${waPhone}` });
  links.push({ id: id(), kind: "link", platform: "email", label: "Email", url: `mailto:${user.email}` });
  const site = tenant?.docWebsite ? normalizeSocialUrl(tenant.docWebsite) : null;
  if (site) links.push({ id: id(), kind: "link", platform: "website", label: "Website", url: site });
  return prisma.bioPage.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      slug: await freeSlug(user.email.split("@")[0]),
      title: user.name,
      bio: tenant?.docCompanyName ?? tenant?.name ?? null,
      links,
    },
  });
}

/** 分公司 / 部门的主页 */
export async function ensureDepartmentBio(tenantId: string, dept: { id: string; name: string }) {
  const existing = await prisma.bioPage.findFirst({ where: { tenantId, departmentId: dept.id } });
  if (existing) return existing;
  return prisma.bioPage.create({
    data: { tenantId, departmentId: dept.id, slug: await freeSlug(`team-${dept.id.slice(-5)}`), title: dept.name, links: [] },
  });
}

/** 公开页要用的链接：图片换成签名地址、二维码卡片没传图就按链接生成 */
export async function publicLinks(slug: string, raw: unknown, track: boolean): Promise<BioViewLink[]> {
  const links = parseBioLinks(raw);
  return Promise.all(
    links.map(async (l) => ({
      ...l,
      image: publicImageUrl(l.image),
      href: track ? `/b/${slug}/go/${l.id}` : l.url,
      qr: l.kind === "qr" && !l.image && l.url ? await qrDataUrl(l.url, 280) : null,
    })),
  );
}
