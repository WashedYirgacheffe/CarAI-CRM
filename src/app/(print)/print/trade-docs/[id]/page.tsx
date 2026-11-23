import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/crm/print-toolbar";
import { TradeDocView } from "@/components/trade-docs/doc-render";
import { docTitle } from "@/lib/trade-docs/schema";
import { requireUser } from "@/server/auth";
import { getTradeDoc } from "@/server/trade-docs";

export async function generateMetadata({ params }: PageProps<"/print/trade-docs/[id]">): Promise<Metadata> {
  const { id } = await params;
  const d = await getTradeDoc(await requireUser(), id);
  return { title: { absolute: d ? docTitle(d.type, d.data) : "Document" } };
}

export default async function PrintTradeDocPage({ params }: PageProps<"/print/trade-docs/[id]">) {
  const { id } = await params;
  const d = await getTradeDoc(await requireUser(), id);
  if (!d) notFound();
  return (
    <>
      <PrintToolbar backHref={`/doc?id=${id}`} hint="黄色占位在打印时是空白；卖方抬头在「设置 → 单据设置」里维护" />
      <TradeDocView type={d.type} data={d.data} />
    </>
  );
}
