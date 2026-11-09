import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth";
import { listSuggestions } from "@/server/suggestions";
import { SuggestionList } from "./suggestion-list";

export const metadata: Metadata = { title: "建档建议" };

export default async function SuggestionsPage() {
  const user = await requirePermission("customer.create");
  const rows = await listSuggestions(user);
  return (
    <>
      <PageHeader
        title="建档建议"
        description="最近 180 天和你有邮件或 WhatsApp 往来、但还没建档的人。建档后历史邮件和聊天会自动归到新客户。"
      />
      <SuggestionList rows={rows} tz={user.timezone} />
    </>
  );
}
