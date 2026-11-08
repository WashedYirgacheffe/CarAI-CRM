import { amountInWords, formatAmount, formatDocDate, formatPrice, formatQty } from "@/lib/docs";

export type PrintSeller = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  bankInfo: string | null;
};

export type PrintDocData = {
  kind: "quotation" | "order";
  no: string;
  title?: string | null;
  date: Date;
  date2: Date | null;
  buyerName: string;
  buyerContact: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  buyerAddress: string | null;
  currency: string;
  tradeTerm: string | null;
  port: string | null;
  paymentTerm: string | null;
  deliveryTime?: string | null;
  shippingMark?: string | null;
  subtotal: string;
  discount: string;
  shippingFee: string;
  otherFee: string;
  total: string;
  terms: string | null;
  salesName: string | null;
  items: {
    id: string;
    sku: string | null;
    name: string;
    spec: string | null;
    imageUrl: string | null;
    unit: string;
    quantity: string;
    unitPrice: string;
    amount: string;
  }[];
};

/** 英文单据（Quotation / Proforma Invoice），A4 版式 */
export function PrintDoc({ seller, doc, tz }: { seller: PrintSeller; doc: PrintDocData; tz: string }) {
  const isPI = doc.kind === "order";
  const c = doc.currency;
  const hasImages = doc.items.some((i) => i.imageUrl);
  const extra: [string, string][] = (
    [
      ["Discount", doc.discount],
      ["Freight", doc.shippingFee],
      ["Other Charges", doc.otherFee],
    ] as [string, string][]
  ).filter(([, v]) => Number(v));
  const meta: [string, string | null | undefined][] = [
    [isPI ? "PI No." : "Quotation No.", doc.no],
    ["Date", formatDocDate(doc.date, tz)],
    isPI ? ["Delivery Date", formatDocDate(doc.date2, tz)] : ["Valid Until", formatDocDate(doc.date2, tz)],
    ["Sales", doc.salesName],
  ];
  const terms: [string, string | null | undefined][] = [
    ["Trade Terms", [doc.tradeTerm, doc.port].filter(Boolean).join(" ")],
    ["Payment Terms", doc.paymentTerm],
    ["Delivery", doc.deliveryTime],
    ["Currency", c],
  ];

  return (
    <article className="mx-auto max-w-[210mm] bg-white p-[12mm] text-[11px] leading-relaxed text-neutral-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
      {/* 抬头 */}
      <header className="flex items-start justify-between gap-6 border-b-2 border-neutral-900 pb-4">
        <div className="min-w-0">
          <p className="text-lg font-bold tracking-tight">{seller.name}</p>
          {seller.address && <p className="whitespace-pre-line text-neutral-600">{seller.address}</p>}
          <p className="text-neutral-600">
            {[seller.phone && `Tel: ${seller.phone}`, seller.email && `Email: ${seller.email}`, seller.website]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xl font-bold tracking-wide">{isPI ? "PROFORMA INVOICE" : "QUOTATION"}</p>
          <table className="mt-1 ml-auto">
            <tbody>
              {meta
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <tr key={k}>
                    <td className="pr-3 text-neutral-500">{k}</td>
                    <td className="text-right font-medium tabular-nums">{v}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </header>

      {/* 买方 + 条款 */}
      <section className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <p className="mb-1 text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">{isPI ? "Buyer" : "To"}</p>
          <p className="font-semibold">{doc.buyerName}</p>
          {doc.buyerAddress && <p className="whitespace-pre-line">{doc.buyerAddress}</p>}
          {doc.buyerContact && <p>Attn: {doc.buyerContact}</p>}
          {(doc.buyerEmail || doc.buyerPhone) && (
            <p className="text-neutral-600">{[doc.buyerEmail, doc.buyerPhone].filter(Boolean).join("  ·  ")}</p>
          )}
        </div>
        <table className="self-start">
          <tbody>
            {terms
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <tr key={k} className="align-top">
                  <td className="pr-3 whitespace-nowrap text-neutral-500">{k}</td>
                  <td className="font-medium">{v}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
      {doc.title && <p className="mt-3 font-semibold">Re: {doc.title}</p>}

      {/* 明细 */}
      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="bg-neutral-100 text-left text-[10px] tracking-wide text-neutral-600 uppercase">
            <th className="border border-neutral-300 px-1.5 py-1 font-semibold">No.</th>
            {hasImages && <th className="border border-neutral-300 px-1.5 py-1 font-semibold">Picture</th>}
            <th className="border border-neutral-300 px-1.5 py-1 font-semibold">Item No.</th>
            <th className="border border-neutral-300 px-1.5 py-1 font-semibold">Description</th>
            <th className="border border-neutral-300 px-1.5 py-1 text-right font-semibold">Qty</th>
            <th className="border border-neutral-300 px-1.5 py-1 text-right font-semibold">Unit Price ({c})</th>
            <th className="border border-neutral-300 px-1.5 py-1 text-right font-semibold">Amount ({c})</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((it, i) => (
            <tr key={it.id} className="break-inside-avoid align-top">
              <td className="border border-neutral-300 px-1.5 py-1 tabular-nums">{i + 1}</td>
              {hasImages && (
                <td className="w-[18mm] border border-neutral-300 p-1">
                  {it.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- 打印页直接用原图
                    <img src={it.imageUrl} alt="" className="size-[16mm] object-contain" />
                  )}
                </td>
              )}
              <td className="border border-neutral-300 px-1.5 py-1 whitespace-nowrap tabular-nums">{it.sku}</td>
              <td className="border border-neutral-300 px-1.5 py-1">
                <p className="font-medium">{it.name}</p>
                {it.spec && <p className="whitespace-pre-line text-neutral-600">{it.spec}</p>}
              </td>
              <td className="border border-neutral-300 px-1.5 py-1 text-right whitespace-nowrap tabular-nums">
                {formatQty(it.quantity)} {it.unit}
              </td>
              <td className="border border-neutral-300 px-1.5 py-1 text-right tabular-nums">{formatPrice(it.unitPrice)}</td>
              <td className="border border-neutral-300 px-1.5 py-1 text-right tabular-nums">{formatAmount(it.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {extra.length > 0 && (
            <tr>
              <td colSpan={hasImages ? 6 : 5} className="border border-neutral-300 px-1.5 py-1 text-right">
                Subtotal
              </td>
              <td className="border border-neutral-300 px-1.5 py-1 text-right tabular-nums">{formatAmount(doc.subtotal)}</td>
            </tr>
          )}
          {extra.map(([k, v]) => (
            <tr key={k}>
              <td colSpan={hasImages ? 6 : 5} className="border border-neutral-300 px-1.5 py-1 text-right">
                {k}
              </td>
              <td className="border border-neutral-300 px-1.5 py-1 text-right tabular-nums">
                {k === "Discount" ? "-" : ""}
                {formatAmount(v)}
              </td>
            </tr>
          ))}
          <tr className="font-bold">
            <td colSpan={hasImages ? 6 : 5} className="border border-neutral-300 px-1.5 py-1.5 text-right">
              Total {doc.tradeTerm ? `${doc.tradeTerm} ${doc.port ?? ""}`.trim() : ""}
            </td>
            <td className="border border-neutral-300 px-1.5 py-1.5 text-right whitespace-nowrap tabular-nums">{formatAmount(doc.total, c)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-1.5 font-medium">{amountInWords(doc.total, c)}</p>

      {/* 条款、唛头、银行信息 */}
      <section className="mt-5 grid gap-4">
        {doc.terms && (
          <div className="break-inside-avoid">
            <p className="mb-1 text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">Terms &amp; Conditions</p>
            <p className="whitespace-pre-line">{doc.terms}</p>
          </div>
        )}
        {doc.shippingMark && (
          <div className="break-inside-avoid">
            <p className="mb-1 text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">Shipping Mark</p>
            <p className="whitespace-pre-line">{doc.shippingMark}</p>
          </div>
        )}
        {seller.bankInfo && (
          <div className="break-inside-avoid rounded border border-neutral-300 p-2.5">
            <p className="mb-1 text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">Bank Information</p>
            <p className="whitespace-pre-line">{seller.bankInfo}</p>
          </div>
        )}
      </section>

      {/* 签字 */}
      <section className="mt-10 grid break-inside-avoid grid-cols-2 gap-12">
        {(isPI ? ["Seller", "Buyer"] : ["Prepared by"]).map((who) => (
          <div key={who}>
            <div className="h-10 border-b border-neutral-400" />
            <p className="mt-1 text-neutral-500">
              {who}: {who === "Buyer" ? doc.buyerName : seller.name}
            </p>
          </div>
        ))}
      </section>
    </article>
  );
}
