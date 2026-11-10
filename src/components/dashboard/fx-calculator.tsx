"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { formatAmount, round2 } from "@/lib/docs";

/** 汇率换算：用企业汇率表（1 外币 = x 人民币），和报价单、订单用的是同一套汇率 */
export function FxCalculator({ rates, currencies }: { rates: Record<string, number>; currencies: readonly string[] }) {
  const [amount, setAmount] = useState("1000");
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("CNY");
  const a = rates[from];
  const b = rates[to];
  const n = Number(amount);
  const ok = !!a && !!b && Number.isFinite(n);
  const result = ok ? round2((n * a) / b) : null;
  const unit = ok ? a / b : null;
  const others = currencies.filter((c) => c !== "CNY" && rates[c]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-32 tabular-nums"
          aria-label="金额"
        />
        <NativeSelect value={from} onChange={(e) => setFrom(e.target.value)} className="w-24" aria-label="原币种">
          {currencies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </NativeSelect>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="互换币种"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          <ArrowLeftRight />
        </Button>
        <NativeSelect value={to} onChange={(e) => setTo(e.target.value)} className="w-24" aria-label="目标币种">
          {currencies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="rounded-lg bg-muted/50 px-3 py-2.5">
        {result !== null ? (
          <>
            <p className="text-2xl font-semibold tabular-nums">{formatAmount(result, to)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              1 {from} = {unit!.toFixed(4)} {to}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{!a || !b ? `还没有设置 ${!a ? from : to} 的汇率` : "请输入金额"}</p>
        )}
      </div>
      {others.length > 0 && (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums @sm:grid-cols-3">
          {others.map((c) => (
            <li key={c}>
              1 {c} = {rates[c].toFixed(4)} CNY
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        汇率在{" "}
        <Link href="/settings/documents" className="underline-offset-2 hover:text-primary hover:underline">
          设置 → 单据设置
        </Link>{" "}
        里维护，报价单和订单也用这套汇率。
      </p>
    </div>
  );
}
