import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { getSeller } from "@/server/documents";
import { formShareUrl, publicImageUrl, readShareToken } from "@/server/share";
import { parseProductPayload } from "@/server/share-track";
import { ViewTracker } from "../../view-tracker";
import { ProductGallery } from "./product-gallery";

export const dynamic = "force-dynamic";

async function load(token: string) {
  const payload = readShareToken("p", token);
  if (!payload) return null;
  const to = parseProductPayload(payload);
  const p = await prisma.product.findUnique({ where: { id: to.productId } });
  if (!p) return null;
  const chat = to.chatId
    ? await prisma.waChat.findFirst({ where: { id: to.chatId, tenantId: p.tenantId }, select: { id: true, account: { select: { phone: true } } } })
    : null;
  return { p, chat, showPrice: to.price };
}

export async function generateMetadata({ params }: PageProps<"/s/p/[token]">): Promise<Metadata> {
  const r = await load((await params).token);
  const title = r ? r.p.listingTitle || r.p.nameEn || r.p.name : "Product";
  const image = r ? publicImageUrl(r.p.imageUrl) : null;
  return {
    title: { absolute: title },
    description: r?.p.bullets[0] ?? r?.p.spec ?? undefined,
    robots: { index: false },
    openGraph: image ? { title, images: [image] } : { title },
  };
}

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);

/** 发给客户的产品卡：像独立站的产品页，打开、停留、点了什么都记到客户的跟进里 */
export default async function ProductCardPage({ params }: PageProps<"/s/p/[token]">) {
  const { token } = await params;
  const r = await load(token);
  if (!r) notFound();
  const { p, chat, showPrice } = r;
  const seller = await getSeller(p.tenantId);

  const title = p.listingTitle || p.nameEn || p.name;
  const images = [p.imageUrl, ...p.images].filter((x, i, a): x is string => !!x && a.indexOf(x) === i).map((u) => publicImageUrl(u)!);
  const video = publicImageUrl(p.videoUrl);
  const price = Number(p.price);
  const wa = chat?.account.phone ?? null;
  const waText = encodeURIComponent(`Hi, I'm interested in ${title}${p.sku ? ` (${p.sku})` : ""}.`);
  const inquiry = chat ? formShareUrl("inquiry", chat.id) : null;
  const mail = seller.email ? `mailto:${seller.email}?subject=${encodeURIComponent(`Inquiry: ${title}`)}` : null;

  const specs = [
    ["Model", p.model],
    ["Item No.", p.sku],
    ["Specification", p.spec],
    ["MOQ", p.moq ? `${p.moq.toLocaleString("en-US")} ${p.unit}` : null],
    ["HS Code", p.hsCode],
  ].filter((x): x is [string, string] => !!x[1]);
  const packing = [
    ["Qty / carton", p.cartonQty ? `${p.cartonQty} ${p.unit}` : null],
    ["Carton size", p.cartonSize],
    ["Gross weight", p.grossWeight ? `${Number(p.grossWeight)} kg` : null],
    ["Net weight", p.netWeight ? `${Number(p.netWeight)} kg` : null],
  ].filter((x): x is [string, string] => !!x[1]);
  const desc = p.listingDesc?.trim();

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <ViewTracker kind="p" token={token} />
      <p className="mb-4 text-[13px] font-medium tracking-wide text-muted-foreground">{seller.name}</p>

      <div className="grid gap-6 rounded-2xl bg-card p-4 shadow-card sm:p-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:gap-10 md:p-8">
        <section data-track-section="gallery" aria-label="Product images">
          <ProductGallery images={images} alt={title} />
        </section>

        <section data-track-section="overview" className="flex flex-col">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-[1.75rem]">{title}</h1>
          {(p.model || p.sku) && (
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {[p.model && `Model ${p.model}`, p.sku && `Item No. ${p.sku}`].filter(Boolean).join(" · ")}
            </p>
          )}

          {(showPrice && price > 0) || p.moq ? (
            <div className="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-y py-4">
              {showPrice && price > 0 && (
                <p>
                  <span className="text-2xl font-semibold tabular-nums">{money(price, p.currency)}</span>
                  <span className="ml-1 text-sm text-muted-foreground">/ {p.unit}</span>
                </p>
              )}
              {p.moq && (
                <p className="text-sm text-muted-foreground">
                  MOQ <span className="font-medium text-foreground tabular-nums">{p.moq.toLocaleString("en-US")}</span> {p.unit}
                </p>
              )}
            </div>
          ) : null}

          {p.bullets.length > 0 ? (
            <ul className="mt-5 space-y-2.5 text-[15px] leading-relaxed">
              {p.bullets.map((b, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span className="text-pretty">{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            p.spec && <p className="mt-5 text-[15px] leading-relaxed text-pretty whitespace-pre-line">{p.spec}</p>
          )}

          <div data-track-section="contact" className="mt-auto flex flex-col gap-2 pt-7 sm:flex-row sm:flex-wrap">
            {wa && (
              <a
                data-track-click="whatsapp"
                href={`https://wa.me/${wa}?text=${waText}`}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#25d366] px-6 text-[15px] font-medium text-white hover:bg-[#1fb95a]"
              >
                Chat on WhatsApp
              </a>
            )}
            {inquiry && (
              <a
                data-track-click="inquiry"
                href={inquiry}
                className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-[15px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                Request a quote
              </a>
            )}
            {mail && (
              <a
                data-track-click="email"
                href={mail}
                className="inline-flex h-11 items-center justify-center rounded-full border px-6 text-[15px] font-medium hover:bg-muted"
              >
                Email us
              </a>
            )}
          </div>
        </section>
      </div>

      {desc && (
        <section data-track-section="description" className="mt-6 rounded-2xl bg-card p-6 shadow-card md:p-8">
          <h2 className="text-lg font-semibold">Product details</h2>
          <div className="mt-3 max-w-[70ch] space-y-3 text-[15px] leading-relaxed text-pretty text-foreground/90">
            {desc.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="whitespace-pre-line">
                {para}
              </p>
            ))}
          </div>
        </section>
      )}

      {(specs.length > 0 || packing.length > 0) && (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {specs.length > 0 && <SpecTable id="specs" title="Specifications" rows={specs} />}
          {packing.length > 0 && <SpecTable id="packaging" title="Packaging" rows={packing} />}
        </div>
      )}

      {video && (
        <section data-track-section="video" className="mt-6 rounded-2xl bg-card p-4 shadow-card sm:p-6">
          <h2 className="mb-3 text-lg font-semibold">Video</h2>
          <video data-track-click="video" src={video} controls playsInline preload="metadata" className="aspect-video w-full rounded-xl bg-black" />
        </section>
      )}

      <footer className="mt-10 text-center text-[13px] text-muted-foreground">
        <p className="font-medium text-foreground">{seller.name}</p>
        {[seller.address, seller.phone, seller.email, seller.website].filter(Boolean).map((x) => (
          <p key={x}>{x}</p>
        ))}
      </footer>
    </main>
  );
}

function SpecTable({ id, title, rows }: { id: string; title: string; rows: [string, string][] }) {
  return (
    <section data-track-section={id} className="rounded-2xl bg-card p-6 shadow-card">
      <h2 className="text-lg font-semibold">{title}</h2>
      <dl className="mt-3 divide-y text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 py-2.5">
            <dt className="w-32 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 flex-1 break-words whitespace-pre-line">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
