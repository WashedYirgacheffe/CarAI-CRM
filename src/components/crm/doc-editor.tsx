"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, PackagePlus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { Thumb } from "@/components/crm/image-upload";
import { useActionForm } from "@/hooks/use-action-form";
import type { ActionState } from "@/lib/action";
import { CURRENCIES } from "@/lib/crm";
import {
  PAYMENT_TERMS,
  PRODUCT_UNITS,
  TRADE_TERMS,
  computeTotals,
  convertPrice,
  formatAmount,
  formatPrice,
  lineAmount,
  round2,
  type DocItemInput,
} from "@/lib/docs";

export type EditorProduct = {
  id: string;
  sku: string;
  name: string;
  nameEn: string | null;
  spec: string | null;
  unit: string;
  price: number;
  currency: string;
  imageUrl: string | null;
};

export type EditorCustomer = {
  id: string;
  name: string;
  address: string | null;
  contacts: { id: string; name: string; email: string | null; phone: string | null }[];
  opportunities: { id: string; name: string }[];
};

export type DocInitial = {
  id?: string;
  customerId?: string;
  opportunityId?: string | null;
  quotationId?: string | null;
  buyerName?: string;
  buyerContact?: string | null;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  buyerAddress?: string | null;
  currency: string;
  /** 报价日期 / 下单日期（yyyy-mm-dd） */
  date: string;
  /** 有效期 / 交货期（yyyy-mm-dd） */
  date2?: string;
  tradeTerm?: string | null;
  port?: string | null;
  paymentTerm?: string | null;
  deliveryTime?: string | null;
  title?: string | null;
  shippingMark?: string | null;
  discount?: number;
  shippingFee?: number;
  otherFee?: number;
  terms?: string | null;
  remark?: string | null;
  items: DocItemInput[];
};

type Row = {
  key: number;
  productId: string | null;
  sku: string;
  name: string;
  spec: string;
  imageUrl: string | null;
  unit: string;
  quantity: string;
  unitPrice: string;
};

let rowKey = 0;
const toRow = (i: Partial<DocItemInput>): Row => ({
  key: ++rowKey,
  productId: i.productId ?? null,
  sku: i.sku ?? "",
  name: i.name ?? "",
  spec: i.spec ?? "",
  imageUrl: i.imageUrl ?? null,
  unit: i.unit ?? "pcs",
  quantity: i.quantity != null ? String(i.quantity) : "1",
  unitPrice: i.unitPrice != null ? String(i.unitPrice) : "",
});
const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);

