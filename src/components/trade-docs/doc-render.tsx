// AI 单据工作台：各类单据的 A4 版式（照「外贸样板」里的真实单据排）。
// 只读数据、不含状态，预览和打印页共用。缺的必填项在屏幕上显示成黄色占位，打印时变成空白。

import { amountInWords, formatAmount, formatPrice, formatQty } from "@/lib/docs";
import {
  type DocData,
  type DocItem,
  type DocType,
  TEMPLATES,
  fmtDate,
  goodsDescription,
  hasNum,
  lineAmount,
  packagesInWords,
  parseNum,
  totals,
} from "@/lib/trade-docs/schema";
import { cn } from "@/lib/utils";

const FONT = { fontFamily: 'Arial, "Helvetica Neue", Helvetica, "PingFang SC", "Microsoft YaHei", sans-serif' };

function Blank({ label }: { label: string }) {
  return (
    <span className="rounded-[2px] bg-amber-100 px-1 text-[0.92em] font-normal text-amber-700 normal-case print:bg-transparent print:text-transparent">
      [{label}]
    </span>
  );
}

/** 有值显示值，没值显示占位 */
function V({ v, l, className }: { v?: string | number | null; l: string; className?: string }) {
  const s = v == null ? "" : String(v).trim();
  if (!s) return <Blank label={l} />;
  return <span className={cn("whitespace-pre-line", className)}>{s}</span>;
}

function Sheet({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <article
      style={FONT}
      className={cn(
        "trade-doc mx-auto box-border w-[210mm] min-h-[297mm] bg-white p-[12mm] text-[10.5px] leading-[1.45] text-neutral-900 shadow-sm",
        "print:min-h-0 print:w-auto print:p-0 print:shadow-none",
        className,
      )}
    >
      {children}
    </article>
  );
}

