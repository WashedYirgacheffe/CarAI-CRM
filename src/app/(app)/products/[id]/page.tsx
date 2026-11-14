import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, ChevronLeft } from "@/components/icons";
import { StatusBadge } from "@/components/crm/bits";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { aiConfigured } from "@/server/ai";
import { productShareUrl } from "@/server/share";
import { productPayload } from "@/server/share-track";
import { productStats } from "@/server/product-stats";
import { Panel } from "@/app/(app)/customers/[id]/detail-ui";
import { clickLabel, durationText, sectionLabel } from "@/lib/share-visit";
import type { ProductRow } from "../product-table";
import { CardPreview, ListingEditor, ProductActions, ProductVisits } from "./product-detail";

export async function generateMetadata({ params }: PageProps<"/products/[id]">): Promise<Metadata> {
  const user = await requirePermission("product.view");
  const p = await tenantDb(user.tenantId).product.findFirst({ where: { id: (await params).id }, select: { name: true } });
  return { title: p?.name ?? "产品" };
}

/** 产品详情：资料、产品卡（客户看到的页面）、AI 优化、客户查看数据 */
export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const user = await requirePermission("product.view");
  const { id } = await params;
  const db = tenantDb(user.tenantId);
  const [p, categories, stats] = await Promise.all([
    db.product.findFirst({ where: { id }, include: { category: { select: { name: true } } } }),
    db.productCategory.findMany({ orderBy: { sort: "asc" }, select: { id: true, name: true } }),
    productStats(user.tenantId, id),
  ]);
  if (!p) notFound();
  const manage = can(user, "product.manage");
  const tz = user.timezone;

  const row: ProductRow = {
    id: p.id,
    sku: p.sku,
    name: p.name,
    nameEn: p.nameEn,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    model: p.model,
    spec: p.spec,
    unit: p.unit,
    price: p.price.toString(),
    currency: p.currency,
    costPrice: manage ? (p.costPrice?.toString() ?? null) : null,
    moq: p.moq,
    hsCode: p.hsCode,
    cartonQty: p.cartonQty,
    cartonSize: p.cartonSize,
    grossWeight: p.grossWeight?.toString() ?? null,
    netWeight: p.netWeight?.toString() ?? null,
    imageUrl: p.imageUrl,
    images: p.images,
    videoUrl: p.videoUrl,
    status: p.status,
    remark: p.remark,
  };

  const facts: [string, string | null][] = [
    ["英文品名", p.nameEn],
    ["分类", p.category?.name ?? null],
    ["型号", p.model],
    ["单价", Number(p.price) > 0 ? `${p.currency} ${Number(p.price)} / ${p.unit}` : null],
    ["成本价", manage && p.costPrice ? `¥${Number(p.costPrice)}` : null],
    ["MOQ", p.moq ? `${p.moq} ${p.unit}` : null],
    ["HS 编码", p.hsCode],
    ["包装", p.cartonQty ? `${p.cartonQty} ${p.unit}/箱${p.cartonSize ? ` · ${p.cartonSize}` : ""}` : null],
    [
      "毛重 / 净重",
      p.grossWeight || p.netWeight ? `${p.grossWeight ? Number(p.grossWeight) : "—"} / ${p.netWeight ? Number(p.netWeight) : "—"} kg` : null,
    ],
    ["规格", p.spec],
    ["备注", p.remark],
  ];
  const sectionMax = Math.max(...stats.sections.map((s) => s.ms), 1);
  const reachBase = stats.visits || 1;

  return (
    <>
      <Link href="/products" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        产品
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-normal tracking-tight">{p.name}</h1>
            {p.status === "ACTIVE" ? <StatusBadge name="在售" color="emerald" /> : <StatusBadge name="停售" color="slate" />}
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="tabular-nums">{p.sku}</span>
            {p.nameEn && ` · ${p.nameEn}`}
          </p>
        </div>
        {manage && <ProductActions product={row} categories={categories} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-5">
        <div className="min-w-0 space-y-4 lg:space-y-5">
          <ListingEditor
            id={p.id}
            canEdit={manage}
            canAi={manage && can(user, "ai.use") && aiConfigured()}
            fallbackTitle={p.nameEn || p.name}
            initial={{ listingTitle: p.listingTitle ?? "", bullets: p.bullets, listingDesc: p.listingDesc ?? "", keywords: p.keywords ?? "" }}
          />

          <Panel title="客户查看数据" icon={<BarChart3 className="size-4 text-muted-foreground" />}>
            {stats.visits === 0 ? (
              <p className="text-[13px] text-pretty text-muted-foreground">
                还没有客户打开过这个产品卡。在 WhatsApp
                里发产品时会自动带上链接，也可以复制右边的链接发给客户；客户打开、看了哪些部分、停留多久都会记在这里。
              </p>
            ) : (
              <div className="space-y-5">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  <Stat label="打开次数" value={stats.visits} hint={`近 30 天 ${stats.visits30} 次`} />
                  <Stat label="访客" value={stats.visitors} hint={`${stats.customers} 个客户`} />
                  <Stat label="平均停留" value={stats.avgMs ? durationText(stats.avgMs) : "—"} />
                  <Stat
                    label="点了联系"
                    value={stats.clicks.filter((c) => ["whatsapp", "email", "inquiry"].includes(c.name)).reduce((n, c) => n + c.count, 0)}
                    hint="WhatsApp / 询价 / 邮件"
                  />
                </dl>

                {stats.sections.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-[12px] font-medium text-muted-foreground">客户在哪部分停留</h3>
                    <table className="w-full text-[13px] tabular-nums">
                      <caption className="sr-only">各部分累计停留时长和看到的比例</caption>
                      <thead className="sr-only">
                        <tr>
                          <th>部分</th>
                          <th>累计停留</th>
                          <th>时长</th>
                          <th>看到的访问占比</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.sections.map((s) => (
                          <tr key={s.name}>
                            <th scope="row" className="w-24 py-1 text-left font-normal">
                              {sectionLabel(s.name)}
                            </th>
                            <td className="py-1 pr-3">
                              <span className="block h-2 rounded-full bg-chart-1" style={{ width: `${Math.max(3, (s.ms / sectionMax) * 100)}%` }} />
                            </td>
                            <td className="w-20 py-1 text-right">{durationText(s.ms)}</td>
                            <td className="w-24 py-1 text-right text-muted-foreground">{Math.round((s.reach / reachBase) * 100)}% 看到</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {stats.clicks.length > 0 && (
                  <p className="text-[13px] text-muted-foreground">
                    {stats.clicks.map((c) => `${clickLabel(c.name).replace(/^点了 ?/, "")} ${c.count} 次`).join(" · ")}
                  </p>
                )}

                <div>
                  <h3 className="mb-2 text-[12px] font-medium text-muted-foreground">最近的访问</h3>
                  <ProductVisits visits={stats.recent} tz={tz} />
                </div>
              </div>
            )}
          </Panel>

          <Panel title="产品资料">
            <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
              {facts
                .filter((f): f is [string, string] => !!f[1])
                .map(([k, v]) => (
                  <div key={k} className={k === "规格" || k === "备注" ? "flex gap-3 sm:col-span-2" : "flex gap-3"}>
                    <dt className="w-20 shrink-0 text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 flex-1 break-words whitespace-pre-line">{v}</dd>
                  </div>
                ))}
            </dl>
          </Panel>
        </div>

        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <CardPreview
            url={productShareUrl(productPayload(p.id))}
            priceUrl={productShareUrl(productPayload(p.id, { price: true }))}
            version={p.listingUpdatedAt?.getTime() ?? p.updatedAt.getTime()}
          />
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xl leading-tight font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}
