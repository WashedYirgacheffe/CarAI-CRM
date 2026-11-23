import type { Metadata } from "next";
import { can, requireUser } from "@/server/auth";
import { aiConfigured } from "@/server/ai";
import { getTradeDoc, listTradeDocs, orderPrefill, sellerDefaults } from "@/server/trade-docs";
import { emptyDoc, isDocType, type DocData, type DocType } from "@/lib/trade-docs/schema";
import { Workbench } from "./workbench";

export const metadata: Metadata = { title: "AI 单据制作" };

/** AI 单据制作工作台：填表或和车车 AI 对话，按公司样本版式出外贸单据（暂不放进导航） */
export default async function DocPage({ searchParams }: PageProps<"/doc">) {
  const user = await requireUser();
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const [seller, docs, saved, prefill] = await Promise.all([
    sellerDefaults(user.tenantId),
    listTradeDocs(user),
    s("id") ? getTradeDoc(user, s("id")) : null,
    s("order") ? orderPrefill(user, s("order")) : null,
  ]);

  let initial: { id: string | null; type: DocType | null; data: DocData; chat: unknown };
  if (saved) initial = { id: saved.id, type: saved.type, data: saved.data, chat: saved.chat };
  else {
    const t = s("type");
    initial = {
      id: null,
      type: isDocType(t) ? t : prefill ? "pi" : null,
      data: { ...emptyDoc(), ...seller, date: today, ...(prefill ?? {}) },
      chat: [],
    };
  }

  return <Workbench initial={initial} seller={seller} docs={docs} aiEnabled={can(user, "ai.use") && aiConfigured()} today={today} />;
}