function Letterhead({ d, cn: showCn = true, contact = false }: { d: DocData; cn?: boolean; contact?: boolean }) {
  const line = [d.sellerTel && `TEL: ${d.sellerTel}`, d.sellerEmail && `EMAIL: ${d.sellerEmail}`, d.sellerWebsite].filter(Boolean).join("   ");
  return (
    <header className="text-center">
      <p className="text-[17px] font-bold tracking-wide uppercase">
        <V v={d.sellerName} l="卖方名称" />
      </p>
      {d.sellerAddress && <p className="mx-auto max-w-[160mm] whitespace-pre-line uppercase">{d.sellerAddress}</p>}
      {showCn && d.sellerNameCn && <p className="font-medium">{d.sellerNameCn}</p>}
      {contact && line && <p className="text-neutral-700">{line}</p>}
    </header>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h1 className="mt-3 mb-3 text-center text-[16px] font-bold tracking-[0.12em] underline underline-offset-4">{children}</h1>;
}

function SignBlock({ d, label, right = true }: { d: DocData; label?: string; right?: boolean }) {
  return (
    <div className={cn("mt-8 w-[70mm] break-inside-avoid text-center", right && "ml-auto")}>
      {label && <p className="mb-1 text-left text-neutral-600">{label}</p>}
      <p className="font-bold uppercase">
        <V v={d.sellerName} l="卖方名称" />
      </p>
      <div className="mt-10 border-b border-neutral-800" />
      <p className="mt-1 text-neutral-600">{d.signer ? `${d.signer} · Authorized Signature` : "Authorized Signature"}</p>
    </div>
  );
}

/** L/C 项下单据底部的固定几行：原产地、统一声明、申请人、开证行 */
function LcFooter({ d, origin = true }: { d: DocData; origin?: boolean }) {
  return (
    <div className="mt-4 space-y-1.5 uppercase break-inside-avoid">
      {origin && d.origin && <p>COUNTRY OF ORIGIN : {d.origin}</p>}
      {d.docRemark && <p className="whitespace-pre-line">{d.docRemark}</p>}
      {d.lcNo && d.buyerName && (
        <p className="whitespace-pre-line">
          APPLICANT: {d.buyerName}
          {d.buyerAddress ? `, ${d.buyerAddress}` : ""}
        </p>
      )}
      {d.issuingBank && <p className="whitespace-pre-line">ISSUING BANK: {d.issuingBank}</p>}
    </div>
  );
}

const th = "border border-neutral-700 px-1.5 py-1 font-bold";
const td = "border border-neutral-700 px-1.5 py-1 align-top";
const num = "text-right tabular-nums whitespace-nowrap";

const cur = (d: DocData) => d.currency || "USD";
const termText = (d: DocData) => [d.tradeTerm, d.tradePlace].filter(Boolean).join(" ").toUpperCase();
const itemText = (it: DocItem) => [it.name, it.desc].filter((s) => s?.trim()).join("\n");
const unitOf = (it: DocItem) => (it.unit || "PCS").toUpperCase();
const nz = (n: number, f: (n: number) => string) => (n ? f(n) : "");
const kg = (n: number) => `${formatQty(Number(n.toFixed(3)))}`;

// ── PI ──

function ProformaInvoice({ d }: { d: DocData }) {
  const t = totals(d);
  const hasImg = d.items.some((i) => i.imageUrl);
  const hasPacking = d.items.some((i) => i.packing);
  const cols = 6 + (hasImg ? 1 : 0) + (hasPacking ? 1 : 0);
  const meta: [string, React.ReactNode][] = [
    ["PI No.:", <V key="no" v={d.no} l="PI 号" />],
    ...(d.jobNo ? ([["Job No.:", d.jobNo]] as [string, React.ReactNode][]) : []),
    ["Date:", <V key="date" v={fmtDate(d.date, "en")} l="日期" />],
    ...(d.loadingPort ? ([["Loading Port:", d.loadingPort]] as [string, React.ReactNode][]) : []),
    ...(d.containerType || d.shipMode ? ([["Type:", d.containerType || d.shipMode]] as [string, React.ReactNode][]) : []),
    ...(d.validity ? ([["Validity:", d.validity]] as [string, React.ReactNode][]) : []),
  ];
  const rows = d.items.length ? d.items : [{} as DocItem];
  return (
    <Sheet>
      <Letterhead d={d} cn={false} contact />
      <Title>PROFORMA INVOICE</Title>
      <section className="grid grid-cols-[1.35fr_1fr] gap-6">
        <table className="self-start">
          <tbody className="[&_td]:py-0.5 [&_td]:align-top">
            <tr>
              <td className="w-[22mm] pr-2 font-bold">TO:</td>
              <td className="font-bold uppercase">
                <V v={d.buyerName} l="买方名称" />
              </td>
            </tr>
            {d.buyerAddress && (
              <tr>
                <td className="pr-2 font-bold">Address:</td>
                <td className="whitespace-pre-line">{d.buyerAddress}</td>
              </tr>
            )}
            {d.buyerContact && (
              <tr>
                <td className="pr-2 font-bold">Attn:</td>
                <td>{d.buyerContact}</td>
              </tr>
            )}
            {d.buyerTel && (
              <tr>
                <td className="pr-2 font-bold">Tel:</td>
                <td>{d.buyerTel}</td>
              </tr>
            )}
            {d.buyerEmail && (
              <tr>
                <td className="pr-2 font-bold">Email:</td>
                <td>{d.buyerEmail}</td>
              </tr>
            )}
          </tbody>
        </table>
        <table className="self-start">
          <tbody className="[&_td]:py-0.5">
            {meta.map(([k, v]) => (
              <tr key={k}>
                <td className="w-[26mm] pr-2 font-bold whitespace-nowrap">{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <table className="mt-4 w-full border-collapse">
        <thead className="bg-neutral-100 text-center text-[9.5px] uppercase">
          <tr>
            <th className={th}>No.</th>
            {hasImg && <th className={th}>Picture</th>}
            {hasPacking && <th className={th}>Packing</th>}
            <th className={th}>Item No.</th>
            <th className={th}>Description</th>
            <th className={th}>Units</th>
            <th className={th}>Qty</th>
            <th className={th}>Unit Price ({cur(d)})</th>
            <th className={th}>Amount ({cur(d)})</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it, i) => (
            <tr key={i} className="break-inside-avoid">
              <td className={cn(td, "text-center")}>{i + 1}</td>
              {hasImg && (
                <td className={cn(td, "w-[20mm] p-1")}>
                  {it.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- 单据直接用原图
                    <img src={it.imageUrl} alt="" className="mx-auto size-[17mm] object-contain" />
                  )}
                </td>
              )}
              {hasPacking && <td className={cn(td, "whitespace-pre-line")}>{it.packing}</td>}
              <td className={cn(td, "whitespace-nowrap")}>{it.itemNo}</td>
              <td className={td}>
                {it.name ? <p className="font-bold">{it.name}</p> : <Blank label="品名" />}
                {it.desc && <p className="whitespace-pre-line">{it.desc}</p>}
              </td>
              <td className={cn(td, "text-center uppercase")}>{it.unit || "PCS"}</td>
              <td className={cn(td, num)}>{hasNum(it.qty) ? formatQty(parseNum(it.qty)) : <Blank label="数量" />}</td>
              <td className={cn(td, num)}>{hasNum(it.unitPrice) ? formatPrice(parseNum(it.unitPrice)) : <Blank label="单价" />}</td>
              <td className={cn(td, num)}>{formatAmount(lineAmount(it))}</td>
            </tr>
          ))}
          {d.charges.map((c, i) => (
            <tr key={`c${i}`}>
              <td className={cn(td, "text-right uppercase")} colSpan={cols}>
                {c.label}
              </td>
              <td className={cn(td, num)}>{formatAmount(parseNum(c.amount))}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className={cn(td, "text-right uppercase")} colSpan={cols - 2}>
              Total {termText(d)}
            </td>
            <td className={cn(td, num)}>{nz(t.qty, formatQty)}</td>
            <td className={td} />
            <td className={cn(td, num)}>{formatAmount(t.total, cur(d))}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1.5 font-bold uppercase">{t.total ? amountInWords(t.total, cur(d)) : ""}</p>

      <section className="mt-4 space-y-1 break-inside-avoid">
        {termText(d) && (
          <p>
            <b>Trade Term:</b> {termText(d)}
          </p>
        )}
        <p>
          <b>Payment Term:</b> <V v={d.paymentTerm} l="付款方式" />
        </p>
        {d.deliveryTime && (
          <p>
            <b>Delivery Time:</b> {d.deliveryTime}
          </p>
        )}
        {d.terms && (
          <div className="pt-1">
            <p className="font-bold">Terms &amp; Conditions:</p>
            <p className="whitespace-pre-line">{d.terms}</p>
          </div>
        )}
        {d.remark && (
          <p className="whitespace-pre-line">
            <b>Remark:</b> {d.remark}
          </p>
        )}
      </section>

      {d.bankInfo && (
        <section className="mt-4 border border-neutral-700 p-2.5 break-inside-avoid">
          <p className="mb-1 font-bold">BANK INFORMATION</p>
          <p className="whitespace-pre-line uppercase">{d.bankInfo}</p>
        </section>
      )}

      <section className="mt-10 grid grid-cols-2 gap-14 break-inside-avoid">
        {[
          ["SELLER", d.sellerName, d.signer],
          ["BUYER", d.buyerName, d.buyerContact],
        ].map(([who, name, person]) => (
          <div key={who}>
            <p className="font-bold">{who}:</p>
            <p className="uppercase">{name}</p>
            <div className="mt-10 border-b border-neutral-800" />
            <p className="mt-1 text-neutral-600">{person ? `${person} · ` : ""}Signature &amp; Stamp</p>
          </div>
        ))}
      </section>
    </Sheet>
  );
}

// ── 销售合同 ──

function SalesContract({ d }: { d: DocData }) {
  const t = totals(d);
  const rows = d.items.length ? d.items : [{} as DocItem];
  const clauses: [string, React.ReactNode][] = [
    ["Packing", d.packingNote || "EXPORT STANDARD PACKING."],
    ["Shipping Marks", d.marks || "N/M"],
    ["Time of Shipment", [d.deliveryTime, d.latestShipDate && `LATEST DATE OF SHIPMENT: ${fmtDate(d.latestShipDate)}`].filter(Boolean).join("; ") || <Blank label="交货期" />],
    [
      "Port of Loading & Destination",
      d.loadingPort || d.dischargePort ? `FROM ${d.loadingPort || "CHINA"} TO ${d.dischargePort || d.destination || "___"}${d.shipMode ? ` ${d.shipMode}` : ""}` : <Blank label="装运港 / 目的港" />,
    ],
    ["Partial Shipment / Transhipment", `${d.partialShipment || "ALLOWED"} / ${d.transhipment || "ALLOWED"}`],
    ["Terms of Payment", <V key="pay" v={d.paymentTerm} l="付款方式" />],
  ];
  const extra = (d.terms || "").split("\n").map((s) => s.replace(/^\s*\d+[.)、]\s*/, "").trim()).filter(Boolean);
  return (
    <Sheet>
      <Letterhead d={d} contact />
      <Title>SALES CONTRACT</Title>
      <table className="ml-auto">
        <tbody className="[&_td]:py-0.5">
          <tr>
            <td className="pr-3 font-bold">Contract No.:</td>
            <td>
              <V v={d.no} l="合同号" />
            </td>
          </tr>
          <tr>
            <td className="pr-3 font-bold">Date:</td>
            <td>
              <V v={fmtDate(d.date, "en")} l="日期" />
            </td>
          </tr>
          {d.issuePlace && (
            <tr>
              <td className="pr-3 font-bold">Signed at:</td>
              <td>{d.issuePlace}</td>
            </tr>
          )}
        </tbody>
      </table>
      <section className="mt-3 grid grid-cols-2 gap-6">
        {[
          ["THE SELLER", d.sellerName, d.sellerAddress, [d.sellerTel, d.sellerEmail]],
          ["THE BUYER", d.buyerName, d.buyerAddress, [d.buyerContact, d.buyerTel, d.buyerEmail]],
        ].map(([who, name, addr, extra]) => (
          <div key={who as string} className="border border-neutral-700 p-2">
            <p className="font-bold">{who as string}:</p>
            <p className="font-bold uppercase">
              <V v={name as string} l={who === "THE SELLER" ? "卖方名称" : "买方名称"} />
            </p>
            {addr && <p className="whitespace-pre-line uppercase">{addr as string}</p>}
            <p>{(extra as (string | undefined)[]).filter(Boolean).join("  ·  ")}</p>
          </div>
        ))}
      </section>
      <p className="mt-3">
        The undersigned Seller and Buyer have agreed to close the following transaction according to the terms and conditions stipulated below:
      </p>
      <table className="mt-2 w-full border-collapse">
        <thead className="bg-neutral-100 text-center text-[9.5px] uppercase">
          <tr>
            <th className={th}>No.</th>
            <th className={th}>Item No.</th>
            <th className={th}>Commodity &amp; Specification</th>
            <th className={th}>Quantity</th>
            <th className={th}>Unit Price ({cur(d)})</th>
            <th className={th}>Amount ({cur(d)})</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it, i) => (
            <tr key={i} className="break-inside-avoid">
              <td className={cn(td, "text-center")}>{i + 1}</td>
              <td className={cn(td, "whitespace-nowrap")}>{it.itemNo}</td>
              <td className={td}>
                {it.name ? <p className="font-bold">{it.name}</p> : <Blank label="品名" />}
                {it.desc && <p className="whitespace-pre-line">{it.desc}</p>}
              </td>
              <td className={cn(td, num)}>
                {hasNum(it.qty) ? `${formatQty(parseNum(it.qty))} ${unitOf(it)}` : <Blank label="数量" />}
              </td>
              <td className={cn(td, num)}>{hasNum(it.unitPrice) ? formatPrice(parseNum(it.unitPrice)) : <Blank label="单价" />}</td>
              <td className={cn(td, num)}>{formatAmount(lineAmount(it))}</td>
            </tr>
          ))}
          {d.charges.map((c, i) => (
            <tr key={`c${i}`}>
              <td className={cn(td, "text-right uppercase")} colSpan={5}>
                {c.label}
              </td>
              <td className={cn(td, num)}>{formatAmount(parseNum(c.amount))}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className={cn(td, "text-right uppercase")} colSpan={3}>
              Total {termText(d)}
            </td>
            <td className={cn(td, num)}>{t.qty ? `${formatQty(t.qty)} ${t.qtyUnit}` : ""}</td>
            <td className={td} />
            <td className={cn(td, num)}>{formatAmount(t.total, cur(d))}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1.5 font-bold uppercase">{t.total ? amountInWords(t.total, cur(d)) : ""}</p>
      <ol className="mt-4 space-y-1.5">
        {clauses.map(([k, v], i) => (
          <li key={k} className="grid grid-cols-[6mm_52mm_1fr] break-inside-avoid">
            <span>{i + 1}.</span>
            <b>{k}:</b>
            <span className="whitespace-pre-line uppercase">{v}</span>
          </li>
        ))}
        {extra.map((s, i) => (
          <li key={`x${i}`} className="grid grid-cols-[6mm_1fr] break-inside-avoid">
            <span>{clauses.length + i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {d.bankInfo && (
        <section className="mt-4 border border-neutral-700 p-2.5 break-inside-avoid">
          <p className="mb-1 font-bold">BANK INFORMATION</p>
          <p className="whitespace-pre-line uppercase">{d.bankInfo}</p>
        </section>
      )}
      <section className="mt-10 grid grid-cols-2 gap-14 break-inside-avoid">
        {[
          ["THE SELLER", d.sellerName],
          ["THE BUYER", d.buyerName],
        ].map(([who, name]) => (
          <div key={who}>
            <p className="font-bold">{who}:</p>
            <p className="uppercase">{name}</p>
            <div className="mt-12 border-b border-neutral-800" />
            <p className="mt-1 text-neutral-600">Signature &amp; Company Chop</p>
          </div>
        ))}
      </section>
    </Sheet>
  );
}

// ── CI / PL 共用表头 ──

function InvoiceHead({ d, title }: { d: DocData; title: string }) {
  return (
    <>
      <Letterhead d={d} />
      <Title>{title}</Title>
      <table className="w-full">
        <tbody className="[&_td]:py-0.5 [&_td]:align-top">
          <tr>
            <td className="w-[28mm] font-bold">CONTRACT NO.:</td>
            <td>{d.contractNo || d.no}</td>
            <td className="w-[26mm] font-bold">INVOICE NO.:</td>
            <td className="w-[45mm]">
              <V v={d.no} l="发票号" />
            </td>
          </tr>
          <tr>
            <td className="font-bold">{d.lcNo ? "L/C NO.:" : ""}</td>
            <td>{d.lcNo}</td>
            <td className="font-bold">DATE:</td>
            <td>
              <V v={fmtDate(d.date)} l="日期" />
            </td>
          </tr>
          <tr>
            <td className="font-bold">MESSRS.:</td>
            <td colSpan={3} className="uppercase">
              <V v={d.buyerName} l="买方名称" />
              {d.buyerAddress ? `, ${d.buyerAddress}` : ""}
            </td>
          </tr>
          {(d.loadingPort || d.dischargePort) && (
            <tr>
              <td className="font-bold">SHIPMENT:</td>
              <td colSpan={3} className="uppercase">
                FROM {d.loadingPort || "CHINA"} TO {d.dischargePort || d.destination || "___"} {d.shipMode || ""}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function CommercialInvoice({ d }: { d: DocData }) {
  const t = totals(d);
  const rows = d.items.length ? d.items : [{} as DocItem];
  const span = rows.length + d.charges.length;
  return (
    <Sheet>
      <InvoiceHead d={d} title="COMMERCIAL INVOICE" />
      <table className="mt-3 w-full border-collapse">
        <thead className="text-center text-[9.5px] uppercase">
          <tr>
            <th className={cn(th, "w-[30mm]")} rowSpan={2}>
              Shipping Marks
            </th>
            <th className={th} rowSpan={2}>
              Description of Goods
            </th>
            <th className={cn(th, "w-[20mm]")}>Qty</th>
            <th className={cn(th, "w-[22mm]")}>Unit Price</th>
            <th className={cn(th, "w-[26mm]")}>Amount</th>
          </tr>
          <tr>
            <th className={th}>{t.qtyUnit || "PCS"}</th>
            <th className={th} colSpan={2}>
              {termText(d) || <Blank label="贸易术语" />} ({cur(d)})
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it, i) => (
            <tr key={i} className="break-inside-avoid">
              {i === 0 && (
                <td className={cn(td, "whitespace-pre-line uppercase")} rowSpan={span}>
                  {d.marks || "N/M"}
                </td>
              )}
              <td className={cn(td, "whitespace-pre-line uppercase")}>{itemText(it) || <Blank label="品名" />}</td>
              <td className={cn(td, num)}>{hasNum(it.qty) ? formatQty(parseNum(it.qty)) : <Blank label="数量" />}</td>
              <td className={cn(td, num)}>{hasNum(it.unitPrice) ? formatPrice(parseNum(it.unitPrice)) : <Blank label="单价" />}</td>
              <td className={cn(td, num)}>{formatAmount(lineAmount(it))}</td>
            </tr>
          ))}
          {d.charges.map((c, i) => (
            <tr key={`c${i}`}>
              <td className={cn(td, "uppercase")}>{c.label}</td>
              <td className={td} />
              <td className={td} />
              <td className={cn(td, num)}>{formatAmount(parseNum(c.amount))}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className={cn(td, "text-right")} colSpan={2}>
              TOTAL:
            </td>
            <td className={cn(td, num)}>{nz(t.qty, formatQty)}</td>
            <td className={td} />
            <td className={cn(td, num)}>{formatAmount(t.total, cur(d))}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1.5 font-bold uppercase">{t.total ? amountInWords(t.total, cur(d)) : ""}</p>
      {(d.batchNo || d.manfDate || d.expDate || d.hsCode) && (
        <table className="mt-3">
          <tbody className="[&_td]:py-0.5 [&_td]:pr-4">
            {d.hsCode && (
              <tr>
                <td className="font-bold">H.S. CODE</td>
                <td>{d.hsCode}</td>
              </tr>
            )}
            {d.batchNo && (
              <tr>
                <td className="font-bold">BATCH NO.</td>
                <td>{d.batchNo}</td>
              </tr>
            )}
            {d.manfDate && (
              <tr>
                <td className="font-bold">MANF.DATE</td>
                <td>{d.manfDate}</td>
              </tr>
            )}
            {d.expDate && (
              <tr>
                <td className="font-bold">EXP.DATE</td>
                <td>{d.expDate}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <LcFooter d={d} />
      <SignBlock d={d} />
    </Sheet>
  );
}

function PackingList({ d }: { d: DocData }) {
  const t = totals(d);
  const rows = d.items.length ? d.items : [{} as DocItem];
  return (
    <Sheet>
      <InvoiceHead d={d} title="PACKING LIST" />
      <table className="mt-3 w-full border-collapse">
        <thead className="text-center text-[9.5px] uppercase">
          <tr>
            <th className={cn(th, "w-[28mm]")} rowSpan={2}>
              Shipping Marks
            </th>
            <th className={th} rowSpan={2}>
              Description of Goods
            </th>
            <th className={th}>Qty</th>
            <th className={th}>Pkgs</th>
            <th className={th} colSpan={2}>
              Weight (KGS)
            </th>
            <th className={th}>Meas.</th>
          </tr>
          <tr>
            <th className={th}>{t.qtyUnit || "PCS"}</th>
            <th className={th}>{(d.packageUnit || "CTNS").replace("CARTONS", "CTNS")}</th>
            <th className={th}>N.W.</th>
            <th className={th}>G.W.</th>
            <th className={th}>CBM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it, i) => (
            <tr key={i} className="break-inside-avoid">
              {i === 0 && (
                <td className={cn(td, "whitespace-pre-line uppercase")} rowSpan={rows.length}>
                  {d.marks || "N/M"}
                </td>
              )}
              <td className={cn(td, "whitespace-pre-line uppercase")}>{itemText(it) || <Blank label="品名" />}</td>
              <td className={cn(td, num)}>{hasNum(it.qty) ? formatQty(parseNum(it.qty)) : <Blank label="数量" />}</td>
              <td className={cn(td, num)}>{hasNum(it.cartons) ? formatQty(parseNum(it.cartons)) : ""}</td>
              <td className={cn(td, num)}>{hasNum(it.nw) ? kg(parseNum(it.nw)) : ""}</td>
              <td className={cn(td, num)}>{hasNum(it.gw) ? kg(parseNum(it.gw)) : ""}</td>
              <td className={cn(td, num)}>{hasNum(it.cbm) ? kg(parseNum(it.cbm)) : ""}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className={cn(td, "text-right")} colSpan={2}>
              TOTAL:
            </td>
            <td className={cn(td, num)}>{nz(t.qty, formatQty)}</td>
            <td className={cn(td, num)}>{t.packages ? formatQty(t.packages) : <Blank label="件数" />}</td>
            <td className={cn(td, num)}>{nz(t.nw, kg)}</td>
            <td className={cn(td, num)}>{t.gw ? kg(t.gw) : <Blank label="毛重" />}</td>
            <td className={cn(td, num)}>{nz(t.cbm, kg)}</td>
          </tr>
        </tbody>
      </table>
      {t.packages > 0 && <p className="mt-1.5 font-bold uppercase">SAY TOTAL: {packagesInWords(t.packages, d.packageUnit || "CARTONS")} ONLY.</p>}
      <div className="mt-3 space-y-1 uppercase">{d.packingNote && <p>{d.packingNote}</p>}</div>
      <LcFooter d={d} />
      <SignBlock d={d} />
    </Sheet>
  );
}

// ── 托书 ──

const box = "border border-neutral-700 p-1.5 align-top";
const lab = "text-[9px] font-bold text-neutral-700";

function Check({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className="mr-3 inline-flex items-center gap-1 whitespace-nowrap">
      <span className="inline-grid size-[10px] place-items-center border border-neutral-800 text-[8px] leading-none">{on ? "✓" : ""}</span>
      {children}
    </span>
  );
}

function containerChecks(type?: string) {
  const s = (type || "").toUpperCase().replace(/\s/g, "");
  const count = (k: string) => {
    const m = new RegExp(`(\\d+)X${k}`).exec(s);
    return m ? m[1] : s.includes(k) ? "1" : "";
  };
  return {
    lcl: s.includes("LCL"),
    air: s.includes("AIR") || s.includes("EXPRESS"),
    gp20: count("20'?GP"),
    gp40: count("40'?GP"),
    hq40: count("40'?HQ"),
    hq45: count("45'?(HQ)?"),
  };
}

function BookingInstruction({ d }: { d: DocData }) {
  const t = totals(d);
  const c = containerChecks(d.containerType);
  const fcl = !!(c.gp20 || c.gp40 || c.hq40 || c.hq45);
  const blank = (v: string) => <u className="inline-block min-w-[6mm] text-center no-underline">{v ? `_${v}_` : "___"}</u>;
  return (
    <Sheet>
      <h1 className="text-center text-[16px] font-bold tracking-[0.1em]">BOOKING NOTE / SHIPPING INSTRUCTION</h1>
      <p className="mb-2 text-center text-neutral-600">订舱委托书 {d.date ? `· ${fmtDate(d.date)}` : ""}</p>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[58%]" />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <td className={box}>
              <p className={lab}>Shipper（发货人）:</p>
              <p className="font-bold uppercase">
                <V v={d.sellerName} l="发货人" />
              </p>
              <p className="whitespace-pre-line uppercase">{d.sellerAddress}</p>
            </td>
            <td className={box}>
              <p>
                <span className={lab}>Booking No.: </span>
                {d.bookingNo}
              </p>
              <p className="mt-1">
                <span className={lab}>S/O No. (D/R No.): </span>
              </p>
              <p className="mt-1">
                <span className={lab}>B/L No.: </span>
                {d.blNo}
              </p>
              {d.forwarder && (
                <p className="mt-1">
                  <span className={lab}>Forwarder: </span>
                  {d.forwarder}
                </p>
              )}
            </td>
          </tr>
          <tr>
            <td className={box}>
              <p className={lab}>Consignee（收货人）:</p>
              <V v={d.consignee} l="收货人" className="uppercase" />
            </td>
            <td className={box}>
              <p className="mb-1">
                <Check on={c.lcl}>LCL</Check>
                <Check on={fcl}>FCL</Check>
                <Check on={c.air}>AIR / EXPRESS</Check>
              </p>
              <p>
                FCL: {blank(c.gp20)} X 20&apos;GP; {blank(c.gp40)} X 40&apos;GP; {blank(c.hq40)} X 40&apos;HQ; {blank(c.hq45)} X 45&apos;
              </p>
              {d.containerType && !fcl && !c.lcl && <p className="mt-1">{d.containerType}</p>}
              <p className={cn(lab, "mt-2")}>SHIPPING MODE</p>
              <p>
                {["CY-CY", "CY-CFS", "CFS-CY", "CFS-CFS"].map((m) => (
                  <Check key={m} on={(d.shippingMode || "").toUpperCase() === m}>
                    {m}
                  </Check>
                ))}
              </p>
            </td>
          </tr>
          <tr>
            <td className={box}>
              <p className={lab}>Notify Party（通知人）:</p>
              <V v={d.notifyParty} l="通知人" className="uppercase" />
            </td>
            <td className={box}>
              <p className={lab}>Freight terms（运费付费方式）</p>
              <p>
                <Check on={/PREPAID/i.test(d.freightTerm || "")}>PREPAID（预付）</Check>
                <Check on={/COLLECT/i.test(d.freightTerm || "")}>COLLECT（到付）</Check>
              </p>
              <p className={cn(lab, "mt-2")}>Types of B/L</p>
              <p>
                <Check on={/ORIGINAL/i.test(d.blType || "")}>Original bill</Check>
                <Check on={/TELEX|TLX/i.test(d.blType || "")}>Tlx release bill</Check>
                <Check on={/SEAWAY/i.test(d.blType || "")}>Seaway bill</Check>
              </p>
            </td>
          </tr>
        </tbody>
      </table>
      <table className="w-full table-fixed border-collapse">
        <tbody>
          <tr>
            {[
              ["Vessel Name / Voy. No.", d.vessel, ""],
              ["Port of Loading（装货港）", d.loadingPort, "装货港"],
              ["Port of Discharge（卸货港）", d.dischargePort, "卸货港"],
              ["Final Destination", d.destination || d.dischargePort, ""],
            ].map(([k, v, l]) => (
              <td key={k} className={box}>
                <p className={lab}>{k}</p>
                <p className="uppercase">{l ? <V v={v} l={l} /> : v}</p>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <table className="w-full border-collapse">
        <thead className="text-center text-[9px]">
          <tr>
            <th className={cn(th, "w-[30mm]")}>Marks &amp; Numbers（唛头）</th>
            <th className={cn(th, "w-[22mm]")}>Quantity（件数）</th>
            <th className={th}>Description of Goods（货物描述）</th>
            <th className={cn(th, "w-[24mm]")}>Gross Weight（毛重）</th>
            <th className={cn(th, "w-[22mm]")}>Measurement（体积）</th>
          </tr>
        </thead>
        <tbody>
          <tr className="h-[60mm]">
            <td className={cn(td, "whitespace-pre-line uppercase")}>{d.marks || "N/M"}</td>
            <td className={cn(td, "text-center uppercase")}>
              {t.packages ? `${formatQty(t.packages)} ${(d.packageUnit || "CTNS").replace("CARTONS", "CTNS")}` : <Blank label="件数" />}
            </td>
            <td className={cn(td, "whitespace-pre-line uppercase")}>
              {goodsDescription(d) || <Blank label="货物描述" />}
              {d.hsCode && `\nH.S. CODE: ${d.hsCode}`}
              {d.freightTerm && `\n${d.freightTerm}`}
            </td>
            <td className={cn(td, "text-center")}>{t.gw ? `${kg(t.gw)} KGS` : <Blank label="毛重" />}</td>
            <td className={cn(td, "text-center")}>{t.cbm ? `${kg(t.cbm)} CBM` : <Blank label="体积" />}</td>
          </tr>
        </tbody>
      </table>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[58%]" />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <td className={box}>
              <p>
                <span className={lab}>Shipment terms: </span>
                {termText(d)}
              </p>
              <p className="mt-1">
                <span className={lab}>提货 / 装柜地址：</span>
                <span className="whitespace-pre-line">{d.pickupAddress}</span>
              </p>
              <p className="mt-1">
                <span className={lab}>货好时间：</span>
                {fmtDate(d.cargoReadyDate)}
              </p>
              {d.remark && (
                <p className="mt-1 whitespace-pre-line">
                  <span className={lab}>备注 / Remarks：</span>
                  {d.remark}
                </p>
              )}
            </td>
            <td className={box}>
              <p className={lab}>Contact Person（订舱联系人）:</p>
              <p className="whitespace-pre-line">{d.bookingContact || d.signer}</p>
              <p className={cn(lab, "mt-6")}>Company Chop（公司盖章） / Signature（签字）:</p>
              <div className="h-12" />
            </td>
          </tr>
        </tbody>
      </table>
      <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-[9px] text-neutral-600">
        <li>托运单是安排运输和出具提单的依据，各项内容必须认真填写；唛头、件数、货名、尺码等须填全。</li>
        <li>因托运单填写错误或资料不全导致货物不能及时出运、提单错误、不能结汇等，由托运人承担责任。</li>
        <li>危险品托运请提供真实品名以及 MSDS / 运输鉴定报告。</li>
      </ol>
    </Sheet>
  );
}

// ── 提单补料 ──

function BillOfLading({ d }: { d: DocData }) {
  const t = totals(d);
  const unit = d.packageUnit || "CARTONS";
  const cell = (n: string, k: string, v: React.ReactNode) => (
    <td className={box}>
      <p className={lab}>
        {n}
        {k}
      </p>
      <div className="uppercase">{v}</div>
    </td>
  );
  return (
    <Sheet>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-1/2" />
          <col />
        </colgroup>
        <tbody>
          <tr>
            {cell(
              "1.",
              "Shipper",
              <>
                <p className="font-bold">
                  <V v={d.sellerName} l="发货人" />
                </p>
                <p className="whitespace-pre-line">{d.sellerAddress}</p>
              </>,
            )}
            <td className={box} rowSpan={2}>
              <p className={lab}>Bill of Lading No.</p>
              <p className="text-[12px] font-bold">{d.blNo || "—"}</p>
              <p className="mt-6 text-center text-[18px] font-bold tracking-[0.15em]">BILL OF LADING</p>
              <p className="text-center text-neutral-600">{d.carrier ? d.carrier.toUpperCase() : "PORT TO PORT OR COMBINED TRANSPORT"}</p>
              <p className="mt-3 text-center text-[11px] font-bold text-red-700 print:text-neutral-900">DRAFT · FOR CHECKING ONLY</p>
            </td>
          </tr>
          <tr>{cell("2.", "Consignee", <V v={d.consignee} l="收货人" />)}</tr>
          <tr>
            {cell("3.", "Notify Party", <V v={d.notifyParty} l="通知人" />)}
            <td className={box}>
              <p className={lab}>Also Notify Party - routing &amp; Instructions</p>
              <p className="whitespace-pre-line">{d.remark}</p>
            </td>
          </tr>
          <tr>
            {cell("4.", "Combined Transport Pre-Carriage by", "")}
            {cell("5.", "Combined Transport Place of Receipt", d.loadingPort)}
          </tr>
          <tr>
            {cell("6.", "Ocean Vessel Voy No.", d.vessel)}
            {cell("7.", "Port of Loading", <V v={d.loadingPort} l="装货港" />)}
          </tr>
          <tr>
            {cell("8.", "Port of Discharge", <V v={d.dischargePort} l="卸货港" />)}
            {cell("9.", "Combined Transport Place of Delivery", d.destination || d.dischargePort)}
          </tr>
        </tbody>
      </table>
      <table className="w-full border-collapse">
        <thead className="text-center text-[9px]">
          <tr>
            <th className={cn(th, "w-[34mm]")}>Marks &amp; Nos. / Container / Seal No.</th>
            <th className={cn(th, "w-[22mm]")}>No. of Packages</th>
            <th className={th}>Description of Goods</th>
            <th className={cn(th, "w-[24mm]")}>Gross Weight</th>
            <th className={cn(th, "w-[22mm]")}>Measurement</th>
          </tr>
        </thead>
        <tbody>
          <tr className="h-[78mm]">
            <td className={cn(td, "whitespace-pre-line uppercase")}>
              {d.marks || "N/M"}
              {d.containers && `\n\nCNTR NO.:\n${d.containers}`}
            </td>
            <td className={cn(td, "text-center uppercase")}>
              {t.packages ? `${formatQty(t.packages)} ${unit.replace("CARTONS", "CTNS")}` : <Blank label="件数" />}
            </td>
            <td className={cn(td, "whitespace-pre-line uppercase")}>
              {goodsDescription(d) || <Blank label="货物描述" />}
              {d.hsCode && !goodsDescription(d).includes(d.hsCode) && `\nH.S. CODE: ${d.hsCode}`}
              {d.onBoardDate && `\n\nSHIPPED ON BOARD\n${fmtDate(d.onBoardDate).replace(".", " ").replace(",", ", ")}`}
            </td>
            <td className={cn(td, "text-center")}>{t.gw ? `${kg(t.gw)} KGS` : <Blank label="毛重" />}</td>
            <td className={cn(td, "text-center")}>{t.cbm ? `${kg(t.cbm)} CBM` : <Blank label="体积" />}</td>
          </tr>
        </tbody>
      </table>
      <table className="w-full table-fixed border-collapse">
        <tbody>
          <tr>
            <td className={box} colSpan={2}>
              <p className={lab}>10. Total Number of Containers and/or Packages (in words)</p>
              <p className="font-bold uppercase">
                {t.packages ? `SAY TOTAL: ${packagesInWords(t.packages, unit).replace(/ \(\d+\)/, "")} ONLY.` : <Blank label="件数" />}
              </p>
            </td>
          </tr>
          <tr>
            <td className={box}>
              <p className={lab}>11. Freight &amp; Charges</p>
              <p className="font-bold uppercase">
                <V v={d.freightTerm} l="运费条款" />
              </p>
            </td>
            <td className={box}>
              <p className={lab}>Place and Date of Issue</p>
              <p className="uppercase">{[d.issuePlace || d.loadingPort, fmtDate(d.date || d.onBoardDate)].filter(Boolean).join("  ")}</p>
              <p className={cn(lab, "mt-3")}>Signed for the Carrier</p>
              <div className="h-8" />
            </td>
          </tr>
        </tbody>
      </table>
    </Sheet>
  );
}

// ── 原产地证 ──

function CertificateOfOrigin({ d }: { d: DocData }) {
  const t = totals(d);
  const unit = d.packageUnit || "CARTONS";
  const route = d.loadingPort || d.dischargePort ? `FROM ${d.loadingPort || "CHINA"} TO ${d.dischargePort || "___"} ${d.shipMode || "BY SEA"}` : "";
  const qty = t.qty ? `${formatQty(t.qty)} ${t.qtyUnit || "PIECES"}` : "";
  return (
    <Sheet>
      <p className="text-right font-bold">ORIGINAL</p>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-1/2" />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <td className={box}>
              <p className={lab}>1. Exporter</p>
              <p className="uppercase">
                <V v={d.sellerName} l="出口商" />
              </p>
              <p className="whitespace-pre-line uppercase">{d.sellerAddress}</p>
              <p>***</p>
            </td>
            <td className={box} rowSpan={2}>
              <p className={lab}>Certificate No.</p>
              <p className="mt-10 text-center text-[15px] font-bold tracking-wide">CERTIFICATE OF ORIGIN</p>
              <p className="text-center font-bold">OF</p>
              <p className="text-center text-[13px] font-bold">THE PEOPLE&apos;S REPUBLIC OF CHINA</p>
            </td>
          </tr>
          <tr>
            <td className={box}>
              <p className={lab}>2. Consignee</p>
              <p className="whitespace-pre-line uppercase">
                <V v={d.buyerName} l="收货人" />
                {d.buyerAddress ? `\n${d.buyerAddress}` : ""}
              </p>
            </td>
          </tr>
          <tr>
            <td className={box}>
              <p className={lab}>3. Means of transport and route</p>
              <p className="uppercase">{route || <Blank label="运输路线" />}</p>
              <p className={cn(lab, "mt-3")}>4. Country / region of destination</p>
              <p className="uppercase">
                <V v={d.destCountry} l="目的国" />
              </p>
            </td>
            <td className={box}>
              <p className={lab}>5. For certifying authority use only</p>
            </td>
          </tr>
        </tbody>
      </table>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[26mm]" />
          <col />
          <col className="w-[22mm]" />
          <col className="w-[24mm]" />
          <col className="w-[28mm]" />
        </colgroup>
        <thead className="text-left text-[9px]">
          <tr>
            <th className={th}>6. Marks and numbers</th>
            <th className={th}>7. Number and kind of packages; description of goods</th>
            <th className={th}>8. H.S. Code</th>
            <th className={th}>9. Quantity</th>
            <th className={th}>10. Number and date of invoices</th>
          </tr>
        </thead>
        <tbody>
          <tr className="h-[95mm]">
            <td className={cn(td, "whitespace-pre-line uppercase")}>{d.marks || "N/M"}</td>
            <td className={cn(td, "whitespace-pre-line uppercase")}>
              {t.packages ? `${packagesInWords(t.packages, unit)} OF ` : <Blank label="件数" />}
              {goodsDescription(d) || <Blank label="货物描述" />}
              {d.docRemark && `\n${d.docRemark}`}
              {"\n***"}
            </td>
            <td className={td}>{d.hsCode ? d.hsCode.replace(/\./g, "") : <Blank label="HS 编码" />}</td>
            <td className={cn(td, "uppercase")}>{qty}</td>
            <td className={cn(td, "uppercase")}>
              <V v={d.no} l="发票号" />
              <br />
              <V v={fmtDate(d.date)} l="发票日期" />
            </td>
          </tr>
        </tbody>
      </table>
      <table className="w-full table-fixed border-collapse">
        <tbody>
          <tr>
            <td className={cn(box, "h-[46mm]")}>
              <p className={lab}>11. Declaration by the exporter</p>
              <p className="mt-1">
                The undersigned hereby declares that the above details and statements are correct, that all the goods were produced in China and that
                they comply with the Rules of Origin of the People&apos;s Republic of China.
              </p>
              <p className="mt-8 uppercase">
                {[d.issuePlace || d.loadingPort?.split(",")[0], fmtDate(d.date)].filter(Boolean).join("   ")}
              </p>
              <p className="border-t border-neutral-400 pt-0.5 text-[9px] text-neutral-600">Place and date, signature and stamp of authorized signatory</p>
            </td>
            <td className={box}>
              <p className={lab}>12. Certification</p>
              <p className="mt-1">It is hereby certified that the declaration by the exporter is correct.</p>
              <div className="h-[22mm]" />
              <p className="border-t border-neutral-400 pt-0.5 text-[9px] text-neutral-600">Place and date, signature and stamp of certifying authority</p>
            </td>
          </tr>
        </tbody>
      </table>
    </Sheet>
  );
}

// ── 装运通知 / 证明里的装运明细 ──

function ShipmentLines({ d }: { d: DocData }) {
  const t = totals(d);
  const rows: [string, React.ReactNode][] = [];
  const add = (k: string, v: React.ReactNode, show = true) => show && rows.push([k, v]);
  add("COVER NOTE NO.:", d.coverNote, !!d.coverNote);
  add("CARRIER:", d.carrier, !!d.carrier);
  add("L/C NO.:", d.lcNo, !!d.lcNo);
  add("B/L NO.:", <V key="bl" v={d.blNo} l="提单号" />);
  add("VESSEL NAME / VOY:", <V key="v" v={d.vessel} l="船名航次" />);
  add("ON BOARD DATE:", <V key="ob" v={fmtDate(d.onBoardDate)} l="装船日期" />);
  add("ETA DESTINATION PORT:", fmtDate(d.eta), !!d.eta);
  add("PORT OF LOADING:", <V key="pol" v={d.loadingPort} l="装货港" />);
  add("PORT OF DISCHARGE:", <V key="pod" v={d.dischargePort} l="卸货港" />);
  add("INVOICE NO.:", <V key="no" v={d.no} l="发票号" />);
  add("AMOUNT:", t.total ? `${cur(d)}${formatAmount(t.total)}` : "", !!t.total);
  add("CONTAINER NO.:", d.containers, !!d.containers);
  add("DESCRIPTION:", goodsDescription(d) || <Blank key="g" label="货物描述" />);
  add("QUANTITY OF GOODS:", t.qty ? `${formatQty(t.qty)}${t.qtyUnit}` : "", !!t.qty);
  add("NO. OF PACKAGES:", t.packages ? `${formatQty(t.packages)} ${d.packageUnit || "CARTONS"}` : <Blank key="p" label="件数" />);
  add("TOTAL NET WEIGHT:", `${kg(t.nw)}KGS`, !!t.nw);
  add("TOTAL GROSS WEIGHT:", `${kg(t.gw)}KGS`, !!t.gw);
  add("TOTAL MEASUREMENT:", `${kg(t.cbm)}CBM`, !!t.cbm);
  add("SHIPPING MARK:", d.marks, !!d.marks);
  return (
    <table className="mt-3">
      <tbody className="[&_td]:py-[3px] [&_td]:align-top">
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="w-[48mm] pr-3 font-bold whitespace-nowrap">{k}</td>
            <td className="whitespace-pre-line uppercase">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Recipients({ text }: { text?: string }) {
  const blocks = (text || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!blocks.length) return null;
  return (
    <div className="mt-3 space-y-1.5">
      {blocks.map((b, i) => (
        <div key={i} className="grid grid-cols-[12mm_1fr]">
          <b>TO:</b>
          <p className="whitespace-pre-line uppercase">{b}</p>
        </div>
      ))}
    </div>
  );
}

function ShipmentAdvice({ d }: { d: DocData }) {
  return (
    <Sheet>
      <Letterhead d={d} />
      <Title>SHIPMENT ADVICE</Title>
      <p className="font-bold">RE: SHIPMENT ADVICE</p>
      <p>
        DATE: <V v={fmtDate(d.date)} l="日期" />
      </p>
      {d.recipients ? <Recipients text={d.recipients} /> : <p className="mt-3"><b>TO:</b> <Blank label="收件方" /></p>}
      {d.remark && <p className="mt-3 whitespace-pre-line">{d.remark}</p>}
      <p className="mt-3">WE HEREBY ADVISE THAT THE FOLLOWING GOODS HAVE BEEN SHIPPED AS PER DETAILS BELOW:</p>
      <ShipmentLines d={d} />
      <LcFooter d={d} />
      <SignBlock d={d} />
    </Sheet>
  );
}

function BeneficiaryCertificate({ d }: { d: DocData }) {
  const statement = (d.certText || "").trim().replace(/^WE\s+(HEREBY\s+)?CERTIFY(ING)?\s+THAT\s*/i, "");
  return (
    <Sheet>
      <Letterhead d={d} />
      <Title>{(d.certTitle || "CERTIFICATE").toUpperCase()}</Title>
      <table className="ml-auto">
        <tbody className="[&_td]:py-0.5">
          {d.no && (
            <tr>
              <td className="pr-3 font-bold">INVOICE NO.:</td>
              <td>{d.no}</td>
            </tr>
          )}
          {d.lcNo && (
            <tr>
              <td className="pr-3 font-bold">L/C NO.:</td>
              <td>
                {d.lcNo}
                {d.lcDate ? ` DATED ${fmtDate(d.lcDate)}` : ""}
              </td>
            </tr>
          )}
          <tr>
            <td className="pr-3 font-bold">DATE:</td>
            <td>
              <V v={fmtDate(d.date)} l="日期" />
            </td>
          </tr>
        </tbody>
      </table>
      <Recipients text={d.recipients} />
      <p className="mt-5 text-[11.5px] leading-relaxed uppercase">
        WE HEREBY CERTIFY THAT {statement ? statement : <Blank label="证明内容" />}
      </p>
      {d.certShowShipment === "YES" && <ShipmentLines d={d} />}
      <LcFooter d={d} />
      <SignBlock d={d} />
    </Sheet>
  );
}

// ── 汇票 ──

function BillOfExchange({ d }: { d: DocData }) {
  const t = totals(d);
  const amount = hasNum(d.draftAmount) ? parseNum(d.draftAmount) : t.total;
  const copy = (which: "FIRST" | "SECOND") => (
    <section className="border-2 border-neutral-800 p-5 break-inside-avoid">
      <div className="flex items-start justify-between">
        <p>
          <b>No.</b> <V v={d.no} l="发票号" />
        </p>
        <p className="text-[16px] font-bold tracking-[0.15em]">BILL OF EXCHANGE</p>
        <p className="text-neutral-500">{which}</p>
      </div>
      <div className="mt-3 flex justify-between">
        <p>
          <b>For</b> {amount ? formatAmount(amount, cur(d)) : <Blank label="金额" />}
        </p>
        <p className="uppercase">
          {[d.issuePlace, fmtDate(d.date)].filter(Boolean).join(", ") || <Blank label="地点日期" />}
        </p>
      </div>
      <p className="mt-4 leading-[2] uppercase">
        AT <b>{(d.draftTenor || "").replace(/^AT\s+/i, "") || <Blank label="期限" />}</b> OF THIS {which} OF EXCHANGE (
        {which === "FIRST" ? "SECOND" : "FIRST"} OF THE SAME TENOR AND DATE BEING UNPAID) PAY TO THE ORDER OF{" "}
        <b>
          <V v={d.payee} l="收款人 / 议付行" />
        </b>{" "}
        THE SUM OF <b>{amount ? amountInWords(amount, cur(d)).replace(/^SAY\s+/, "") : <Blank label="大写金额" />}</b>
      </p>
      <p className="mt-3 uppercase">
        DRAWN UNDER {d.issuingBank ? d.issuingBank.split("\n")[0] : <Blank label="开证行" />}
        {d.lcNo && ` L/C NO. ${d.lcNo}`}
        {d.lcDate && ` DATED ${fmtDate(d.lcDate)}`}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-8">
        <div>
          <p className="font-bold">TO:</p>
          <p className="whitespace-pre-line uppercase">
            <V v={d.drawee} l="付款人" />
          </p>
        </div>
        <div className="text-center">
          <p className="font-bold uppercase">FOR AND ON BEHALF OF {d.sellerName || ""}</p>
          <div className="mt-10 border-b border-neutral-800" />
          <p className="mt-1 text-neutral-600">Authorized Signature</p>
        </div>
      </div>
    </section>
  );
  return (
    <Sheet>
      <div className="space-y-[12mm]">
        {copy("FIRST")}
        {copy("SECOND")}
      </div>
    </Sheet>
  );
}

const RENDER: Record<DocType, (p: { d: DocData }) => React.ReactNode> = {
  pi: ProformaInvoice,
  sc: SalesContract,
  ci: CommercialInvoice,
  pl: PackingList,
  si: BookingInstruction,
  bl: BillOfLading,
  co: CertificateOfOrigin,
  sa: ShipmentAdvice,
  bc: BeneficiaryCertificate,
  bx: BillOfExchange,
};

export function TradeDocView({ type, data }: { type: DocType; data: DocData }) {
  const R = RENDER[type];
  return <R d={data} />;
}

export const docEnglishName = (type: DocType) => TEMPLATES[type].en;
