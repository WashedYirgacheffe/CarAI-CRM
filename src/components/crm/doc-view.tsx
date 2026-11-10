import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Thumb } from "@/components/crm/image-upload";
import { formatAmount, formatPrice, formatQty } from "@/lib/docs";

export type ViewItem = {
  id: string;
  sku: string | null;
  name: string;
  spec: string | null;
  imageUrl: string | null;
  unit: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};

export type ViewMoney = {
  currency: string;
  exchangeRate: string;
  subtotal: string;
  discount: string;
  shippingFee: string;
  otherFee: string;
  total: string;
};

/** 单据详情里的「键值」信息块 */
export function InfoGrid({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 break-words whitespace-pre-line">{v || <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 明细 + 合计 */
export function ItemsCard({ items, money }: { items: ViewItem[]; money: ViewMoney }) {
  const c = money.currency;
  const fee = (label: string, v: string, sign = "") =>
    Number(v) ? (
      <div className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {sign}
          {formatAmount(v, c)}
        </span>
      </div>
    ) : null;
  const qty = items.reduce((s, i) => s + Number(i.quantity), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>产品明细（{items.length} 项）</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="w-8 py-2 text-left font-normal">#</th>
                <th className="py-2 text-left font-normal">产品 / 规格</th>
                <th className="py-2 text-right font-normal">数量</th>
                <th className="py-2 text-right font-normal">单价</th>
                <th className="py-2 text-right font-normal">金额（{c}）</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id} className="border-b align-top last:border-0">
                  <td className="py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <div className="flex gap-2.5">
                      <Thumb src={it.imageUrl} alt={it.name} />
                      <div className="min-w-0">
                        <p className="font-medium">{it.name}</p>
                        {it.sku && <p className="text-xs text-muted-foreground tabular-nums">{it.sku}</p>}
                        {it.spec && <p className="mt-0.5 text-xs whitespace-pre-line text-muted-foreground">{it.spec}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap tabular-nums">
                    {formatQty(it.quantity)} {it.unit}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{formatPrice(it.unitPrice)}</td>
                  <td className="py-2.5 text-right font-medium tabular-nums">{formatAmount(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 ml-auto grid max-w-xs gap-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">小计（共 {formatQty(qty)} 件）</span>
            <span className="tabular-nums">{formatAmount(money.subtotal, c)}</span>
          </div>
          {fee("折扣", money.discount, "−")}
          {fee("运费", money.shippingFee)}
          {fee("其他费用", money.otherFee)}
          <div className="flex justify-between border-t pt-2 text-base font-medium">
            <span>合计</span>
            <span className="tabular-nums">{formatAmount(money.total, c)}</span>
          </div>
          {c !== "CNY" && (
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              ≈ {formatAmount(Number(money.total) * Number(money.exchangeRate), "CNY")}（开单汇率 {Number(money.exchangeRate)}）
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function moneyOf(d: {
  currency: string;
  exchangeRate: { toString(): string };
  subtotal: { toString(): string };
  discount: { toString(): string };
  shippingFee: { toString(): string };
  otherFee: { toString(): string };
  total: { toString(): string };
}): ViewMoney {
  return {
    currency: d.currency,
    exchangeRate: d.exchangeRate.toString(),
    subtotal: d.subtotal.toString(),
    discount: d.discount.toString(),
    shippingFee: d.shippingFee.toString(),
    otherFee: d.otherFee.toString(),
    total: d.total.toString(),
  };
}

export function viewItems(
  items: {
    id: string;
    sku: string | null;
    name: string;
    spec: string | null;
    imageUrl: string | null;
    unit: string;
    quantity: { toString(): string };
    unitPrice: { toString(): string };
    amount: { toString(): string };
  }[],
): ViewItem[] {
  return items.map((i) => ({
    id: i.id,
    sku: i.sku,
    name: i.name,
    spec: i.spec,
    imageUrl: i.imageUrl,
    unit: i.unit,
    quantity: i.quantity.toString(),
    unitPrice: i.unitPrice.toString(),
    amount: i.amount.toString(),
  }));
}