export function DocEditor({
  kind,
  action,
  initial,
  customers,
  products,
  rates,
  cancelHref,
}: {
  kind: "quotation" | "order";
  action: (prev: ActionState, fd: FormData) => Promise<ActionState & { id?: string }>;
  initial: DocInitial;
  customers: EditorCustomer[];
  products: EditorProduct[];
  rates: Record<string, number>;
  cancelHref: string;
}) {
  const router = useRouter();
  const base = kind === "quotation" ? "/quotations" : "/orders";
  const [state, submit, pending] = useActionForm(action, (_f, r) => {
    if (r.id) router.push(`${base}/${r.id}`);
  });

  const [customerId, setCustomerId] = useState(initial.customerId ?? "");
  const customer = customers.find((c) => c.id === customerId);
  const [buyer, setBuyer] = useState({
    buyerName: initial.buyerName ?? "",
    buyerContact: initial.buyerContact ?? "",
    buyerEmail: initial.buyerEmail ?? "",
    buyerPhone: initial.buyerPhone ?? "",
    buyerAddress: initial.buyerAddress ?? "",
  });
  const [currency, setCurrency] = useState(initial.currency);
  const [rows, setRows] = useState<Row[]>(() => initial.items.map(toRow));
  const [fees, setFees] = useState({
    discount: String(initial.discount ?? 0),
    shippingFee: String(initial.shippingFee ?? 0),
    otherFee: String(initial.otherFee ?? 0),
  });

  const totals = computeTotals(
    rows.map((r) => ({ quantity: num(r.quantity), unitPrice: num(r.unitPrice) })),
    { discount: num(fees.discount), shippingFee: num(fees.shippingFee), otherFee: num(fees.otherFee) },
  );

  function pickCustomer(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    const p = c.contacts[0];
    setBuyer({
      buyerName: c.name,
      buyerContact: p?.name ?? "",
      buyerEmail: p?.email ?? "",
      buyerPhone: p?.phone ?? "",
      buyerAddress: c.address ?? "",
    });
  }

  function pickContact(id: string) {
    const p = customer?.contacts.find((x) => x.id === id);
    if (p) setBuyer((b) => ({ ...b, buyerContact: p.name, buyerEmail: p.email ?? "", buyerPhone: p.phone ?? "" }));
  }

  function changeCurrency(next: string) {
    const prev = currency;
    setCurrency(next);
    if (!rates[prev] || !rates[next]) return;
    const conv = (s: string) => (s === "" ? s : String(convertPrice(num(s), prev, next, rates)));
    const hasMoney = rows.some((r) => num(r.unitPrice) > 0) || Object.values(fees).some((v) => num(v) > 0);
    if (!hasMoney) return;
    setRows((rs) => rs.map((r) => ({ ...r, unitPrice: conv(r.unitPrice) })));
    setFees((f) => ({
      discount: String(round2(num(conv(f.discount)))),
      shippingFee: String(round2(num(conv(f.shippingFee)))),
      otherFee: String(round2(num(conv(f.otherFee)))),
    }));
    toast.info(`单价和费用已按汇率从 ${prev} 换算为 ${next}`, {
      description: `1 ${prev} = ${(rates[prev] / rates[next]).toFixed(4)} ${next}，可在「设置 → 汇率」修改`,
    });
  }

  function addProduct(p: EditorProduct) {
    setRows((rs) => [
      ...rs.filter((r) => r.name || r.unitPrice), // 去掉空白行
      toRow({
        productId: p.id,
        sku: p.sku,
        name: p.nameEn || p.name,
        spec: p.spec,
        imageUrl: p.imageUrl,
        unit: p.unit,
        quantity: 1,
        unitPrice: convertPrice(p.price, p.currency, currency, rates),
      }),
    ]);
  }

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const n = [...rs];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const itemsJson = JSON.stringify(
    rows.map((r) => ({
      productId: r.productId,
      sku: r.sku,
      name: r.name,
      spec: r.spec,
      imageUrl: r.imageUrl,
      unit: r.unit,
      quantity: r.quantity,
      unitPrice: r.unitPrice === "" ? "0" : r.unitPrice,
    })),
  );

  const isQuote = kind === "quotation";
  const fixedCustomer = !!initial.id || (!!initial.customerId && customers.length <= 1);

  return (
    <form onSubmit={submit} className="space-y-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {initial.quotationId && <input type="hidden" name="quotationId" value={initial.quotationId} />}
      <input type="hidden" name="items" value={itemsJson} />
      <FormMessage state={state} />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">基本信息</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="d-customer">客户</FieldLabel>
              {fixedCustomer ? (
                <>
                  <input type="hidden" name="customerId" value={customerId} />
                  <Input id="d-customer" value={customer?.name ?? initial.buyerName ?? ""} disabled />
                </>
              ) : (
                <NativeSelect id="d-customer" name="customerId" value={customerId} onChange={(e) => pickCustomer(e.target.value)} required>
                  <option value="" disabled>
                    选择客户
                  </option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
              <FieldErrors state={state} name="customerId" />
            </Field>
            <Field>
              <FieldLabel htmlFor="d-opp">关联商机</FieldLabel>
              <NativeSelect id="d-opp" name="opportunityId" defaultValue={initial.opportunityId ?? ""} key={customerId}>
                <option value="">不关联</option>
                {customer?.opportunities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {isQuote && (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="d-title">报价主题</FieldLabel>
                <Input id="d-title" name="title" defaultValue={initial.title ?? ""} placeholder="如：LED Bulb Quotation for 2027 Spring" />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="d-date">{isQuote ? "报价日期" : "下单日期"}</FieldLabel>
              <Input id="d-date" name={isQuote ? "quoteDate" : "orderDate"} type="date" defaultValue={initial.date} required />
              <FieldErrors state={state} name={isQuote ? "quoteDate" : "orderDate"} />
            </Field>
            <Field>
              <FieldLabel htmlFor="d-date2">{isQuote ? "有效期至" : "交货日期"}</FieldLabel>
              <Input id="d-date2" name={isQuote ? "validUntil" : "deliveryDate"} type="date" defaultValue={initial.date2 ?? ""} />
              <FieldErrors state={state} name={isQuote ? "validUntil" : "deliveryDate"} />
            </Field>
            <Field>
              <FieldLabel htmlFor="d-currency">币种</FieldLabel>
              <NativeSelect id="d-currency" name="currency" value={currency} onChange={(e) => changeCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-[7rem_1fr] gap-3">
              <Field>
                <FieldLabel htmlFor="d-term">贸易术语</FieldLabel>
                <NativeSelect id="d-term" name="tradeTerm" defaultValue={initial.tradeTerm ?? "FOB"}>
                  <option value="">—</option>
                  {TRADE_TERMS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="d-port">港口 / 地点</FieldLabel>
                <Input id="d-port" name="port" defaultValue={initial.port ?? ""} placeholder="如 Ningbo" />
              </Field>
            </div>
            <Field className={isQuote ? "" : "sm:col-span-2"}>
              <FieldLabel htmlFor="d-pay">付款方式</FieldLabel>
              <Input id="d-pay" name="paymentTerm" defaultValue={initial.paymentTerm ?? ""} list="payment-terms" />
              <datalist id="payment-terms">
                {PAYMENT_TERMS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            {isQuote ? (
              <Field>
                <FieldLabel htmlFor="d-delivery">交货期</FieldLabel>
                <Input id="d-delivery" name="deliveryTime" defaultValue={initial.deliveryTime ?? ""} placeholder="如 25-30 days after deposit" />
              </Field>
            ) : (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="d-mark">唛头</FieldLabel>
                <Textarea id="d-mark" name="shippingMark" defaultValue={initial.shippingMark ?? ""} rows={2} />
              </Field>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">买方信息</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field>
              <FieldLabel htmlFor="b-name">公司名称</FieldLabel>
              <Input
                id="b-name"
                name="buyerName"
                value={buyer.buyerName}
                onChange={(e) => setBuyer({ ...buyer, buyerName: e.target.value })}
                required
              />
              <FieldErrors state={state} name="buyerName" />
            </Field>
            <Field>
              <FieldLabel htmlFor="b-contact">联系人</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="b-contact"
                  name="buyerContact"
                  value={buyer.buyerContact}
                  onChange={(e) => setBuyer({ ...buyer, buyerContact: e.target.value })}
                />
                {customer && customer.contacts.length > 1 && (
                  <NativeSelect className="w-24" aria-label="选择联系人" value="" onChange={(e) => pickContact(e.target.value)}>
                    <option value="">选择</option>
                    {customer.contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="b-email">邮箱</FieldLabel>
              <Input id="b-email" name="buyerEmail" value={buyer.buyerEmail} onChange={(e) => setBuyer({ ...buyer, buyerEmail: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="b-phone">电话</FieldLabel>
              <Input id="b-phone" name="buyerPhone" value={buyer.buyerPhone} onChange={(e) => setBuyer({ ...buyer, buyerPhone: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="b-addr">地址</FieldLabel>
              <Textarea
                id="b-addr"
                name="buyerAddress"
                rows={2}
                value={buyer.buyerAddress}
                onChange={(e) => setBuyer({ ...buyer, buyerAddress: e.target.value })}
              />
            </Field>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">产品明细</CardTitle>
          <CardAction className="flex gap-2">
            <ProductPicker products={products} currency={currency} rates={rates} onPick={addProduct} />
            <Button type="button" size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, toRow({})])}>
              <Plus /> 空白行
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldErrors state={state} name="items" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="w-8 py-2 text-left font-normal">#</th>
                  <th className="py-2 text-left font-normal">产品 / 规格</th>
                  <th className="w-24 py-2 text-left font-normal">单位</th>
                  <th className="w-28 py-2 text-right font-normal">数量</th>
                  <th className="w-32 py-2 text-right font-normal">单价（{currency}）</th>
                  <th className="w-32 py-2 text-right font-normal">金额</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground">
                      从产品库添加，或加一行空白明细手动填写
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr key={r.key} className="border-b align-top last:border-0">
                    <td className="py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <div className="flex gap-2">
                        <Thumb src={r.imageUrl} className="mt-0.5" />
                        <div className="flex-1 space-y-1.5">
                          <div className="flex gap-1.5">
                            <Input
                              value={r.name}
                              onChange={(e) => update(r.key, { name: e.target.value })}
                              placeholder="品名"
                              aria-label={`第 ${i + 1} 行品名`}
                              className="h-8"
                            />
                            <Input
                              value={r.sku}
                              onChange={(e) => update(r.key, { sku: e.target.value })}
                              placeholder="货号"
                              aria-label={`第 ${i + 1} 行货号`}
                              className="h-8 w-32"
                            />
                          </div>
                          <Textarea
                            value={r.spec}
                            onChange={(e) => update(r.key, { spec: e.target.value })}
                            placeholder="规格描述"
                            aria-label={`第 ${i + 1} 行规格`}
                            rows={1}
                            className="min-h-8 py-1.5 text-xs"
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        value={r.unit}
                        onChange={(e) => update(r.key, { unit: e.target.value })}
                        list="doc-units"
                        aria-label={`第 ${i + 1} 行单位`}
                        className="h-8"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={r.quantity}
                        onChange={(e) => update(r.key, { quantity: e.target.value })}
                        aria-label={`第 ${i + 1} 行数量`}
                        className="h-8 text-right tabular-nums"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={r.unitPrice}
                        onChange={(e) => update(r.key, { unitPrice: e.target.value })}
                        aria-label={`第 ${i + 1} 行单价`}
                        className="h-8 text-right tabular-nums"
                      />
                    </td>
                    <td className="py-2.5 text-right font-medium tabular-nums">
                      {formatAmount(lineAmount(num(r.quantity), num(r.unitPrice)))}
                    </td>
                    <td className="py-2 pl-2">
                      <div className="flex justify-end">
                        <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="上移" disabled={i === 0} onClick={() => move(i, -1)}>
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label="下移"
                          disabled={i === rows.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDown className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 hover:text-destructive"
                          aria-label="删除这一行"
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="doc-units">
              {PRODUCT_UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>

          <div className="mt-4 ml-auto grid w-full max-w-sm gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">小计</span>
              <span className="tabular-nums">{formatAmount(totals.subtotal, currency)}</span>
            </div>
            {(
              [
                ["discount", "折扣（减）"],
                ["shippingFee", "运费"],
                ["otherFee", "其他费用"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{label}</span>
                <Input
                  name={k}
                  type="number"
                  min={0}
                  step="0.01"
                  value={fees[k]}
                  onChange={(e) => setFees({ ...fees, [k]: e.target.value })}
                  className="h-8 w-36 text-right tabular-nums"
                />
              </label>
            ))}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <span>合计</span>
              <span className="tabular-nums">{formatAmount(totals.total, currency)}</span>
            </div>
            {currency !== "CNY" && rates[currency] && (
              <p className="text-right text-xs text-muted-foreground tabular-nums">
                ≈ {formatAmount(round2(totals.total * rates[currency]), "CNY")}（汇率 {rates[currency]}）
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">条款与备注</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="d-terms">条款（打印在单据上）</FieldLabel>
            <Textarea id="d-terms" name="terms" defaultValue={initial.terms ?? ""} rows={5} />
          </Field>
          <Field>
            <FieldLabel htmlFor="d-remark">内部备注（不打印）</FieldLabel>
            <Textarea id="d-remark" name="remark" defaultValue={initial.remark ?? ""} rows={5} />
          </Field>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <Button type="button" variant="outline" onClick={() => router.push(cancelHref)}>
          取消
        </Button>
        {!initial.id && !isQuote && (
          <Button type="submit" variant="outline" name="asDraft" value="1" disabled={pending}>
            存为草稿
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : initial.id ? "保存" : isQuote ? "创建报价单" : "创建订单"}
        </Button>
      </div>
    </form>
  );
}

function ProductPicker({
  products,
  currency,
  rates,
  onPick,
}: {
  products: EditorProduct[];
  currency: string;
  rates: Record<string, number>;
  onPick: (p: EditorProduct) => void;
}) {
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    const hit = k
      ? products.filter((p) => [p.sku, p.name, p.nameEn].some((s) => s?.toLowerCase().includes(k)))
      : products;
    return hit.slice(0, 50);
  }, [q, products]);

  return (
    <Popover onOpenChange={(o) => !o && setAdded(new Set())}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm">
          <PackagePlus /> 从产品库添加
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] p-0">
        <div className="relative border-b p-2">
          <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索编号 / 品名" className="h-8 pl-8" autoFocus />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {products.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">产品库是空的，先去「产品」里添加</li>}
          {products.length > 0 && list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的产品</li>}
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onPick(p);
                  setAdded((s) => new Set(s).add(p.id));
                }}
              >
                <Thumb src={p.imageUrl} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.nameEn || p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.sku}
                    {p.nameEn && ` · ${p.name}`}
                  </span>
                </span>
                <span className="text-right text-xs whitespace-nowrap tabular-nums">
                  {added.has(p.id) ? (
                    <span className="text-emerald-600">已添加</span>
                  ) : (
                    <>
                      {currency} {formatPrice(convertPrice(p.price, p.currency, currency, rates))}
                      <span className="block text-muted-foreground">/ {p.unit}</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
