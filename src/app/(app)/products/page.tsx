import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "产品" };

export default async function Page() {
  await requirePermission("product.view");
  return (
    <PlannedModule
      title={"产品"}
      phase="P2"
      features={["产品目录", "规格、价格、图片"]}
    />
  );
}
